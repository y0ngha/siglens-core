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
    default: vi.fn(function () {
        return {
            messages: {
                stream: mockStream,
            },
        };
    }),
}));

// MODEL_SPECS를 mock해 이 파일이 프로덕션 등급 배치 변경에 흔들리지 않게 한다.
// 형태는 실제 스펙과 동일해야 한다 — 옛 `effort`/`thinkingBudget` 평면 필드를
// 남겨두면 어댑터가 읽는 `reasoning`이 undefined가 되어 조용히 어긋난다.
vi.mock('@/domain/analysis/modelSpecs', () => ({
    MODEL_SPECS: {
        // 추론 기본 ON(byok 등급 상당) — thinking이 실제로 나가는 경로.
        'claude-opus-5': {
            provider: 'claude',
            thinkingApi: 'adaptive',
            apiModelId: 'claude-opus-5',
            maxOutputTokens: 128_000,
            reasoning: {
                off: { mode: 'disabled' },
                on: { mode: 'adaptive', effort: 'medium' },
                default: 'on',
            },
        },
        // 추론 기본 OFF(member 등급 상당).
        'claude-sonnet-5-5': {
            provider: 'claude',
            thinkingApi: 'adaptive',
            apiModelId: 'claude-sonnet-5-5',
            maxOutputTokens: 64_000,
            reasoning: {
                // 실제 스펙과 같다 — `disabled`는 400이라 between_tools를 쓴다.
                off: { mode: 'between_tools' },
                on: { mode: 'adaptive', effort: 'medium' },
                default: 'off',
            },
        },
        // budget API + 토글 가능(budget > 0) — 프로덕션 스펙에는 아직 이런 행이
        // 없어서, 이 mock이 없으면 어댑터의 `budget_tokens > 0` 분기가 어떤
        // 테스트에서도 실행되지 않는다.
        'claude-opus-4-8': {
            provider: 'claude',
            thinkingApi: 'budget',
            apiModelId: 'claude-opus-4-8',
            maxOutputTokens: 128_000,
            temperature: 0,
            reasoning: {
                off: { budgetTokens: 0 },
                on: { budgetTokens: 8_192 },
                default: 'off',
            },
        },
        // budget API + 토글 불가 — mock 전용 합성 id(프로덕션 레지스트리에는 이런 행이 없다).
        // 실제 id를 빌려 쓰면 그 모델이 thinking을 안 보낸다고 읽히므로 합성 id를 쓴다.
        'claude-budget-only-mock': {
            provider: 'claude',
            thinkingApi: 'budget',
            apiModelId: 'claude-budget-only-mock',
            maxOutputTokens: 8_192,
            temperature: 0,
            reasoning: {
                off: { budgetTokens: 0 },
                on: { budgetTokens: 0 },
                default: 'off',
                toggleable: false,
            },
        },
    },
}));

vi.mock('@/domain/analysis/systemPrompt', () => ({
    AI_SYSTEM_PROMPT: 'system prompt',
}));

const mockedAnthropic = vi.mocked(Anthropic);

/** 추론 기본 ON인 adaptive 모델. */
const MODEL_WITH_EFFORT: ClaudeModelId = 'claude-opus-5';
/** 추론 기본 OFF인 adaptive 모델. */
const MODEL_DEFAULT_OFF: ClaudeModelId = 'claude-sonnet-5-5';
/** budget API·토글 불가인 합성 mock 모델 — thinking 블록을 보내지 않는 경로. */
const MODEL_WITHOUT_THINKING = 'claude-budget-only-mock' as ClaudeModelId;
/** budget API를 쓰면서 추론을 켤 수 있는 모델(mock 전용). */
const MODEL_BUDGET_THINKING: ClaudeModelId = 'claude-opus-4-8';

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
            reasoning: { mode: 'adaptive', effort: 'low' },
        });

        const call = mockStream.mock.calls[0][0];
        expect(call.output_config).toEqual({ effort: 'low' });
    });

    it('sends thinking:{type:"disabled"} when reasoning is off', async () => {
        mockStream.mockReturnValueOnce(
            makeStream({
                stop_reason: 'end_turn',
                content: [{ type: 'text', text: 'ok' }],
            })
        );

        await callClaude('prompt', {
            model: MODEL_WITH_EFFORT,
            apiKey: 'key',
            reasoning: { mode: 'disabled' },
        });

        const call = mockStream.mock.calls[0][0];
        // effort:'low'로 낮추는 것과 다르다 — low는 여전히 사고 토큰을 쓴다.
        expect(call.thinking).toEqual({ type: 'disabled' });
        expect(call).not.toHaveProperty('output_config');
    });

    it("follows the spec's default state when no reasoning is given", async () => {
        mockStream.mockReturnValueOnce(
            makeStream({
                stop_reason: 'end_turn',
                content: [{ type: 'text', text: 'ok' }],
            })
        );

        await callClaude('prompt', {
            model: MODEL_DEFAULT_OFF,
            apiKey: 'key',
        });

        const call = mockStream.mock.calls[0][0];
        // 이 모델의 OFF는 disabled가 아니라 between_tools다.
        expect(call.thinking).toEqual({ type: 'between_tools' });
    });

    it('sends thinking:{type:"between_tools"} alone, with no effort or display', async () => {
        mockStream.mockReturnValueOnce(
            makeStream({
                stop_reason: 'end_turn',
                content: [{ type: 'text', text: 'ok' }],
            })
        );

        await callClaude('prompt', {
            model: MODEL_DEFAULT_OFF,
            apiKey: 'key',
            reasoning: { mode: 'between_tools' },
        });

        const call = mockStream.mock.calls[0][0];
        expect(call.thinking).toStrictEqual({ type: 'between_tools' });
        expect(call).not.toHaveProperty('output_config');
        expect(call).not.toHaveProperty('temperature');
    });

    it('keeps tool_choice auto with a schema under between_tools', async () => {
        mockStream.mockReturnValueOnce(
            makeStream({
                stop_reason: 'tool_use',
                content: [
                    {
                        type: 'tool_use',
                        id: 't1',
                        name: 'structured_analysis',
                        input: { a: 1 },
                    },
                ],
            })
        );

        await callClaude('prompt', {
            model: MODEL_DEFAULT_OFF,
            apiKey: 'key',
            reasoning: { mode: 'between_tools' },
            responseSchema: { type: 'object' },
        });

        const call = mockStream.mock.calls[0][0];
        expect(call.tool_choice).toEqual({ type: 'auto' });
    });

    it('omits thinking config when model does not support thinking (budget-only mock)', async () => {
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
        expect(call).not.toHaveProperty('temperature');
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

    it('throws MAX_TOKENS_CODE (not a retryable error) when stop_reason is model_context_window_exceeded', async () => {
        mockStream.mockReturnValueOnce(
            makeStream({
                stop_reason: 'model_context_window_exceeded',
                content: [{ type: 'text', text: '{"partial":' }],
            })
        );

        const error = await callClaude('prompt', {
            model: MODEL_WITH_EFFORT,
            apiKey: 'key',
        }).catch((e: unknown) => e);
        expect(error).toMatchObject({ code: MAX_TOKENS_CODE });
        expect(error).not.toHaveProperty('retryable');
    });

    it('throws MAX_TOKENS_CODE when a structured response is cut off by the context window', async () => {
        mockStream.mockReturnValueOnce(
            makeStream({
                stop_reason: 'model_context_window_exceeded',
                content: [
                    {
                        type: 'tool_use',
                        id: 'tu_partial',
                        name: 'structured_analysis',
                        input: { sentiment: 'bul' },
                    },
                ],
            })
        );

        await expect(
            callClaude('prompt', {
                model: MODEL_WITHOUT_THINKING,
                apiKey: 'key',
                responseSchema: { type: 'object' },
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
        // claude-opus-5 max output = 128000
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
                reasoning: { mode: 'adaptive', effort: 'high' },
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

        it('omits thinking on the budget-only mock even when a schema is present', async () => {
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
            // budget-only mock은 effort가 없어 schema 유무와 무관하게 thinking이 없다.
            // (4) forced path still passes thinking=off correctly: no `thinking`/
            // `output_config` key alongside the forced tool_choice below.
            expect(call).not.toHaveProperty('thinking');
            expect(call).not.toHaveProperty('output_config');
            expect(call).not.toHaveProperty('temperature');
            // (1) responseSchema + non-thinking model → tool_choice is FORCED
            // to the structured-output tool. Non-thinking Claude models (no
            // `effort` in MODEL_SPECS, e.g. the budget-only mock) never send `thinking`, so
            // forced tool_choice is always safe here — see the forced+thinking
            // 400 note in the next test.
            expect(call.tool_choice).toEqual({
                type: 'tool',
                name: 'structured_analysis',
            });
        });

        it('no responseSchema → no tools/tool_choice at all, regardless of model', async () => {
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

        // forced-tool 경로(budget-only mock + schema → tool_choice: {type:'tool'})의 방어적 폴백.
        // forced tool_choice는 정상적으로 tool 호출을 보장하지만, 응답에 tool_use 블록이
        // 없으면(모델이 text만 반환) claude.ts의 text 추출 폴백으로 넘어가야 하며 throw하지
        // 않아야 한다. 기존 폴백/W7 테스트는 전부 MODEL_WITH_EFFORT(auto tool_choice) 경로만
        // 커버했다 — forced 경로의 폴백 분기를 여기서 검증한다.
        it('forced-tool path (budget-only mock + schema) falls back to text extraction when no tool_use block is present', async () => {
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

        // Audit fix: a forced-tool (budget-only mock) call truncated by max_tokens can still
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

    it('constructs the cached system block for a no-effort (budget-only mock) model — cache wrapping precedes the effort branch', async () => {
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
        // the budget-only mock has no adaptive-thinking branch, but the system prompt is still
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

describe('callClaude budget thinking', () => {
    beforeEach(() => {
        mockStream.mockClear();
        mockFinalMessage.mockClear();
        mockedAnthropic.mockClear();
    });

    it('sends thinking:{type:"enabled"} with the configured budget when reasoning is on', async () => {
        mockStream.mockReturnValueOnce(
            makeStream({
                stop_reason: 'end_turn',
                content: [{ type: 'text', text: 'ok' }],
            })
        );

        await callClaude('prompt', {
            model: MODEL_BUDGET_THINKING,
            apiKey: 'key',
            reasoning: { budgetTokens: 8_192 },
        });

        const call = mockStream.mock.calls[0][0];
        expect(call.thinking).toEqual({
            type: 'enabled',
            budget_tokens: 8_192,
        });
        // API 버전 2026-10-21은 sampling 파라미터를 400으로 거부하므로 스펙에
        // temperature가 있어도 보내지 않는다.
        expect(call).not.toHaveProperty('temperature');
    });

    it('omits the thinking block entirely when the budget is zero', async () => {
        mockStream.mockReturnValueOnce(
            makeStream({
                stop_reason: 'end_turn',
                content: [{ type: 'text', text: 'ok' }],
            })
        );

        await callClaude('prompt', {
            model: MODEL_BUDGET_THINKING,
            apiKey: 'key',
            reasoning: { budgetTokens: 0 },
        });

        const call = mockStream.mock.calls[0][0];
        expect(call).not.toHaveProperty('thinking');
        expect(call).not.toHaveProperty('temperature');
    });
});

// 이미 취소된 signal은 'abort' 이벤트를 다시 발생시키지 않는다. 리스너만 다는 전파로는
// 요청이 그대로 나가 비용·지연을 쓰므로, SDK 호출 전에 거부해야 한다.
describe('pre-aborted signal', () => {
    it('rejects with AbortError without calling the SDK', async () => {
        mockStream.mockClear();
        const controller = new AbortController();
        controller.abort();

        await expect(
            callClaude('prompt', {
                model: MODEL_WITH_EFFORT,
                apiKey: 'key',
                signal: controller.signal,
            })
        ).rejects.toMatchObject({ name: 'AbortError' });
        expect(mockStream).not.toHaveBeenCalled();
    });
});
