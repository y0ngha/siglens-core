import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callClaude } from '@/infrastructure/ai/providers/anthropic';
import { callClaudeWithRetry } from '@/infrastructure/ai/retry/anthropicRetry';
import type { ClaudeModelId } from '@/domain/analysis/modelSpecs';
import {
    AI_RETRY_DELAY_MS,
    withRetry,
} from '@/infrastructure/ai/retry/withRetry';

vi.mock('@/infrastructure/ai/providers/anthropic', () => ({
    callClaude: vi.fn(),
    MAX_TOKENS_CODE: 'CLAUDE_MAX_TOKENS',
}));

vi.mock('@/infrastructure/ai/retry/withRetry', () => ({
    withRetry: vi.fn(async <T>(fn: () => Promise<T>): Promise<T> => fn()),
    AI_RETRY_MAX_ATTEMPTS: 5,
    AI_RETRY_DELAY_MS: 5000,
    hasErrorCode: (error: unknown, code: string): boolean =>
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code: unknown }).code === code,
}));

const mockCallClaude = vi.mocked(callClaude);
const mockWithRetry = vi.mocked(withRetry);

const MODEL: ClaudeModelId = 'claude-opus-4-7';

describe('callClaudeWithRetry', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns result on successful call', async () => {
        mockCallClaude.mockResolvedValueOnce('result');

        const result = await callClaudeWithRetry('prompt', MODEL, 'key');

        expect(result).toBe('result');
        expect(mockCallClaude).toHaveBeenCalledWith(
            'prompt',
            expect.objectContaining({ model: MODEL, apiKey: 'key' })
        );
    });

    it('delegates to withRetry with the configured retry policy', async () => {
        mockCallClaude.mockResolvedValueOnce('result');

        await callClaudeWithRetry('prompt', MODEL, 'key', {
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

    it('passes effort option to callClaude', async () => {
        mockCallClaude.mockResolvedValueOnce('result');

        await callClaudeWithRetry('prompt', MODEL, 'key', { effort: 'low' });

        expect(mockCallClaude).toHaveBeenCalledWith(
            'prompt',
            expect.objectContaining({ effort: 'low' })
        );
    });

    it('passes responseSchema to callClaude', async () => {
        mockCallClaude.mockResolvedValueOnce('result');

        const schema = { type: 'object', properties: {} };
        await callClaudeWithRetry('prompt', MODEL, 'key', {
            responseSchema: schema,
        });

        expect(mockCallClaude).toHaveBeenCalledWith(
            'prompt',
            expect.objectContaining({ responseSchema: schema })
        );
    });

    it('passes signal to callClaude', async () => {
        mockCallClaude.mockResolvedValueOnce('result');

        const controller = new AbortController();
        await callClaudeWithRetry('prompt', MODEL, 'key', {
            signal: controller.signal,
        });

        expect(mockCallClaude).toHaveBeenCalledWith(
            'prompt',
            expect.objectContaining({ signal: controller.signal })
        );
    });

    it('propagates MAX_TOKENS error without retry', async () => {
        const maxTokensError = Object.assign(new Error('MAX_TOKENS'), {
            code: 'CLAUDE_MAX_TOKENS',
        });
        mockCallClaude.mockRejectedValueOnce(maxTokensError);

        await expect(
            callClaudeWithRetry('prompt', MODEL, 'key')
        ).rejects.toMatchObject({ code: 'CLAUDE_MAX_TOKENS' });

        // withRetry는 MAX_TOKENS를 retryable로 분류하지 않으므로 callClaude는 1회만 호출된다.
        expect(mockCallClaude).toHaveBeenCalledTimes(1);
    });
});
