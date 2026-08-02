import Anthropic from '@anthropic-ai/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    MAX_TOKENS_CODE,
    callClaude,
} from '@/infrastructure/ai/providers/anthropic';
import type { ClaudeModelId } from '@/domain/analysis/modelSpecs';

const mockFinalMessage = vi.hoisted(() => vi.fn());
const mockStream = vi.hoisted(() => vi.fn());

vi.mock('@anthropic-ai/sdk', () => ({
    default: vi.fn(() => ({
        messages: {
            stream: mockStream,
        },
    })),
}));

// siglens-core를 mock해 effort 필드가 추가된 새 ModelSpec을 반영한다.
vi.mock('@/domain/analysis/modelSpecs', () => ({
    MODEL_SPECS: {
        'claude-opus-4-7': {
            provider: 'claude',
            apiModelId: 'claude-opus-4-7',
            maxOutputTokens: 128_000,
            effort: 'medium',
            temperature: 0,
        },
        'claude-sonnet-4-6': {
            provider: 'claude',
            apiModelId: 'claude-sonnet-4-6',
            maxOutputTokens: 64_000,
            effort: 'medium',
            temperature: 0,
        },
        'claude-haiku-4-5': {
            provider: 'claude',
            apiModelId: 'claude-haiku-4-5-20251001',
            maxOutputTokens: 8_192,
            thinkingBudget: 0,
            temperature: 0,
            topP: 0.95,
        },
    },
}));

vi.mock('@/domain/analysis/systemPrompt', () => ({
    AI_SYSTEM_PROMPT: 'system prompt',
}));

const mockedAnthropic = vi.mocked(Anthropic);

const MODEL_WITH_EFFORT: ClaudeModelId = 'claude-opus-4-7';
const MODEL_WITHOUT_THINKING: ClaudeModelId = 'claude-haiku-4-5';

function makeStream(response: object) {
    return {
        finalMessage: vi.fn().mockResolvedValueOnce(response),
    };
}

describe('callClaude', () => {
    beforeEach(() => {
        mockStream.mockClear();
        mockFinalMessage.mockClear();
    });

    it('returns text from end_turn response', async () => {
        mockStream.mockReturnValueOnce(
            makeStream({
                stop_reason: 'end_turn',
                content: [{ type: 'text', text: 'analysis result' }],
            })
        );

        const result = await callClaude('prompt', {
            model: MODEL_WITH_EFFORT,
            apiKey: 'key',
        });

        expect(result).toBe('analysis result');
    });

    it('extracts text block from mixed content (thinking + text)', async () => {
        mockStream.mockReturnValueOnce(
            makeStream({
                stop_reason: 'end_turn',
                content: [
                    {
                        type: 'thinking',
                        thinking: 'reasoning...',
                        signature: 'sig',
                    },
                    { type: 'text', text: 'final answer' },
                ],
            })
        );

        const result = await callClaude('prompt', {
            model: MODEL_WITH_EFFORT,
            apiKey: 'key',
        });

        expect(result).toBe('final answer');
    });

    it('uses adaptive thinking with default effort from spec', async () => {
        mockStream.mockReturnValueOnce(
            makeStream({
                stop_reason: 'end_turn',
                content: [{ type: 'text', text: 'ok' }],
            })
        );

        await callClaude('prompt', {
            model: MODEL_WITH_EFFORT,
            apiKey: 'key',
        });

        const call = mockStream.mock.calls[0][0];
        expect(call.thinking).toEqual({ type: 'adaptive', display: 'omitted' });
        expect(call.output_config).toEqual({ effort: 'medium' });
        expect(call).not.toHaveProperty('temperature');
    });

    it('uses provided effort when specified', async () => {
        mockStream.mockReturnValueOnce(
            makeStream({
                stop_reason: 'end_turn',
                content: [{ type: 'text', text: 'ok' }],
            })
        );

        await callClaude('prompt', {
            model: MODEL_WITH_EFFORT,
            apiKey: 'key',
            effort: 'low',
        });

        const call = mockStream.mock.calls[0][0];
        expect(call.output_config).toEqual({ effort: 'low' });
    });

    it('omits thinking config when model does not support thinking (haiku)', async () => {
        mockStream.mockReturnValueOnce(
            makeStream({
                stop_reason: 'end_turn',
                content: [{ type: 'text', text: 'ok' }],
            })
        );

        await callClaude('prompt', {
            model: MODEL_WITHOUT_THINKING,
            apiKey: 'key',
        });

        const call = mockStream.mock.calls[0][0];
        expect(call).not.toHaveProperty('thinking');
        expect(call).not.toHaveProperty('output_config');
        expect(call.temperature).toBe(0);
    });

    it('throws MAX_TOKENS_CODE error when stop_reason is max_tokens', async () => {
        mockStream.mockReturnValueOnce(
            makeStream({
                stop_reason: 'max_tokens',
                content: [],
            })
        );

        await expect(
            callClaude('prompt', {
                model: MODEL_WITH_EFFORT,
                apiKey: 'key',
            })
        ).rejects.toMatchObject({ code: MAX_TOKENS_CODE });
    });

    it('throws non-retryable error when stop_reason is refusal', async () => {
        mockStream.mockReturnValueOnce(
            makeStream({
                stop_reason: 'refusal',
                content: [],
            })
        );

        const promise = callClaude('prompt', {
            model: MODEL_WITH_EFFORT,
            apiKey: 'key',
        });

        await expect(promise).rejects.toThrow(/refused/);
        await expect(promise).rejects.not.toMatchObject({ retryable: true });
    });

    it('throws retryable error for unexpected stop_reason', async () => {
        mockStream.mockReturnValueOnce(
            makeStream({
                stop_reason: 'tool_use',
                content: [],
            })
        );

        await expect(
            callClaude('prompt', {
                model: MODEL_WITH_EFFORT,
                apiKey: 'key',
            })
        ).rejects.toMatchObject({ retryable: true });
    });

    it('throws retryable error when end_turn returns no text block', async () => {
        mockStream.mockReturnValueOnce(
            makeStream({
                stop_reason: 'end_turn',
                content: [
                    {
                        type: 'thinking',
                        thinking: 'thoughts',
                        signature: 'sig',
                    },
                ],
            })
        );

        await expect(
            callClaude('prompt', {
                model: MODEL_WITH_EFFORT,
                apiKey: 'key',
            })
        ).rejects.toMatchObject({ retryable: true });
    });

    it('passes max_tokens from MODEL_SPECS map', async () => {
        mockStream.mockReturnValueOnce(
            makeStream({
                stop_reason: 'end_turn',
                content: [{ type: 'text', text: 'ok' }],
            })
        );

        await callClaude('prompt', {
            model: MODEL_WITH_EFFORT,
            apiKey: 'key',
        });

        const call = mockStream.mock.calls[0][0];
        // claude-opus-4-7 max output = 128000
        expect(call.max_tokens).toBe(128_000);
    });

    it('propagates abort from external signal to underlying SDK call', async () => {
        const externalController = new AbortController();
        let receivedSignal: AbortSignal | undefined;

        mockStream.mockImplementationOnce(
            (_params: unknown, options: { signal?: AbortSignal }) => {
                receivedSignal = options?.signal;
                externalController.abort();
                return makeStream({
                    stop_reason: 'end_turn',
                    content: [{ type: 'text', text: 'ok' }],
                });
            }
        );

        await callClaude('prompt', {
            model: MODEL_WITH_EFFORT,
            apiKey: 'key',
            signal: externalController.signal,
        });

        expect(receivedSignal).toBeDefined();
        expect(receivedSignal!.aborted).toBe(true);
    });

    describe('structured output (responseSchema)', () => {
        const SCHEMA = {
            type: 'object',
            properties: { sentiment: { type: 'string' } },
            required: ['sentiment'],
        };

        it('provides the schema tool with auto tool_choice and keeps thinking', async () => {
            mockStream.mockReturnValueOnce(
                makeStream({
                    stop_reason: 'tool_use',
                    content: [
                        {
                            type: 'tool_use',
                            id: 'tu_1',
                            name: 'structured_analysis',
                            input: { sentiment: 'bullish' },
                        },
                    ],
                })
            );

            const result = await callClaude('prompt', {
                model: MODEL_WITH_EFFORT,
                apiKey: 'key',
                responseSchema: SCHEMA,
            });

            const call = mockStream.mock.calls[0][0];
            expect(call.tools).toEqual([
                {
                    name: 'structured_analysis',
                    description: 'Return the analysis as structured JSON.',
                    input_schema: SCHEMA,
                },
            ]);
            // auto tool_choice는 thinking과 양립한다 (forced tool_choice는 400을 유발).
            expect(call.tool_choice).toEqual({ type: 'auto' });
            // thinking은 schema 유무와 무관하게 Sonnet/Opus에서 유지된다.
            expect(call.thinking).toEqual({
                type: 'adaptive',
                display: 'omitted',
            });
            expect(call.output_config).toEqual({ effort: 'medium' });
            // thinking과 temperature는 동시 지정 불가하므로 temperature는 없어야 한다.
            expect(call).not.toHaveProperty('temperature');
            // tool_use.input이 JSON 문자열로 직렬화되어 반환된다.
            expect(result).toBe(JSON.stringify({ sentiment: 'bullish' }));
        });

        it('keeps thinking on Sonnet/Opus even when a schema is present', async () => {
            mockStream.mockReturnValueOnce(
                makeStream({
                    stop_reason: 'tool_use',
                    content: [
                        {
                            type: 'tool_use',
                            id: 'tu_2',
                            name: 'structured_analysis',
                            input: { sentiment: 'neutral' },
                        },
                    ],
                })
            );

            await callClaude('prompt', {
                model: MODEL_WITH_EFFORT,
                apiKey: 'key',
                effort: 'high',
                responseSchema: SCHEMA,
            });

            const call = mockStream.mock.calls[0][0];
            expect(call.thinking).toEqual({
                type: 'adaptive',
                display: 'omitted',
            });
            expect(call.output_config).toEqual({ effort: 'high' });
            expect(call.tool_choice).toEqual({ type: 'auto' });
        });

        it('omits thinking on Haiku even when a schema is present', async () => {
            mockStream.mockReturnValueOnce(
                makeStream({
                    stop_reason: 'tool_use',
                    content: [
                        {
                            type: 'tool_use',
                            id: 'tu_3',
                            name: 'structured_analysis',
                            input: { sentiment: 'bearish' },
                        },
                    ],
                })
            );

            await callClaude('prompt', {
                model: MODEL_WITHOUT_THINKING,
                apiKey: 'key',
                responseSchema: SCHEMA,
            });

            const call = mockStream.mock.calls[0][0];
            // haiku는 effort가 없어 schema 유무와 무관하게 thinking이 없다.
            // (4) forced path still passes thinking=off correctly: no `thinking`/
            // `output_config` key alongside the forced tool_choice below.
            expect(call).not.toHaveProperty('thinking');
            expect(call).not.toHaveProperty('output_config');
            expect(call.temperature).toBe(0);
            // (1) responseSchema + non-thinking model → tool_choice is FORCED
            // to the structured-output tool. Non-thinking Claude models (no
            // `effort` in MODEL_SPECS, e.g. haiku) never send `thinking`, so
            // forced tool_choice is always safe here — see the forced+thinking
            // 400 note in the next test.
            expect(call.tool_choice).toEqual({
                type: 'tool',
                name: 'structured_analysis',
            });
        });

        it('PR5a: no responseSchema → no tools/tool_choice at all, regardless of model', async () => {
            mockStream.mockReturnValueOnce(
                makeStream({
                    stop_reason: 'end_turn',
                    content: [{ type: 'text', text: 'ok' }],
                })
            );

            await callClaude('prompt', {
                model: MODEL_WITHOUT_THINKING,
                apiKey: 'key',
            });

            const call = mockStream.mock.calls[0][0];
            expect(call).not.toHaveProperty('tools');
            expect(call).not.toHaveProperty('tool_choice');
        });

        it('falls back to text extraction when no tool_use block is present', async () => {
            mockStream.mockReturnValueOnce(
                makeStream({
                    stop_reason: 'tool_use',
                    content: [
                        { type: 'text', text: '{"sentiment":"bearish"}' },
                    ],
                })
            );

            const result = await callClaude('prompt', {
                model: MODEL_WITH_EFFORT,
                apiKey: 'key',
                responseSchema: SCHEMA,
            });

            expect(result).toBe('{"sentiment":"bearish"}');
        });

        // W7: tool_use 블록은 있지만 input이 null이면 JSON.stringify(null)='null'을 반환해
        // downstream JSON 파싱을 깨뜨린다 — text 추출 폴백으로 넘어가야 한다.
        it('falls back to text extraction when tool_use input is null (W7)', async () => {
            mockStream.mockReturnValueOnce(
                makeStream({
                    stop_reason: 'tool_use',
                    content: [
                        {
                            type: 'tool_use',
                            id: 'tu_null',
                            name: 'structured_analysis',
                            input: null,
                        },
                        { type: 'text', text: '{"sentiment":"bullish"}' },
                    ],
                })
            );

            const result = await callClaude('prompt', {
                model: MODEL_WITH_EFFORT,
                apiKey: 'key',
                responseSchema: SCHEMA,
            });

            // 'null'이 아니라 폴백 텍스트가 반환되어야 한다.
            expect(result).toBe('{"sentiment":"bullish"}');
            expect(result).not.toBe('null');
        });

        // forced-tool 경로(haiku + schema → tool_choice: {type:'tool'})의 방어적 폴백.
        // forced tool_choice는 정상적으로 tool 호출을 보장하지만, 응답에 tool_use 블록이
        // 없으면(모델이 text만 반환) claude.ts의 text 추출 폴백으로 넘어가야 하며 throw하지
        // 않아야 한다. 기존 폴백/W7 테스트는 전부 MODEL_WITH_EFFORT(auto tool_choice) 경로만
        // 커버했다 — forced 경로의 폴백 분기를 여기서 검증한다.
        it('forced-tool path (haiku + schema) falls back to text extraction when no tool_use block is present', async () => {
            mockStream.mockReturnValueOnce(
                makeStream({
                    stop_reason: 'tool_use',
                    content: [
                        { type: 'text', text: '{"sentiment":"bullish"}' },
                    ],
                })
            );

            const result = await callClaude('prompt', {
                model: MODEL_WITHOUT_THINKING,
                apiKey: 'key',
                responseSchema: SCHEMA,
            });

            // forced 경로였음을 확인 (tool_choice가 강제됨).
            const call = mockStream.mock.calls[0][0];
            expect(call.tool_choice).toEqual({
                type: 'tool',
                name: 'structured_analysis',
            });
            // tool_use 블록이 없어 text 추출 폴백으로 복구된다 — throw 없이 텍스트 반환.
            expect(result).toBe('{"sentiment":"bullish"}');
        });

        // Audit fix: a forced-tool (haiku) call truncated by max_tokens can still
        // materialize a tool_use block with a partial non-null `input`. The
        // structured early-return must NOT treat that as success — it has to
        // fall through to the dedicated max_tokens branch so callers retry
        // instead of receiving truncated/malformed JSON.
        it('throws MAX_TOKENS_CODE when a forced structured response is truncated by max_tokens, even with a partial non-null tool_use input', async () => {
            mockStream.mockReturnValueOnce(
                makeStream({
                    stop_reason: 'max_tokens',
                    content: [
                        {
                            type: 'tool_use',
                            id: 'tu_partial',
                            name: 'structured_analysis',
                            // Partial/truncated but non-null input — this is the
                            // shape that previously bypassed the MAX_TOKENS retry.
                            input: { sentiment: 'bul' },
                        },
                    ],
                })
            );

            await expect(
                callClaude('prompt', {
                    model: MODEL_WITHOUT_THINKING,
                    apiKey: 'key',
                    responseSchema: SCHEMA,
                })
            ).rejects.toMatchObject({ code: MAX_TOKENS_CODE });
        });

        // Parallel assertion: a normal (non-truncated) tool_use response with a
        // complete input must still return the serialized JSON as before.
        it('still returns JSON.stringify(input) for a normal (non-max_tokens) complete tool_use response', async () => {
            mockStream.mockReturnValueOnce(
                makeStream({
                    stop_reason: 'tool_use',
                    content: [
                        {
                            type: 'tool_use',
                            id: 'tu_complete',
                            name: 'structured_analysis',
                            input: { sentiment: 'bullish' },
                        },
                    ],
                })
            );

            const result = await callClaude('prompt', {
                model: MODEL_WITHOUT_THINKING,
                apiKey: 'key',
                responseSchema: SCHEMA,
            });

            expect(result).toBe(JSON.stringify({ sentiment: 'bullish' }));
        });
    });

    it('keeps prose behavior with no tools/tool_choice when schema is absent', async () => {
        mockStream.mockReturnValueOnce(
            makeStream({
                stop_reason: 'end_turn',
                content: [{ type: 'text', text: 'prose json' }],
            })
        );

        const result = await callClaude('prompt', {
            model: MODEL_WITH_EFFORT,
            apiKey: 'key',
        });

        const call = mockStream.mock.calls[0][0];
        expect(call).not.toHaveProperty('tools');
        expect(call).not.toHaveProperty('tool_choice');
        expect(call.thinking).toEqual({ type: 'adaptive', display: 'omitted' });
        expect(result).toBe('prose json');
    });

    it('reuses cached client across calls with the same apiKey', async () => {
        mockedAnthropic.mockClear();
        mockStream.mockImplementation(() =>
            makeStream({
                stop_reason: 'end_turn',
                content: [{ type: 'text', text: 'ok' }],
            })
        );

        await callClaude('prompt1', {
            model: MODEL_WITH_EFFORT,
            apiKey: 'shared-key',
        });
        await callClaude('prompt2', {
            model: MODEL_WITH_EFFORT,
            apiKey: 'shared-key',
        });

        expect(mockedAnthropic.mock.calls.length).toBeLessThanOrEqual(1);
    });
});

describe('callClaude — analyze path prompt-cache construction (design C)', () => {
    beforeEach(() => {
        mockStream.mockClear();
    });

    it('always wraps the system prompt in a content-block array with cache_control, unconditionally', async () => {
        mockStream.mockReturnValueOnce(
            makeStream({
                stop_reason: 'end_turn',
                content: [{ type: 'text', text: 'ok' }],
            })
        );

        await callClaude('prompt', {
            model: MODEL_WITH_EFFORT,
            apiKey: 'key',
            system: 'custom system',
        });

        const call = mockStream.mock.calls[0][0];
        expect(call.system).toEqual([
            {
                type: 'text',
                text: 'custom system',
                cache_control: { type: 'ephemeral' },
            },
        ]);
    });

    it('constructs the cached system block for a no-effort (haiku) model — cache wrapping precedes the effort branch', async () => {
        mockStream.mockReturnValueOnce(
            makeStream({
                stop_reason: 'end_turn',
                content: [{ type: 'text', text: 'ok' }],
            })
        );

        await callClaude('prompt', {
            model: MODEL_WITHOUT_THINKING,
            apiKey: 'key',
            system: 'custom system',
        });

        const call = mockStream.mock.calls[0][0];
        // haiku has no adaptive-thinking branch, but the system prompt is still
        // wrapped in a cache_control block — caching is independent of effort.
        expect(call.system).toEqual([
            {
                type: 'text',
                text: 'custom system',
                cache_control: { type: 'ephemeral' },
            },
        ]);
        expect(call).not.toHaveProperty('output_config');
    });

    it('the user message is the plain prompt string — no cache block on the user side', async () => {
        mockStream.mockReturnValueOnce(
            makeStream({
                stop_reason: 'end_turn',
                content: [{ type: 'text', text: 'ok' }],
            })
        );

        await callClaude('the dynamic user prompt', {
            model: MODEL_WITH_EFFORT,
            apiKey: 'key',
            system: 'custom system',
        });

        const call = mockStream.mock.calls[0][0];
        expect(call.messages).toEqual([
            { role: 'user', content: 'the dynamic user prompt' },
        ]);
    });

    it('defaults system to AI_SYSTEM_PROMPT wrapped in a cached block when no system override is given', async () => {
        mockStream.mockReturnValueOnce(
            makeStream({
                stop_reason: 'end_turn',
                content: [{ type: 'text', text: 'ok' }],
            })
        );

        await callClaude('prompt', {
            model: MODEL_WITH_EFFORT,
            apiKey: 'key',
        });

        const call = mockStream.mock.calls[0][0];
        expect(call.system).toEqual([
            {
                type: 'text',
                text: 'system prompt',
                cache_control: { type: 'ephemeral' },
            },
        ]);
    });
});

describe('callClaude — usage telemetry', () => {
    beforeEach(() => {
        mockStream.mockClear();
    });

    it('logs normalized [Usage] when jobId is provided', async () => {
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

        mockStream.mockReturnValueOnce(
            makeStream({
                stop_reason: 'end_turn',
                content: [{ type: 'text', text: 'ok' }],
                usage: {
                    input_tokens: 100,
                    cache_creation_input_tokens: 20,
                    cache_read_input_tokens: 900,
                    output_tokens: 15,
                },
            })
        );

        await callClaude('prompt', {
            model: MODEL_WITH_EFFORT,
            apiKey: 'key',
            jobId: 'job-123',
        });

        expect(infoSpy).toHaveBeenCalledTimes(1);
        const [tag, payload] = infoSpy.mock.calls[0];
        expect(tag).toBe('[Usage]');
        expect(JSON.parse(payload as string)).toMatchObject({
            jobId: 'job-123',
            model: MODEL_WITH_EFFORT,
            promptTokens: 100,
            cachedTokens: 900,
            cacheWriteTokens: 20,
            outputTokens: 15,
        });

        infoSpy.mockRestore();
    });

    it('does not log usage when jobId is omitted (unit-test call sites unaffected)', async () => {
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

        mockStream.mockReturnValueOnce(
            makeStream({
                stop_reason: 'end_turn',
                content: [{ type: 'text', text: 'ok' }],
                usage: { input_tokens: 100, output_tokens: 15 },
            })
        );

        await callClaude('prompt', {
            model: MODEL_WITH_EFFORT,
            apiKey: 'key',
        });

        expect(infoSpy).not.toHaveBeenCalled();
        infoSpy.mockRestore();
    });
});
