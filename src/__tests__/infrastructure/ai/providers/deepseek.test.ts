import OpenAI from 'openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_SYSTEM_PROMPT } from '@/domain/analysis/systemPrompt';
import {
    callDeepSeek,
    DEEPSEEK_STALL_TIMEOUT_MS,
    DEEPSEEK_STALLED_CODE,
} from '@/infrastructure/ai/providers/deepseek';
import type { DeepSeekModelId } from '@/domain/analysis/modelSpecs';

const mockCreate = vi.hoisted(() => vi.fn());
/** Responses API(`POST /responses`) — `responseSchema`가 있을 때 타는 경로. */
const mockResponsesCreate = vi.hoisted(() => vi.fn());

vi.mock('openai', () => ({
    __esModule: true,
    default: vi.fn((options: unknown) => ({
        __options: options,
        chat: {
            completions: {
                create: mockCreate,
            },
        },
        responses: {
            create: mockResponsesCreate,
        },
    })),
}));

const mockedOpenAI = vi.mocked(OpenAI);

/** Free class — `reasoning.default: 'off'`. */
const FLASH_MODEL: DeepSeekModelId = 'deepseek-v4.1-flash';
/** Member class — also `reasoning.default: 'off'`; thinking is opt-in. */
const PRO_MODEL: DeepSeekModelId = 'deepseek-v4.1-pro';

// DeepSeek is called in STREAMING mode, so the SDK's `create` resolves to an
// async iterable of chat-completion chunks. These helpers build fresh streams
// (async iterables are single-use — a shared instance would be exhausted after
// the first consumption).
interface Chunk {
    choices: Array<{
        delta?: { content?: string };
        finish_reason?: string | null;
    }>;
    usage?: unknown;
}

function toStream(chunks: Chunk[]): AsyncIterable<Chunk> {
    return {
        async *[Symbol.asyncIterator]() {
            for (const chunk of chunks) {
                yield chunk;
            }
        },
    };
}

/**
 * Build a streamed response: an optional content-delta chunk, a finish_reason
 * chunk, and an optional final usage-only chunk (choices empty) — mirroring how
 * DeepSeek streams with `stream_options.include_usage: true`.
 */
function stream(
    content: string,
    finishReason = 'stop',
    usage?: unknown
): AsyncIterable<Chunk> {
    const chunks: Chunk[] = [];
    if (content) {
        chunks.push({
            choices: [{ delta: { content }, finish_reason: null }],
        });
    }
    chunks.push({ choices: [{ delta: {}, finish_reason: finishReason }] });
    if (usage) {
        chunks.push({ choices: [], usage });
    }
    return toStream(chunks);
}

function successStream(usage?: unknown): AsyncIterable<Chunk> {
    return stream('analysis result', 'stop', usage);
}

describe('callDeepSeek', () => {
    beforeEach(() => {
        mockCreate.mockClear();
        mockResponsesCreate.mockClear();
        mockedOpenAI.mockClear();
    });

    it('returns aggregated streamed content from a stop-finished response', async () => {
        mockCreate.mockResolvedValueOnce(successStream());

        const result = await callDeepSeek('prompt', {
            model: FLASH_MODEL,
            apiKey: 'key',
        });

        expect(result).toBe('analysis result');
    });

    it('aggregates multiple content deltas into the full response', async () => {
        mockCreate.mockResolvedValueOnce(
            toStream([
                {
                    choices: [
                        { delta: { content: 'part-1 ' }, finish_reason: null },
                    ],
                },
                {
                    choices: [
                        { delta: { content: 'part-2' }, finish_reason: null },
                    ],
                },
                { choices: [{ delta: {}, finish_reason: 'stop' }] },
            ])
        );

        const result = await callDeepSeek('prompt', {
            model: FLASH_MODEL,
            apiKey: 'key',
        });

        expect(result).toBe('part-1 part-2');
    });

    it('constructs the client with the DeepSeek baseURL', async () => {
        mockCreate.mockResolvedValueOnce(successStream());

        // Unique apiKey — clientCache is module-scoped and persists across
        // tests in this file, so a shared key would hit the cache and skip
        // the `new OpenAI(...)` constructor call this test asserts on.
        await callDeepSeek('prompt', {
            model: FLASH_MODEL,
            apiKey: 'key-for-baseurl-assertion',
        });

        expect(mockedOpenAI).toHaveBeenCalledWith({
            apiKey: 'key-for-baseurl-assertion',
            baseURL: 'https://api.deepseek.com',
        });
    });

    it('streams with include_usage and passes create params correctly (non-thinking model)', async () => {
        mockCreate.mockResolvedValueOnce(successStream());

        await callDeepSeek('prompt', { model: FLASH_MODEL, apiKey: 'key' });

        const call = mockCreate.mock.calls[0][0];
        // The wire id is `spec.apiModelId`, not our registry key — DeepSeek
        // returns 400 for `deepseek-v4.1-flash`, which is a version label
        // rather than an API id.
        expect(call.model).toBe('deepseek-flash');
        expect(call.messages).toEqual([
            { role: 'system', content: AI_SYSTEM_PROMPT },
            { role: 'user', content: 'prompt' },
        ]);
        expect(call.max_tokens).toBe(393216);
        expect(call.response_format).toEqual({ type: 'json_object' });
        expect(call.thinking).toEqual({ type: 'disabled' });
        expect(call.temperature).toBe(0);
        // Streaming is mandatory (avoids DeepSeek's ~50-60s non-streaming
        // connection termination on long analysis outputs).
        expect(call.stream).toBe(true);
        expect(call.stream_options).toEqual({ include_usage: true });
    });

    it('passes a system message as a role:system entry when provided', async () => {
        mockCreate.mockResolvedValueOnce(successStream());

        await callDeepSeek('prompt', {
            model: FLASH_MODEL,
            apiKey: 'key',
            system: 'custom system',
        });

        const call = mockCreate.mock.calls[0][0];
        expect(call.messages).toEqual([
            { role: 'system', content: 'custom system' },
            { role: 'user', content: 'prompt' },
        ]);
    });

    it('falls back to AI_SYSTEM_PROMPT when no system prompt is provided', async () => {
        mockCreate.mockResolvedValueOnce(successStream());

        await callDeepSeek('prompt', { model: FLASH_MODEL, apiKey: 'key' });

        const call = mockCreate.mock.calls[0][0];
        expect(call.messages).toEqual([
            { role: 'system', content: AI_SYSTEM_PROMPT },
            { role: 'user', content: 'prompt' },
        ]);
    });

    it('enables thinking with reasoning_effort=high and omits temperature when reasoning is on', async () => {
        mockCreate.mockResolvedValueOnce(successStream());

        await callDeepSeek('prompt', {
            model: PRO_MODEL,
            apiKey: 'key',
            reasoning: { thinking: true },
        });

        const call = mockCreate.mock.calls[0][0];
        expect(call.thinking).toEqual({
            type: 'enabled',
            reasoning_effort: 'high',
        });
        expect(call).not.toHaveProperty('temperature');
    });

    it('disables thinking and applies temperature when reasoning is off', async () => {
        mockCreate.mockResolvedValueOnce(successStream());

        await callDeepSeek('prompt', { model: FLASH_MODEL, apiKey: 'key' });

        const call = mockCreate.mock.calls[0][0];
        expect(call.thinking).toEqual({ type: 'disabled' });
        expect(call.temperature).toBe(0);
    });

    // The toggle picks between the spec's two states; omitting it uses `default`.
    describe('reasoning override', () => {
        it('reasoning.thinking=true enables thinking on the flash line too', async () => {
            mockCreate.mockResolvedValueOnce(successStream());

            await callDeepSeek('prompt', {
                model: FLASH_MODEL, // spec.reasoning: { thinking: false }
                apiKey: 'key',
                reasoning: { thinking: true },
            });

            const call = mockCreate.mock.calls[0][0];
            expect(call.thinking).toEqual({
                type: 'enabled',
                reasoning_effort: 'high',
            });
            expect(call).not.toHaveProperty('temperature');
        });

        it('reasoning.thinking=false disables thinking on the pro line', async () => {
            mockCreate.mockResolvedValueOnce(successStream());

            await callDeepSeek('prompt', {
                model: PRO_MODEL, // spec.reasoning: { thinking: true }
                apiKey: 'key',
                reasoning: { thinking: false },
            });

            const call = mockCreate.mock.calls[0][0];
            expect(call.thinking).toEqual({ type: 'disabled' });
            expect(call.temperature).toBe(0);
        });

        it("omitted reasoning falls back to the spec's default state (pro model)", async () => {
            mockCreate.mockResolvedValueOnce(successStream());

            await callDeepSeek('prompt', { model: PRO_MODEL, apiKey: 'key' });

            // Member-class model → `reasoning.default: 'off'`. The pro line is
            // a thinking model, but the server pays for it, so thinking is
            // opt-in rather than automatic.
            const call = mockCreate.mock.calls[0][0];
            expect(call.thinking).toEqual({ type: 'disabled' });
            expect(call.temperature).toBe(0);
        });

        it("omitted reasoning falls back to the spec's default state (flash model)", async () => {
            mockCreate.mockResolvedValueOnce(successStream());

            await callDeepSeek('prompt', { model: FLASH_MODEL, apiKey: 'key' });

            const call = mockCreate.mock.calls[0][0];
            expect(call.thinking).toEqual({ type: 'disabled' });
            expect(call.temperature).toBe(0);
        });
    });

    describe('responseSchema — Responses API로 강제한다', () => {
        // `/chat/completions`는 `response_format: json_schema`를 거부한다
        // (`400 This response_format type is unavailable now`, V4 모델 ID로도 동일).
        // 강제하지 않던 시절 실측: 30k 토큰 기술 분석 프롬프트에서
        // `indicatorResults[].signals`가 824건 전부 빈 배열이었다.
        function responsesStream(
            text: string,
            usage?: unknown,
            /** 종료 이벤트. 기본은 정상 완료. */
            terminal: {
                type:
                    | 'response.completed'
                    | 'response.incomplete'
                    | 'response.failed';
                incompleteReason?: string;
                errorMessage?: string;
            } = { type: 'response.completed' }
        ): AsyncIterable<unknown> {
            return {
                async *[Symbol.asyncIterator]() {
                    // reasoning 블록도 `text`를 갖는다 — 섞으면 JSON이 깨지므로
                    // `response.output_text.delta`만 읽어야 한다.
                    yield {
                        type: 'response.reasoning_text.delta',
                        delta: 'thinking out loud',
                    };
                    yield { type: 'response.output_text.delta', delta: text };
                    yield {
                        type: terminal.type,
                        response: {
                            ...(usage !== undefined ? { usage } : {}),
                            ...(terminal.incompleteReason !== undefined
                                ? {
                                      incomplete_details: {
                                          reason: terminal.incompleteReason,
                                      },
                                  }
                                : {}),
                            ...(terminal.errorMessage !== undefined
                                ? { error: { message: terminal.errorMessage } }
                                : {}),
                        },
                    };
                },
            };
        }

        it('스키마가 있으면 /responses로 가고 text.format에 실린다', async () => {
            mockResponsesCreate.mockResolvedValueOnce(
                responsesStream('analysis result')
            );

            const schema = { type: 'object', properties: {} };
            const result = await callDeepSeek('prompt', {
                model: FLASH_MODEL,
                apiKey: 'key',
                responseSchema: schema,
            });

            expect(result).toBe('analysis result');
            expect(mockCreate).not.toHaveBeenCalled();
            const call = mockResponsesCreate.mock.calls[0][0];
            expect(call.text.format).toMatchObject({
                type: 'json_schema',
                schema,
            });
            expect(call.stream).toBe(true);
        });

        it('reasoning 블록의 델타는 본문에 섞지 않는다', async () => {
            mockResponsesCreate.mockResolvedValueOnce(
                responsesStream('{"ok":1}')
            );

            const result = await callDeepSeek('prompt', {
                model: FLASH_MODEL,
                apiKey: 'key',
                responseSchema: {},
            });

            expect(result).toBe('{"ok":1}');
            expect(result).not.toContain('thinking out loud');
        });

        it('usage를 chat 모양으로 옮긴다 — 안 옮기면 텔레메트리가 0이 된다', async () => {
            mockResponsesCreate.mockResolvedValueOnce(
                responsesStream('ok', {
                    input_tokens: 1000,
                    output_tokens: 250,
                    input_tokens_details: { cached_tokens: 100 },
                })
            );
            const logSpy = vi
                .spyOn(console, 'info')
                .mockImplementation(() => {});

            await callDeepSeek('prompt', {
                model: FLASH_MODEL,
                apiKey: 'key',
                responseSchema: {},
                jobId: 'job-1',
            });

            const usageLine = logSpy.mock.calls
                .filter(args => String(args[0]).startsWith('[Usage]'))
                .map(args => String(args[1]))[0];
            expect(usageLine).toBeDefined();
            // 1000 − 100(cached) = 900
            expect(usageLine).toContain('"promptTokens":900');
            expect(usageLine).toContain('"outputTokens":250');
            logSpy.mockRestore();
        });

        it('절단된 응답을 성공으로 반환하지 않는다 — max_output_tokens', async () => {
            // `/responses`에는 finish_reason이 없어서, 종료 이벤트를 보지 않으면
            // 절단 시점까지 흘러온 **부분 JSON**이 정상 응답으로 나간다.
            mockResponsesCreate.mockResolvedValueOnce(
                responsesStream('{"indicatorResults":[{"indi', undefined, {
                    type: 'response.incomplete',
                    incompleteReason: 'max_output_tokens',
                })
            );

            const promise = callDeepSeek('prompt', {
                model: FLASH_MODEL,
                apiKey: 'key',
                responseSchema: {},
            });

            // chat 경로의 `length`와 같은 취급 — 재시도해도 같은 한도에 걸린다.
            await expect(promise).rejects.toThrow(/output token limit/);
            await expect(promise).rejects.not.toMatchObject({
                retryable: true,
            });
        });

        it('그 외 incomplete는 재시도 가능 오류로 올린다', async () => {
            mockResponsesCreate.mockResolvedValueOnce(
                responsesStream('partial', undefined, {
                    type: 'response.incomplete',
                    incompleteReason: 'content_filter',
                })
            );

            await expect(
                callDeepSeek('prompt', {
                    model: FLASH_MODEL,
                    apiKey: 'key',
                    responseSchema: {},
                })
            ).rejects.toMatchObject({ retryable: true });
        });

        it('response.failed는 본문이 있어도 오류다', async () => {
            mockResponsesCreate.mockResolvedValueOnce(
                responsesStream('{"partial":1}', undefined, {
                    type: 'response.failed',
                    errorMessage: 'upstream exploded',
                })
            );

            await expect(
                callDeepSeek('prompt', {
                    model: FLASH_MODEL,
                    apiKey: 'key',
                    responseSchema: {},
                })
            ).rejects.toMatchObject({ retryable: true });
        });

        it('본문이 비면 재시도 가능 오류다 — 정상 완료여도', async () => {
            mockResponsesCreate.mockResolvedValueOnce(responsesStream(''));

            await expect(
                callDeepSeek('prompt', {
                    model: FLASH_MODEL,
                    apiKey: 'key',
                    responseSchema: {},
                })
            ).rejects.toMatchObject({ retryable: true });
        });

        it('종료 이벤트 없이 스트림이 끝나면 완료로 치지 않는다', async () => {
            // 연결이 조용히 닫히거나 SSE 프레이밍이 어긋나면 셋 중 무엇도 오지 않는다.
            // `outcome` 기본값이 'completed'이면 그때도 부분 텍스트가 성공으로 나간다 —
            // 절단 오분류와 같은 사고를 다른 입구로 내는 셈이다.
            mockResponsesCreate.mockResolvedValueOnce({
                async *[Symbol.asyncIterator]() {
                    yield {
                        type: 'response.output_text.delta',
                        delta: '{"partial":',
                    };
                    // 종료 이벤트 없이 끝난다.
                },
            });

            await expect(
                callDeepSeek('prompt', {
                    model: FLASH_MODEL,
                    apiKey: 'key',
                    responseSchema: {},
                })
            ).rejects.toMatchObject({ retryable: true });
        });

        it('스키마가 없으면 종전 경로(json_object)를 그대로 탄다', async () => {
            mockCreate.mockResolvedValueOnce(successStream());

            await callDeepSeek('prompt', { model: FLASH_MODEL, apiKey: 'key' });

            expect(mockResponsesCreate).not.toHaveBeenCalled();
            expect(mockCreate.mock.calls[0][0].response_format).toEqual({
                type: 'json_object',
            });
        });

        it('출력 파트가 둘 이상이면 진단 경고를 남기고 본문은 그대로 잇는다', async () => {
            // 파트를 버리면 정상적으로 나뉜 응답이 잘린다 — 복구는 normalizeJsonResponse가
            // 맡고, 여기서는 운영에서 원인을 가를 수 있게 파트별 글자 수만 남긴다.
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            mockResponsesCreate.mockResolvedValueOnce({
                async *[Symbol.asyncIterator]() {
                    yield {
                        type: 'response.output_text.delta',
                        delta: '{"a":1}',
                        output_index: 1,
                        content_index: 0,
                    };
                    yield {
                        type: 'response.output_text.delta',
                        delta: '{"a":1}',
                        output_index: 2,
                        content_index: 0,
                    };
                    yield { type: 'response.completed', response: {} };
                },
            });

            const result = await callDeepSeek('prompt', {
                model: FLASH_MODEL,
                apiKey: 'key',
                responseSchema: {},
            });

            expect(result).toBe('{"a":1}{"a":1}');
            expect(warn).toHaveBeenCalledWith(
                '[DeepSeek] Responses stream emitted text in more than one output part',
                expect.objectContaining({ parts: { '1:0': 7, '2:0': 7 } })
            );
            warn.mockRestore();
        });
    });

    it('throws non-retryable error when finish_reason is length (max tokens)', async () => {
        mockCreate.mockResolvedValueOnce(stream('', 'length'));

        const promise = callDeepSeek('prompt', {
            model: FLASH_MODEL,
            apiKey: 'key',
        });

        await expect(promise).rejects.toThrow(/output token limit/);
        await expect(promise).rejects.not.toMatchObject({ retryable: true });
    });

    it('throws non-retryable error when finish_reason is content_filter', async () => {
        mockCreate.mockResolvedValueOnce(stream('', 'content_filter'));

        const promise = callDeepSeek('prompt', {
            model: FLASH_MODEL,
            apiKey: 'key',
        });

        await expect(promise).rejects.toThrow(/content filter/);
        await expect(promise).rejects.not.toMatchObject({ retryable: true });
    });

    it('throws retryable error when finish_reason is stop but content is empty (documented DeepSeek quirk)', async () => {
        mockCreate.mockResolvedValueOnce(stream('', 'stop'));

        await expect(
            callDeepSeek('prompt', { model: FLASH_MODEL, apiKey: 'key' })
        ).rejects.toMatchObject({ retryable: true });
    });

    it('throws retryable error for an unexpected finish_reason (tool_calls)', async () => {
        mockCreate.mockResolvedValueOnce(stream('', 'tool_calls'));

        await expect(
            callDeepSeek('prompt', { model: FLASH_MODEL, apiKey: 'key' })
        ).rejects.toMatchObject({ retryable: true });
    });

    it('propagates abort from external signal to underlying SDK call', async () => {
        let receivedSignal: AbortSignal | undefined;
        mockCreate.mockImplementationOnce(
            async (_params: unknown, options: { signal?: AbortSignal }) => {
                receivedSignal = options?.signal;
                externalController.abort();
                return successStream();
            }
        );

        const externalController = new AbortController();
        await callDeepSeek('prompt', {
            model: FLASH_MODEL,
            apiKey: 'key',
            signal: externalController.signal,
        });

        expect(receivedSignal).toBeDefined();
        expect(receivedSignal!.aborted).toBe(true);
    });

    it('reuses cached client across calls with the same apiKey', async () => {
        mockedOpenAI.mockClear();
        mockCreate.mockImplementation(() => Promise.resolve(successStream()));

        await callDeepSeek('prompt1', {
            model: FLASH_MODEL,
            apiKey: 'shared-key',
        });
        await callDeepSeek('prompt2', {
            model: FLASH_MODEL,
            apiKey: 'shared-key',
        });

        expect(mockedOpenAI.mock.calls.length).toBeLessThanOrEqual(1);
    });

    it('throws for an unknown model before making any SDK call', async () => {
        // Runtime guard: MODEL_SPECS[model] is undefined for a bogus id. Cast
        // past the compile-time DeepSeekModelId type to exercise the throw.
        await expect(
            callDeepSeek('prompt', {
                model: 'bogus-model' as DeepSeekModelId,
                apiKey: 'key',
            })
        ).rejects.toThrow('[DeepSeek] Unknown model: bogus-model');
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('aborts the request after DEEPSEEK_TIMEOUT_MS via the internal timeout', async () => {
        // The stall watchdog fires first on a silent call, so the 1h total bound
        // is exercised by a call that keeps trickling events (never silent long
        // enough to stall) but never finishes.
        vi.useFakeTimers();
        try {
            let capturedSignal: AbortSignal | undefined;
            mockCreate.mockImplementationOnce(
                (_params: unknown, options: { signal: AbortSignal }) => {
                    capturedSignal = options.signal;
                    return Promise.resolve({
                        async *[Symbol.asyncIterator]() {
                            for (;;) {
                                await new Promise<void>((resolve, reject) => {
                                    const id = setTimeout(resolve, 60_000);
                                    options.signal.addEventListener(
                                        'abort',
                                        () => {
                                            clearTimeout(id);
                                            reject(
                                                new Error('aborted by timeout')
                                            );
                                        },
                                        { once: true }
                                    );
                                });
                                yield {
                                    choices: [
                                        {
                                            delta: { content: '.' },
                                            finish_reason: null,
                                        },
                                    ],
                                };
                            }
                        },
                    });
                }
            );

            const promise = callDeepSeek('prompt', {
                model: FLASH_MODEL,
                apiKey: 'timeout-key',
            });
            const assertion =
                expect(promise).rejects.toThrow('aborted by timeout');

            // 1h internal timeout fires → controller.abort() → SDK signal aborts.
            await vi.advanceTimersByTimeAsync(3600_000);

            await assertion;
            expect(capturedSignal?.aborted).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('callDeepSeek — usage telemetry', () => {
    beforeEach(() => {
        mockCreate.mockClear();
    });

    it('logs normalized [Usage] from the final streamed usage chunk when jobId is provided', async () => {
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

        mockCreate.mockResolvedValueOnce(
            successStream({
                prompt_tokens: 500,
                completion_tokens: 80,
                total_tokens: 580,
            })
        );

        await callDeepSeek('prompt', {
            model: FLASH_MODEL,
            apiKey: 'key',
            jobId: 'job-789',
        });

        expect(infoSpy).toHaveBeenCalledTimes(1);
        const [tag, payload] = infoSpy.mock.calls[0];
        expect(tag).toBe('[Usage]');
        expect(JSON.parse(payload as string)).toMatchObject({
            jobId: 'job-789',
            model: FLASH_MODEL,
            promptTokens: 500,
            cachedTokens: 0,
            cacheWriteTokens: 0,
            outputTokens: 80,
        });

        infoSpy.mockRestore();
    });

    it('does not log usage when jobId is omitted', async () => {
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

        mockCreate.mockResolvedValueOnce(successStream());

        await callDeepSeek('prompt', { model: FLASH_MODEL, apiKey: 'key' });

        expect(infoSpy).not.toHaveBeenCalled();
        infoSpy.mockRestore();
    });
});

/**
 * 2026-09-14 20:30–21:28 UTC DeepSeek sent neither a response nor an error for
 * an hour; the 1h total timeout never helped. The watchdog aborts on silence
 * only — a call that keeps streaming is never cut, however long it runs.
 */
describe('callDeepSeek — stall watchdog', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        mockCreate.mockReset();
        mockResponsesCreate.mockReset();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    /** A `create` that never responds but honours the abort signal, like the SDK. */
    function neverRespond(
        _params: unknown,
        { signal }: { signal: AbortSignal }
    ): Promise<never> {
        return new Promise((_, reject) => {
            signal.addEventListener('abort', () =>
                reject(
                    Object.assign(new Error('aborted'), { name: 'AbortError' })
                )
            );
        });
    }

    it('aborts a silent call with the stalled code after the stall timeout', async () => {
        mockCreate.mockImplementationOnce(neverRespond);
        const call = callDeepSeek('prompt', {
            model: FLASH_MODEL,
            apiKey: 'key',
        });
        const assertion = expect(call).rejects.toMatchObject({
            code: DEEPSEEK_STALLED_CODE,
        });
        await vi.advanceTimersByTimeAsync(DEEPSEEK_STALL_TIMEOUT_MS);
        await assertion;
    });

    it('does not cut a call that keeps streaming past the stall timeout', async () => {
        const gap = DEEPSEEK_STALL_TIMEOUT_MS - 1_000;
        mockCreate.mockResolvedValueOnce({
            async *[Symbol.asyncIterator]() {
                for (const piece of ['{"a":', '1', '}']) {
                    await new Promise(resolve => setTimeout(resolve, gap));
                    yield {
                        choices: [
                            { delta: { content: piece }, finish_reason: null },
                        ],
                    };
                }
                yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
            },
        });
        const call = callDeepSeek('prompt', {
            model: FLASH_MODEL,
            apiKey: 'key',
        });
        await vi.advanceTimersByTimeAsync(gap * 3 + 10);
        await expect(call).resolves.toBe('{"a":1}');
    });

    it('covers the Responses API path too', async () => {
        mockResponsesCreate.mockImplementationOnce(neverRespond);
        const call = callDeepSeek('prompt', {
            model: FLASH_MODEL,
            apiKey: 'key',
            responseSchema: { type: 'object' },
        });
        const assertion = expect(call).rejects.toMatchObject({
            code: DEEPSEEK_STALLED_CODE,
        });
        await vi.advanceTimersByTimeAsync(DEEPSEEK_STALL_TIMEOUT_MS);
        await assertion;
    });

    it("keeps a caller's own abort as a plain abort, not a stall", async () => {
        mockCreate.mockImplementationOnce(neverRespond);
        const controller = new AbortController();
        const call = callDeepSeek('prompt', {
            model: FLASH_MODEL,
            apiKey: 'key',
            signal: controller.signal,
        });
        const assertion = expect(call).rejects.toSatisfy(
            (error: unknown) =>
                (error as { code?: string }).code !== DEEPSEEK_STALLED_CODE
        );
        controller.abort();
        await assertion;
    });
});
