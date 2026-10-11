import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callGemini } from '@/infrastructure/ai/providers/gemini';
import {
    callGeminiReducingLevel,
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

/**
 * Free 등급 flash-lite — `reasoning.off`가 `'minimal'`이라 축소 시퀀스의 바닥이
 * `'minimal'`이고, 기본 상태(`default: 'off'`)도 `'minimal'`이다.
 */
const MODEL: GeminiModelId = 'gemini-3.5-flash-lite';

/**
 * 바닥이 `'low'`인 모델 — `'minimal'`을 400으로 거부한다(2026-09-06 실측).
 * 축소 시퀀스가 모델별 바닥을 존중하는지 검증하는 데 쓴다.
 */
const MODEL_FLOOR_LOW: GeminiModelId = 'gemini-3.8-flash';

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

    describe('callGeminiReducingLevel', () => {
        it('returns result on successful first call', async () => {
            mockCallGemini.mockResolvedValueOnce('result');

            const levelRef = { current: 'high' as const };
            const result = await callGeminiReducingLevel(
                'prompt',
                MODEL,
                'key',
                undefined,
                levelRef
            );

            expect(result).toBe('result');
            expect(mockCallGemini).toHaveBeenCalledWith(
                'prompt',
                expect.objectContaining({ thinkingLevel: 'high' })
            );
        });

        it('steps the level down one notch on MAX_TOKENS and retries', async () => {
            mockCallGemini
                .mockRejectedValueOnce(MAX_TOKENS_ERROR)
                .mockResolvedValueOnce('result');

            const levelRef = { current: 'high' as const };
            const result = await callGeminiReducingLevel(
                'prompt',
                MODEL,
                'key',
                undefined,
                levelRef
            );

            expect(result).toBe('result');
            expect(mockCallGemini).toHaveBeenNthCalledWith(
                1,
                'prompt',
                expect.objectContaining({ thinkingLevel: 'high' })
            );
            expect(mockCallGemini).toHaveBeenNthCalledWith(
                2,
                'prompt',
                expect.objectContaining({ thinkingLevel: 'medium' })
            );
        });

        it('descends high → medium → low → minimal for a model whose floor is minimal', async () => {
            mockCallGemini
                .mockRejectedValueOnce(MAX_TOKENS_ERROR) // high
                .mockRejectedValueOnce(MAX_TOKENS_ERROR) // medium
                .mockResolvedValueOnce('result'); // low

            const levelRef = { current: 'high' as const };
            const result = await callGeminiReducingLevel(
                'prompt',
                MODEL,
                'key',
                undefined,
                levelRef
            );

            expect(result).toBe('result');
            expect(mockCallGemini).toHaveBeenNthCalledWith(
                3,
                'prompt',
                expect.objectContaining({ thinkingLevel: 'low' })
            );
            expect(levelRef.current).toBe('low');
        });

        it("stops at the model's own floor rather than a global minimum", async () => {
            // gemini-3.8-flash rejects 'minimal', so the sequence must end at 'low'.
            mockCallGemini.mockRejectedValue(MAX_TOKENS_ERROR);

            const levelRef = { current: 'high' as const };
            await expect(
                callGeminiReducingLevel(
                    'prompt',
                    MODEL_FLOOR_LOW,
                    'key',
                    undefined,
                    levelRef
                )
            ).rejects.toThrow('MAX_TOKENS');

            expect(mockCallGemini).toHaveBeenCalledTimes(3);
            expect(levelRef.current).toBe('low');
            expect(mockCallGemini).not.toHaveBeenCalledWith(
                'prompt',
                expect.objectContaining({ thinkingLevel: 'minimal' })
            );
        });

        it('throws when MAX_TOKENS occurs at the lowest level', async () => {
            mockCallGemini.mockRejectedValue(MAX_TOKENS_ERROR);

            const levelRef = { current: 'minimal' as const };
            await expect(
                callGeminiReducingLevel(
                    'prompt',
                    MODEL,
                    'key',
                    undefined,
                    levelRef
                )
            ).rejects.toThrow('MAX_TOKENS');
        });

        it('propagates 5xx error and preserves current level in levelRef', async () => {
            mockCallGemini.mockRejectedValueOnce(SERVER_ERROR);

            const levelRef = { current: 'high' as const };
            await expect(
                callGeminiReducingLevel(
                    'prompt',
                    MODEL,
                    'key',
                    undefined,
                    levelRef
                )
            ).rejects.toEqual(SERVER_ERROR);

            // levelRef reflects the level being tried when the 5xx occurred
            expect(levelRef.current).toBe('high');
        });

        it('propagates null error (isMaxTokensError: null path)', async () => {
            mockCallGemini.mockRejectedValueOnce(null);

            const levelRef = { current: 'high' as const };
            await expect(
                callGeminiReducingLevel(
                    'prompt',
                    MODEL,
                    'key',
                    undefined,
                    levelRef
                )
            ).rejects.toBeNull();
        });

        it('propagates string error (isMaxTokensError: non-object path)', async () => {
            mockCallGemini.mockRejectedValueOnce('unexpected string error');

            const levelRef = { current: 'high' as const };
            await expect(
                callGeminiReducingLevel(
                    'prompt',
                    MODEL,
                    'key',
                    undefined,
                    levelRef
                )
            ).rejects.toBe('unexpected string error');
        });

        it('preserves the reduced level in levelRef when 5xx follows MAX_TOKENS', async () => {
            // Sequence: MAX_TOKENS at high → continues to medium → 5xx at medium
            mockCallGemini
                .mockRejectedValueOnce(MAX_TOKENS_ERROR)
                .mockRejectedValueOnce(SERVER_ERROR);

            const levelRef = { current: 'high' as const };
            await expect(
                callGeminiReducingLevel(
                    'prompt',
                    MODEL,
                    'key',
                    undefined,
                    levelRef
                )
            ).rejects.toEqual(SERVER_ERROR);

            // Must be 'medium' (reduced), not 'high' (initial) —
            // withRetry's next attempt resumes from the reduced level.
            expect(levelRef.current).toBe('medium');
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

        it('uses the provided levelRef as the starting level', async () => {
            mockCallGemini.mockResolvedValueOnce('result');

            const levelRef = { current: 'medium' as const };
            await callGeminiWithRetry('prompt', MODEL, 'paid-key', {
                levelRef,
            });

            expect(mockCallGemini).toHaveBeenCalledWith(
                'prompt',
                expect.objectContaining({ thinkingLevel: 'medium' })
            );
        });

        it("starts from the spec's default state when no levelRef is provided", async () => {
            mockCallGemini.mockResolvedValueOnce('result');

            await callGeminiWithRetry('prompt', MODEL, 'key');

            // Free-class model → `reasoning.default: 'off'` → `'minimal'`.
            expect(mockCallGemini).toHaveBeenCalledWith(
                'prompt',
                expect.objectContaining({ thinkingLevel: 'minimal' })
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
