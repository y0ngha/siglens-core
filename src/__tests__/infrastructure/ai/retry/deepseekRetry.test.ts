import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callDeepSeek } from '@/infrastructure/ai/providers/deepseek';
import {
    callDeepSeekWithRetry,
    classifyDeepSeekError,
} from '@/infrastructure/ai/retry/deepseekRetry';
import type { DeepSeekModelId } from '@/domain/analysis/modelSpecs';
import {
    AI_RETRY_DELAY_MS,
    withRetry,
} from '@/infrastructure/ai/retry/withRetry';

vi.mock('@/infrastructure/ai/providers/deepseek', () => ({
    callDeepSeek: vi.fn(),
}));

vi.mock('@/infrastructure/ai/retry/withRetry', async importOriginal => ({
    // 분류기는 실물을 쓴다 — classifyDeepSeekError가 classifyError에 위임하므로.
    classifyError: (
        await importOriginal<
            typeof import('@/infrastructure/ai/retry/withRetry')
        >()
    ).classifyError,
    withRetry: vi.fn(async <T>(fn: () => Promise<T>): Promise<T> => fn()),
    AI_RETRY_MAX_ATTEMPTS: 5,
    AI_RETRY_DELAY_MS: 5000,
}));

const mockCallDeepSeek = vi.mocked(callDeepSeek);
const mockWithRetry = vi.mocked(withRetry);

const MODEL: DeepSeekModelId = 'deepseek-v4.1-pro';

describe('callDeepSeekWithRetry', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('delegates to withRetry with the configured retry policy', async () => {
        mockCallDeepSeek.mockResolvedValueOnce('result');

        await callDeepSeekWithRetry('prompt', MODEL, 'key', {
            maxAttempts: 7,
            abortIfCumulativeDelayReachesMs: 15000,
        });

        expect(mockWithRetry).toHaveBeenCalledWith(
            expect.any(Function),
            expect.objectContaining({
                maxAttempts: 7,
                baseDelayMs: AI_RETRY_DELAY_MS,
                abortIfCumulativeDelayReachesMs: 15000,
                classify: classifyDeepSeekError,
            })
        );
    });

    it('forwards model, apiKey, and signal to callDeepSeek', async () => {
        mockCallDeepSeek.mockResolvedValueOnce('result');

        const signal = new AbortController().signal;
        await callDeepSeekWithRetry('prompt', MODEL, 'paid-key', { signal });

        expect(mockCallDeepSeek).toHaveBeenCalledWith('prompt', {
            model: MODEL,
            apiKey: 'paid-key',
            signal,
        });
    });

    it('forwards responseSchema to callDeepSeek when provided', async () => {
        mockCallDeepSeek.mockResolvedValueOnce('result');

        const responseSchema = { type: 'object' };
        await callDeepSeekWithRetry('prompt', MODEL, 'key', {
            responseSchema,
        });

        expect(mockCallDeepSeek).toHaveBeenCalledWith(
            'prompt',
            expect.objectContaining({ responseSchema })
        );
    });

    it('returns result from callDeepSeek through withRetry', async () => {
        mockCallDeepSeek.mockResolvedValueOnce('deepseek-result');

        const result = await callDeepSeekWithRetry('prompt', MODEL, 'key');

        expect(result).toBe('deepseek-result');
    });

    it('propagates errors from callDeepSeek', async () => {
        const error = new Error('upstream failure');
        mockCallDeepSeek.mockRejectedValueOnce(error);

        await expect(
            callDeepSeekWithRetry('prompt', MODEL, 'key')
        ).rejects.toThrow('upstream failure');
    });

    it('uses default maxAttempts when not provided', async () => {
        mockCallDeepSeek.mockResolvedValueOnce('result');

        await callDeepSeekWithRetry('prompt', MODEL, 'key');

        expect(mockWithRetry).toHaveBeenCalledWith(
            expect.any(Function),
            expect.objectContaining({
                maxAttempts: 5,
                baseDelayMs: AI_RETRY_DELAY_MS,
            })
        );
    });
});

describe('classifyDeepSeekError', () => {
    // 클라이언트가 maxRetries: 0이므로, SDK가 재시도하던 조건이 모두 withRetry에 걸려야 한다.
    it.each([
        [408, 'server_error'],
        [409, 'server_error'],
        [429, 'rate_limit'],
        [500, 'server_error'],
        [503, 'server_error'],
    ] as const)('status %i는 %s로 분류한다', (status, kind) => {
        expect(classifyDeepSeekError({ status })).toBe(kind);
    });

    it('callDeepSeek가 retryable을 붙인 연결 오류(status 없음)는 retryable이다', () => {
        expect(classifyDeepSeekError({ retryable: true })).toBe('retryable');
    });

    it.each([400, 401, 404, 422])('status %i는 재시도하지 않는다', status => {
        expect(classifyDeepSeekError({ status })).toBe('none');
    });

    it('status도 retryable도 없는 오류(호출자 abort 등)는 재시도하지 않는다', () => {
        expect(classifyDeepSeekError(new Error('Request was aborted.'))).toBe(
            'none'
        );
        expect(classifyDeepSeekError(null)).toBe('none');
    });
});
