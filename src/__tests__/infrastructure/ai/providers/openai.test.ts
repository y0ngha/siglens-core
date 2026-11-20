import OpenAI from 'openai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callChatGPT } from '@/infrastructure/ai/providers/openai';
import type { ChatGPTModelId } from '@/domain/analysis/modelSpecs';
import { AI_SYSTEM_PROMPT } from '@/domain/analysis/systemPrompt';

const mockCreate = vi.hoisted(() => vi.fn());

vi.mock('openai', () => ({
    __esModule: true,
    default: vi.fn(function () {
        return {
            responses: {
                create: mockCreate,
            },
        };
    }),
}));

const mockedOpenAI = vi.mocked(OpenAI);

const MODEL: ChatGPTModelId = 'gpt-5.6-sol';

const SUCCESS = {
    status: 'completed',
    output_text: 'analysis result',
    incomplete_details: null,
};

describe('callChatGPT', () => {
    beforeEach(() => {
        mockCreate.mockClear();
    });

    it('returns output_text from completed response', async () => {
        mockCreate.mockResolvedValueOnce(SUCCESS);

        const result = await callChatGPT('prompt', {
            model: MODEL,
            apiKey: 'key',
        });

        expect(result).toBe('analysis result');
    });

    it('passes Responses API params correctly', async () => {
        mockCreate.mockResolvedValueOnce(SUCCESS);

        await callChatGPT('prompt', { model: MODEL, apiKey: 'key' });

        const call = mockCreate.mock.calls[0][0];
        expect(call.model).toBe('gpt-5.6-sol');
        expect(call.input).toBe('prompt');
        expect(call.instructions).toBeDefined();
        expect(call).not.toHaveProperty('temperature');
        expect(call.max_output_tokens).toBe(128_000);
        expect(call.text).toEqual({ format: { type: 'json_object' } });
        expect(call).not.toHaveProperty('messages');
        expect(call).not.toHaveProperty('max_completion_tokens');
    });

    it('uses json_object format when responseSchema is absent (backward-compat)', async () => {
        mockCreate.mockResolvedValueOnce(SUCCESS);

        await callChatGPT('prompt', { model: MODEL, apiKey: 'key' });

        const call = mockCreate.mock.calls[0][0];
        expect(call.text).toEqual({ format: { type: 'json_object' } });
    });

    it('enforces strict json_schema format when responseSchema is present', async () => {
        mockCreate.mockResolvedValueOnce(SUCCESS);

        const schema = {
            type: 'object',
            properties: { verdict: { type: 'string' } },
            required: ['verdict'],
            additionalProperties: false,
        };

        await callChatGPT('prompt', {
            model: MODEL,
            apiKey: 'key',
            responseSchema: schema,
        });

        const call = mockCreate.mock.calls[0][0];
        expect(call.text.format.type).toBe('json_schema');
        expect(call.text.format.strict).toBe(true);
        expect(call.text.format.name).toBe('analysis_response');
        // schema는 가공 없이 그대로 전달된다.
        expect(call.text.format.schema).toBe(schema);
    });

    it('passes reasoning.effort from spec', async () => {
        mockCreate.mockResolvedValueOnce(SUCCESS);

        await callChatGPT('prompt', { model: MODEL, apiKey: 'key' });

        // gpt-5.6-sol spec.effort = 'high' → reasoning: { effort: 'high' }으로 전달
        expect(mockCreate.mock.calls[0][0].reasoning).toEqual({
            effort: 'high',
        });
    });

    it("passes the spec's default effort for gpt-6-luna", async () => {
        mockCreate.mockResolvedValueOnce({ ...SUCCESS, output_text: 'ok' });

        await callChatGPT('prompt', { model: 'gpt-6-luna', apiKey: 'key' });

        // Free-class model → `reasoning.default: 'off'` → `effort: 'none'`.
        expect(mockCreate.mock.calls[0][0].reasoning).toEqual({
            effort: 'none',
        });
    });

    // Reasoning toggle: options.effort overrides spec.effort.
    describe('effort override (reasoning toggle)', () => {
        it('uses the effort override when provided (low), instead of spec.effort (high)', async () => {
            mockCreate.mockResolvedValueOnce(SUCCESS);

            await callChatGPT('prompt', {
                model: MODEL, // gpt-5.6-sol spec.effort = 'high'
                apiKey: 'key',
                reasoning: { effort: 'low' },
            });

            expect(mockCreate.mock.calls[0][0].reasoning).toEqual({
                effort: 'low',
            });
            expect(mockCreate.mock.calls[0][0]).not.toHaveProperty(
                'temperature'
            );
        });

        it('falls back to spec.effort when the override is omitted', async () => {
            mockCreate.mockResolvedValueOnce(SUCCESS);

            await callChatGPT('prompt', { model: MODEL, apiKey: 'key' });

            expect(mockCreate.mock.calls[0][0].reasoning).toEqual({
                effort: 'high',
            });
        });
    });

    it('throws non-retryable error when status is incomplete/max_output_tokens', async () => {
        mockCreate.mockResolvedValueOnce({
            status: 'incomplete',
            output_text: '',
            incomplete_details: { reason: 'max_output_tokens' },
        });

        const promise = callChatGPT('prompt', { model: MODEL, apiKey: 'key' });

        await expect(promise).rejects.toThrow(/output token limit/);
        await expect(promise).rejects.not.toMatchObject({ retryable: true });
    });

    it('throws non-retryable error when status is incomplete/content_filter', async () => {
        mockCreate.mockResolvedValueOnce({
            status: 'incomplete',
            output_text: '',
            incomplete_details: { reason: 'content_filter' },
        });

        const promise = callChatGPT('prompt', { model: MODEL, apiKey: 'key' });

        await expect(promise).rejects.toThrow(/content filter/);
        await expect(promise).rejects.not.toMatchObject({ retryable: true });
    });

    // W3: status: 'failed'은 error.code에 따라 retryable 여부를 분류한다.
    // 일시적 서버 측 실패(server_error/rate_limit_exceeded/vector_store_timeout)만 재시도.
    it('throws RETRYABLE error when status is failed with transient server_error code', async () => {
        mockCreate.mockResolvedValueOnce({
            status: 'failed',
            output_text: '',
            incomplete_details: null,
            error: { code: 'server_error', message: 'internal error' },
        });

        const promise = callChatGPT('prompt', { model: MODEL, apiKey: 'key' });
        // 메시지와 retryable 플래그를 둘 다 검증한다 (falsifiable).
        await expect(promise).rejects.toThrow(
            /ChatGPT response failed.*code: server_error/
        );
        await expect(promise).rejects.toMatchObject({ retryable: true });
    });

    it('throws RETRYABLE error when status is failed with rate_limit_exceeded code', async () => {
        mockCreate.mockResolvedValueOnce({
            status: 'failed',
            output_text: '',
            incomplete_details: null,
            error: { code: 'rate_limit_exceeded', message: 'slow down' },
        });

        const promise = callChatGPT('prompt', { model: MODEL, apiKey: 'key' });
        await expect(promise).rejects.toThrow(/code: rate_limit_exceeded/);
        await expect(promise).rejects.toMatchObject({ retryable: true });
    });

    it('throws NON-retryable error when status is failed with invalid_prompt code', async () => {
        mockCreate.mockResolvedValueOnce({
            status: 'failed',
            output_text: '',
            incomplete_details: null,
            error: { code: 'invalid_prompt', message: 'bad request' },
        });

        const promise = callChatGPT('prompt', { model: MODEL, apiKey: 'key' });
        // 결정론적 실패 → 메시지에 code가 담기고, retryable 플래그는 없어야 한다.
        await expect(promise).rejects.toThrow(/code: invalid_prompt/);
        await expect(promise).rejects.not.toMatchObject({ retryable: true });
    });

    it('throws NON-retryable error when status is failed with image-validation code', async () => {
        mockCreate.mockResolvedValueOnce({
            status: 'failed',
            output_text: '',
            incomplete_details: null,
            error: { code: 'invalid_image_format', message: 'bad image' },
        });

        const promise = callChatGPT('prompt', { model: MODEL, apiKey: 'key' });
        await expect(promise).rejects.toThrow(/code: invalid_image_format/);
        await expect(promise).rejects.not.toMatchObject({ retryable: true });
    });

    it('throws NON-retryable error when status is failed with no error code', async () => {
        mockCreate.mockResolvedValueOnce({
            status: 'failed',
            output_text: '',
            incomplete_details: null,
            error: null,
        });

        const promise = callChatGPT('prompt', { model: MODEL, apiKey: 'key' });
        await expect(promise).rejects.toThrow(/code: unknown/);
        await expect(promise).rejects.not.toMatchObject({ retryable: true });
    });

    it('throws retryable error when status is incomplete with unknown reason', async () => {
        mockCreate.mockResolvedValueOnce({
            status: 'incomplete',
            output_text: '',
            incomplete_details: { reason: undefined },
        });

        await expect(
            callChatGPT('prompt', { model: MODEL, apiKey: 'key' })
        ).rejects.toMatchObject({ retryable: true });
    });

    it('throws retryable error for unexpected status (in_progress)', async () => {
        mockCreate.mockResolvedValueOnce({
            status: 'in_progress',
            output_text: '',
            incomplete_details: null,
        });

        await expect(
            callChatGPT('prompt', { model: MODEL, apiKey: 'key' })
        ).rejects.toMatchObject({ retryable: true });
    });

    it('throws retryable error when completed returns empty output_text', async () => {
        mockCreate.mockResolvedValueOnce({
            status: 'completed',
            output_text: '',
            incomplete_details: null,
        });

        await expect(
            callChatGPT('prompt', { model: MODEL, apiKey: 'key' })
        ).rejects.toMatchObject({ retryable: true });
    });

    it('propagates abort from external signal to underlying SDK call', async () => {
        let receivedSignal: AbortSignal | undefined;
        mockCreate.mockImplementationOnce(
            async (_params: unknown, options: { signal?: AbortSignal }) => {
                receivedSignal = options?.signal;
                externalController.abort();
                return SUCCESS;
            }
        );

        const externalController = new AbortController();
        await callChatGPT('prompt', {
            model: MODEL,
            apiKey: 'key',
            signal: externalController.signal,
        });

        expect(receivedSignal).toBeDefined();
        expect(receivedSignal!.aborted).toBe(true);
    });

    it('reuses cached client across calls with the same apiKey', async () => {
        mockedOpenAI.mockClear();
        mockCreate.mockResolvedValue(SUCCESS);

        await callChatGPT('prompt1', { model: MODEL, apiKey: 'shared-key' });
        await callChatGPT('prompt2', { model: MODEL, apiKey: 'shared-key' });

        expect(mockedOpenAI.mock.calls.length).toBeLessThanOrEqual(1);
    });
});

describe('callChatGPT — usage telemetry', () => {
    beforeEach(() => {
        mockCreate.mockClear();
    });

    it('logs normalized [Usage] when jobId is provided (Responses API usage shape)', async () => {
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

        mockCreate.mockResolvedValueOnce({
            ...SUCCESS,
            usage: {
                input_tokens: 2000,
                input_tokens_details: { cached_tokens: 1500 },
                output_tokens: 80,
            },
        });

        await callChatGPT('prompt', {
            model: MODEL,
            apiKey: 'key',
            jobId: 'job-789',
        });

        expect(infoSpy).toHaveBeenCalledTimes(1);
        const [tag, payload] = infoSpy.mock.calls[0];
        expect(tag).toBe('[Usage]');
        expect(JSON.parse(payload as string)).toMatchObject({
            jobId: 'job-789',
            model: MODEL,
            promptTokens: 500,
            cachedTokens: 1500,
            cacheWriteTokens: 0,
            outputTokens: 80,
        });

        infoSpy.mockRestore();
    });

    it('does not log usage when jobId is omitted', async () => {
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

        mockCreate.mockResolvedValueOnce(SUCCESS);

        await callChatGPT('prompt', { model: MODEL, apiKey: 'key' });

        expect(infoSpy).not.toHaveBeenCalled();
        infoSpy.mockRestore();
    });
});

/** The body the adapter put on the wire for the most recent call. */
function lastSentBody(): Record<string, unknown> {
    const last = mockCreate.mock.lastCall;
    if (last === undefined) throw new Error('create was not called');
    return last[0] as Record<string, unknown>;
}

// GPT-6.2 rows send the system prompt as a leading `developer` input message
// (per vendor docs read 2026-11-21, not yet measured) so it stays inside the
// cacheable prefix; every other row keeps top-level `instructions`.
describe.each(['gpt-6.2-sol', 'gpt-6.2-astra'] as const)(
    'callChatGPT request shape — %s',
    model => {
        beforeEach(() => {
            mockCreate.mockClear();
        });

        it('sends the system prompt as the first developer input item and no instructions', async () => {
            mockCreate.mockResolvedValueOnce(SUCCESS);

            await callChatGPT('the prompt', { model, apiKey: 'key' });

            const body = lastSentBody();
            expect(body).not.toHaveProperty('instructions');
            expect(body.model).toBe(model);
            expect(body.input).toEqual([
                { role: 'developer', content: AI_SYSTEM_PROMPT },
                { role: 'user', content: 'the prompt' },
            ]);
            expect(body.reasoning).toEqual({ effort: 'high' });
            expect(body.max_output_tokens).toBe(128_000);
            expect(body.text).toEqual({ format: { type: 'json_object' } });
            expect(body).not.toHaveProperty('temperature');
        });

        it('sends effort low for the off state', async () => {
            mockCreate.mockResolvedValueOnce(SUCCESS);

            await callChatGPT('prompt', {
                model,
                apiKey: 'key',
                reasoning: { effort: 'low' },
            });

            expect(lastSentBody().reasoning).toEqual({ effort: 'low' });
        });

        it('keeps strict json_schema when responseSchema is present', async () => {
            mockCreate.mockResolvedValueOnce(SUCCESS);
            const schema = { type: 'object', properties: {} };

            await callChatGPT('prompt', {
                model,
                apiKey: 'key',
                responseSchema: schema,
            });

            expect(lastSentBody().text).toEqual({
                format: {
                    type: 'json_schema',
                    name: 'analysis_response',
                    strict: true,
                    schema,
                },
            });
        });

        it('puts a caller system override in the developer item', async () => {
            mockCreate.mockResolvedValueOnce(SUCCESS);

            await callChatGPT('prompt', {
                model,
                apiKey: 'key',
                system: 'custom system',
            });

            const body = lastSentBody();
            expect(body).not.toHaveProperty('instructions');
            expect(body.input).toEqual([
                { role: 'developer', content: 'custom system' },
                { role: 'user', content: 'prompt' },
            ]);
        });
    }
);

describe('callChatGPT request shape — rows without systemPlacement', () => {
    beforeEach(() => {
        mockCreate.mockClear();
    });

    it.each(['gpt-6-sol', 'gpt-5.6-sol'] as const)(
        'keeps top-level instructions and a string input for %s',
        async model => {
            mockCreate.mockResolvedValueOnce(SUCCESS);

            await callChatGPT('the prompt', {
                model,
                apiKey: 'key',
                system: 'custom system',
            });

            const body = lastSentBody();
            expect(body.instructions).toBe('custom system');
            expect(body.input).toBe('the prompt');
        }
    );
});

// 이미 취소된 signal은 'abort' 이벤트를 다시 발생시키지 않는다. 리스너만 다는 전파로는
// 요청이 그대로 나가 비용·지연을 쓰므로, SDK 호출 전에 거부해야 한다.
describe('pre-aborted signal', () => {
    it('rejects with AbortError without calling the SDK', async () => {
        mockCreate.mockClear();
        const controller = new AbortController();
        controller.abort();

        await expect(
            callChatGPT('prompt', {
                model: MODEL,
                apiKey: 'key',
                signal: controller.signal,
            })
        ).rejects.toMatchObject({ name: 'AbortError' });
        expect(mockCreate).not.toHaveBeenCalled();
    });
});
