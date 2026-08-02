import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callGemini } from '@/infrastructure/ai/providers/gemini';
import {
    callGeminiReducingBudget,
    callGeminiWithRetry,
} from '@/infrastructure/ai/retry/geminiRetry';
import type { GeminiModelId } from '@/domain/analysis/modelSpecs';
import {
    AI_RETRY_DELAY_MS,
    withRetry,
} from '@/infrastructure/ai/retry/withRetry';

vi.mock('@/infrastructure/ai/providers/gemini', () => ({
    callGemini: vi.fn(),
    MAX_TOKENS_CODE: 'GEMINI_MAX_TOKENS',
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

// vi.mock('@/infrastructure/ai/providers/gemini', ...) 호출로 런타임 타입이 MockedFunction임이 보장됨
const mockCallGemini = vi.mocked(callGemini);
const mockWithRetry = vi.mocked(withRetry);

// flash-lite의 기본 thinking budget=8192을 그대로 활용한다.
const MODEL: GeminiModelId = 'gemini-2.5-flash-lite';

describe('gemini-retry', () => {
    let MAX_TOKENS_ERROR: Error & { code: string };
    let SERVER_ERROR: Error & { status: number };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.restoreAllMocks();
        MAX_TOKENS_ERROR = Object.assign(new Error('MAX_TOKENS'), {
            code: 'GEMINI_MAX_TOKENS',
        });
        SERVER_ERROR = Object.assign(new Error('5xx'), { status: 503 });
    });

    describe('callGeminiReducingBudget', () => {
        it('returns result on successful first call', async () => {
            mockCallGemini.mockResolvedValueOnce('result');

            const budgetRef = { current: 24576 };
            const result = await callGeminiReducingBudget(
                'prompt',
                MODEL,
                'key',
                undefined,
                budgetRef
            );

            expect(result).toBe('result');
            expect(mockCallGemini).toHaveBeenCalledWith(
                'prompt',
                expect.objectContaining({ thinkingBudget: 24576 })
            );
        });

        it('reduces budget on MAX_TOKENS and retries with next step', async () => {
            mockCallGemini
                .mockRejectedValueOnce(MAX_TOKENS_ERROR)
                .mockResolvedValueOnce('result');

            const budgetRef = { current: 24576 };
            const result = await callGeminiReducingBudget(
                'prompt',
                MODEL,
                'key',
                undefined,
                budgetRef
            );

            expect(result).toBe('result');
            expect(mockCallGemini).toHaveBeenNthCalledWith(
                1,
                'prompt',
                expect.objectContaining({ thinkingBudget: 24576 })
            );
            expect(mockCallGemini).toHaveBeenNthCalledWith(
                2,
                'prompt',
                expect.objectContaining({ thinkingBudget: 12288 })
            );
        });

        it('falls through two halving steps before reaching THINKING_BUDGET_FALLBACK_STEPS', async () => {
            // 24576 → 12288 → 6144 → 4096 → 2048 → 0
            // First two halvings exhaust before standard steps engage.
            mockCallGemini
                .mockRejectedValueOnce(MAX_TOKENS_ERROR) // 24576
                .mockRejectedValueOnce(MAX_TOKENS_ERROR) // 12288
                .mockResolvedValueOnce('result'); // 6144

            const budgetRef = { current: 24576 };
            const result = await callGeminiReducingBudget(
                'prompt',
                MODEL,
                'key',
                undefined,
                budgetRef
            );

            expect(result).toBe('result');
            expect(mockCallGemini).toHaveBeenNthCalledWith(
                3,
                'prompt',
                expect.objectContaining({ thinkingBudget: 6144 })
            );
            expect(budgetRef.current).toBe(6144);
        });

        it('throws when MAX_TOKENS occurs with thinking disabled (budget=0)', async () => {
            mockCallGemini.mockRejectedValue(MAX_TOKENS_ERROR);

            const budgetRef = { current: 0 };
            await expect(
                callGeminiReducingBudget(
                    'prompt',
                    MODEL,
                    'key',
                    undefined,
                    budgetRef
                )
            ).rejects.toThrow('MAX_TOKENS');
        });

        it('propagates 5xx error and preserves current budget in budgetRef', async () => {
            mockCallGemini.mockRejectedValueOnce(SERVER_ERROR);

            const budgetRef = { current: 24576 };
            await expect(
                callGeminiReducingBudget(
                    'prompt',
                    MODEL,
                    'key',
                    undefined,
                    budgetRef
                )
            ).rejects.toEqual(SERVER_ERROR);

            // budgetRef reflects the budget being tried when 5xx occurred
            expect(budgetRef.current).toBe(24576);
        });

        it('propagates null error (isMaxTokensError: null path)', async () => {
            mockCallGemini.mockRejectedValueOnce(null);

            const budgetRef = { current: 24576 };
            await expect(
                callGeminiReducingBudget(
                    'prompt',
                    MODEL,
                    'key',
                    undefined,
                    budgetRef
                )
            ).rejects.toBeNull();
        });

        it('propagates string error (isMaxTokensError: non-object path)', async () => {
            mockCallGemini.mockRejectedValueOnce('unexpected string error');

            const budgetRef = { current: 24576 };
            await expect(
                callGeminiReducingBudget(
                    'prompt',
                    MODEL,
                    'key',
                    undefined,
                    budgetRef
                )
            ).rejects.toBe('unexpected string error');
        });

        it('preserves reduced budget in budgetRef when 5xx follows MAX_TOKENS', async () => {
            // Sequence: MAX_TOKENS at 24576 → continues to 12288 → 5xx at 12288
            mockCallGemini
                .mockRejectedValueOnce(MAX_TOKENS_ERROR)
                .mockRejectedValueOnce(SERVER_ERROR);

            const budgetRef = { current: 24576 };
            await expect(
                callGeminiReducingBudget(
                    'prompt',
                    MODEL,
                    'key',
                    undefined,
                    budgetRef
                )
            ).rejects.toEqual(SERVER_ERROR);

            // Must be 12288 (reduced), not 24576 (initial)
            // withRetry's next attempt will start from this reduced budget
            expect(budgetRef.current).toBe(12288);
        });
    });

    describe('callGeminiWithRetry', () => {
        it('delegates to withRetry with the configured retry policy', async () => {
            mockCallGemini.mockResolvedValueOnce('result');

            await callGeminiWithRetry('prompt', MODEL, 'key', {
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

        // W1: 분석 경로 cap(30s)을 그대로 withRetry로 전달해야 한다.
        it('forwards the analysis cumulative-delay cap (30s) to withRetry', async () => {
            mockCallGemini.mockResolvedValueOnce('result');

            await callGeminiWithRetry('prompt', MODEL, 'key', {
                abortIfCumulativeDelayReachesMs: 30_000,
            });

            expect(mockWithRetry).toHaveBeenCalledWith(
                expect.any(Function),
                expect.objectContaining({
                    abortIfCumulativeDelayReachesMs: 30_000,
                })
            );
        });

        // W1: 브리핑 경로 cap(10s)을 그대로 withRetry로 전달해야 한다.
        it('forwards the briefing cumulative-delay cap (10s) to withRetry', async () => {
            mockCallGemini.mockResolvedValueOnce('result');

            await callGeminiWithRetry('prompt', MODEL, 'key', {
                abortIfCumulativeDelayReachesMs: 10_000,
            });

            expect(mockWithRetry).toHaveBeenCalledWith(
                expect.any(Function),
                expect.objectContaining({
                    abortIfCumulativeDelayReachesMs: 10_000,
                })
            );
        });

        // W1 회귀 가드: cap 미지정 시 undefined를 넘겨, withRetry가 default 5분 상한으로
        // 떨어지는 동작(=4562cc2가 유발한 회귀)을 명시적으로 문서화한다.
        it('forwards undefined cap when omitted (withRetry then applies its 5min default)', async () => {
            mockCallGemini.mockResolvedValueOnce('result');

            await callGeminiWithRetry('prompt', MODEL, 'key');

            expect(mockWithRetry).toHaveBeenCalledWith(
                expect.any(Function),
                expect.objectContaining({
                    abortIfCumulativeDelayReachesMs: undefined,
                })
            );
        });

        it('uses provided budgetRef as starting budget', async () => {
            mockCallGemini.mockResolvedValueOnce('result');

            const budgetRef = { current: 12288 };
            await callGeminiWithRetry('prompt', MODEL, 'paid-key', {
                budgetRef,
            });

            expect(mockCallGemini).toHaveBeenCalledWith(
                'prompt',
                expect.objectContaining({ thinkingBudget: 12288 })
            );
        });

        it('creates new budgetRef from MODEL_SPECS[model].thinkingBudget when not provided', async () => {
            mockCallGemini.mockResolvedValueOnce('result');

            await callGeminiWithRetry('prompt', MODEL, 'key');

            expect(mockCallGemini).toHaveBeenCalledWith(
                'prompt',
                expect.objectContaining({ thinkingBudget: 8192 })
            );
        });

        it('forwards responseSchema to callGemini when provided', async () => {
            mockCallGemini.mockResolvedValueOnce('result');

            const responseSchema = { type: 'object' };
            await callGeminiWithRetry('prompt', MODEL, 'key', {
                responseSchema,
            });

            expect(mockCallGemini).toHaveBeenCalledWith(
                'prompt',
                expect.objectContaining({ responseSchema })
            );
        });

        it('forwards seed to callGemini when provided', async () => {
            mockCallGemini.mockResolvedValueOnce('result');

            await callGeminiWithRetry('prompt', MODEL, 'key', { seed: 7 });

            expect(mockCallGemini).toHaveBeenCalledWith(
                'prompt',
                expect.objectContaining({ seed: 7 })
            );
        });

        it('omits seed (passes undefined) when seed is absent (backward-compat)', async () => {
            mockCallGemini.mockResolvedValueOnce('result');

            await callGeminiWithRetry('prompt', MODEL, 'key');

            expect(mockCallGemini).toHaveBeenCalledWith(
                'prompt',
                expect.objectContaining({ seed: undefined })
            );
        });
    });
});
