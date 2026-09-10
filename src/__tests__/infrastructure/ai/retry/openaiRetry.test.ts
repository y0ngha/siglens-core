import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callChatGPT } from '@/infrastructure/ai/providers/openai';
import { callChatGPTWithRetry } from '@/infrastructure/ai/retry/openaiRetry';
import type { ChatGPTModelId } from '@/domain/analysis/modelSpecs';
import {
    AI_RETRY_DELAY_MS,
    withRetry,
} from '@/infrastructure/ai/retry/withRetry';

vi.mock('@/infrastructure/ai/providers/openai', () => ({
    callChatGPT: vi.fn(),
}));

vi.mock('@/infrastructure/ai/retry/withRetry', () => ({
    withRetry: vi.fn(async <T>(fn: () => Promise<T>): Promise<T> => fn()),
    AI_RETRY_MAX_ATTEMPTS: 5,
    AI_RETRY_DELAY_MS: 5000,
}));

const mockCallChatGPT = vi.mocked(callChatGPT);
const mockWithRetry = vi.mocked(withRetry);

const MODEL: ChatGPTModelId = 'gpt-5.6-luna';

describe('callChatGPTWithRetry', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('delegates to withRetry with the configured retry policy', async () => {
        mockCallChatGPT.mockResolvedValueOnce('result');

        await callChatGPTWithRetry('prompt', MODEL, 'key', {
            maxAttempts: 7,
            abortIfCumulativeDelayReachesMs: 15000,
        });

        expect(mockWithRetry).toHaveBeenCalledWith(
            expect.any(Function),
            expect.objectContaining({
                maxAttempts: 7,
                baseDelayMs: AI_RETRY_DELAY_MS,
                abortIfCumulativeDelayReachesMs: 15000,
            })
        );
    });

    it('forwards model, apiKey, and signal to callChatGPT', async () => {
        mockCallChatGPT.mockResolvedValueOnce('result');

        const signal = new AbortController().signal;
        await callChatGPTWithRetry('prompt', MODEL, 'paid-key', { signal });

        expect(mockCallChatGPT).toHaveBeenCalledWith('prompt', {
            model: MODEL,
            apiKey: 'paid-key',
            signal,
        });
    });

    it('forwards responseSchema to callChatGPT when provided', async () => {
        mockCallChatGPT.mockResolvedValueOnce('result');

        const responseSchema = { type: 'object' };
        await callChatGPTWithRetry('prompt', MODEL, 'key', { responseSchema });

        expect(mockCallChatGPT).toHaveBeenCalledWith(
            'prompt',
            expect.objectContaining({ responseSchema })
        );
    });

    it('returns result from callChatGPT through withRetry', async () => {
        mockCallChatGPT.mockResolvedValueOnce('chat-result');

        const result = await callChatGPTWithRetry('prompt', MODEL, 'key');

        expect(result).toBe('chat-result');
    });

    it('propagates errors from callChatGPT', async () => {
        const error = new Error('upstream failure');
        mockCallChatGPT.mockRejectedValueOnce(error);

        await expect(
            callChatGPTWithRetry('prompt', MODEL, 'key')
        ).rejects.toThrow('upstream failure');
    });

    it('uses default maxAttempts when not provided', async () => {
        mockCallChatGPT.mockResolvedValueOnce('result');

        await callChatGPTWithRetry('prompt', MODEL, 'key');

        expect(mockWithRetry).toHaveBeenCalledWith(
            expect.any(Function),
            expect.objectContaining({
                maxAttempts: 5,
                baseDelayMs: AI_RETRY_DELAY_MS,
            })
        );
    });
});
