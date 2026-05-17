import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/jobs/queue');
vi.mock('@/application/background');

import { pollOptionsAnalysis } from '@/application/options/pollOptionsAnalysis';
import {
    getJobStatus,
    getJobError,
    getJobResult,
    getJobMeta,
} from '@/infrastructure/jobs/queue';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { fireAndForget, cleanupInBackground } from '@/application/background';

const mockGetJobStatus = getJobStatus as Mock;
const mockGetJobError = getJobError as Mock;
const mockGetJobResult = getJobResult as Mock;
const mockGetJobMeta = getJobMeta as Mock;
const mockCreateCacheProvider = createCacheProvider as Mock;
const mockFireAndForget = fireAndForget as Mock;
const mockCleanupInBackground = cleanupInBackground as Mock;

const mockCacheSet = vi.fn();
const mockCacheProvider = { get: vi.fn(), set: mockCacheSet, delete: vi.fn() };

/** Minimal valid raw options analysis result. */
const rawOptionsJson = JSON.stringify({
    summary: '콜 옵션 OI가 높아 강세 포지셔닝이 확인됩니다.',
    perExpiration: [
        {
            expirationDate: '2026-06-20',
            commentary: '이 만기에서 콜 비중이 높습니다.',
            tone: 'bullish',
        },
    ],
    signals: [{ kind: 'bullish', message: 'Put/Call 비율이 낮아 강세 신호.' }],
    analyzedAt: '2026-05-14T10:00:00.000Z',
});

const mockMeta = {
    symbol: 'AAPL',
    modelId: 'gemini-2.5-flash',
    cacheKey: 'options:AAPL:2026-06-20:flash:abc123',
};

describe('pollOptionsAnalysis 함수는', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockCacheSet.mockResolvedValue(undefined);
        mockFireAndForget.mockImplementation(() => undefined);
        mockCleanupInBackground.mockImplementation(() => undefined);
    });

    // ── 1. Processing ──────────────────────────────────────────────────────────

    describe('status가 null이거나 processing일 때', () => {
        it('null이면 processing을 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce(null);
            const result = await pollOptionsAnalysis('job-1');
            expect(result.status).toBe('processing');
        });

        it('processing이면 processing을 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce('processing');
            const result = await pollOptionsAnalysis('job-2');
            expect(result.status).toBe('processing');
        });
    });

    // ── 2. Error from worker ───────────────────────────────────────────────────

    describe('status가 error일 때', () => {
        it('getJobError를 호출하고 error 상태를 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce('error');
            mockGetJobError.mockResolvedValueOnce('LLM timeout');

            const result = await pollOptionsAnalysis('job-err');

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.error).toBe('LLM timeout');
            }
            expect(mockCleanupInBackground).toHaveBeenCalledWith(
                'job-err',
                '[PollOptions]',
                undefined
            );
        });

        it('에러 메시지가 null이면 Unknown error를 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce('error');
            mockGetJobError.mockResolvedValueOnce(null);

            const result = await pollOptionsAnalysis('job-err-null');

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.error).toBe('Unknown error');
            }
        });
    });

    // ── 3. Done + success ──────────────────────────────────────────────────────

    describe('status가 done일 때', () => {
        beforeEach(() => {
            mockGetJobStatus.mockResolvedValue('done');
            mockGetJobMeta.mockResolvedValue(mockMeta);
        });

        it('결과가 없으면 error를 반환하고 cleanup을 호출한다', async () => {
            mockGetJobResult.mockResolvedValueOnce(null);

            const result = await pollOptionsAnalysis('job-no-result');

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.error).toBe('Result not found');
            }
            expect(mockCleanupInBackground).toHaveBeenCalledWith(
                'job-no-result',
                '[PollOptions]',
                undefined
            );
        });

        it('유효한 결과이면 normalize하고 done 상태를 반환한다', async () => {
            mockGetJobResult.mockResolvedValueOnce(rawOptionsJson);

            const result = await pollOptionsAnalysis('job-done');

            expect(result.status).toBe('done');
            if (result.status === 'done') {
                expect(result.result.summary).toBe(
                    '콜 옵션 OI가 높아 강세 포지셔닝이 확인됩니다.'
                );
                expect(result.result.perExpiration).toHaveLength(1);
                expect(result.result.perExpiration[0].tone).toBe('bullish');
                expect(result.result.signals).toHaveLength(1);
            }
            expect(mockCleanupInBackground).toHaveBeenCalledWith(
                'job-done',
                '[PollOptions]',
                undefined
            );
        });

        it('meta.cacheKey가 있으면 fireAndForget으로 캐시에 저장한다', async () => {
            mockGetJobResult.mockResolvedValueOnce(rawOptionsJson);

            await pollOptionsAnalysis('job-cache');

            expect(mockFireAndForget).toHaveBeenCalled();
        });

        // ── 4. Done + missing meta ─────────────────────────────────────────────

        it('meta.cacheKey가 없으면 캐시 저장을 건너뛴다', async () => {
            mockGetJobMeta.mockResolvedValueOnce({
                symbol: 'AAPL',
                modelId: 'flash',
                // no cacheKey
            });
            mockGetJobResult.mockResolvedValueOnce(rawOptionsJson);

            await pollOptionsAnalysis('job-no-key');

            expect(mockFireAndForget).not.toHaveBeenCalled();
        });

        it('캐시 프로바이더가 null이면 캐시 저장을 건너뛴다', async () => {
            mockCreateCacheProvider.mockReturnValueOnce(null);
            mockGetJobResult.mockResolvedValueOnce(rawOptionsJson);

            const result = await pollOptionsAnalysis('job-no-provider');

            expect(result.status).toBe('done');
            expect(mockCacheSet).not.toHaveBeenCalled();
        });

        // ── 3b. Done + normalization graceful fallback ─────────────────────────

        it('normalize가 gracefully fallback하면 done 상태를 반환한다 (never throws)', async () => {
            // normalizeOptionsAnalysisResponse never throws — malformed input
            // yields fallback content. This confirms the no-throw contract.
            mockGetJobResult.mockResolvedValueOnce('{}');

            const result = await pollOptionsAnalysis('job-fallback');

            expect(result.status).toBe('done');
            if (result.status === 'done') {
                // Fallback summary constant from normalizeOptions.ts
                expect(result.result.summary).toBe(
                    '옵션 분석을 가져올 수 없었어요. 잠시 후 다시 시도해주세요.'
                );
                expect(result.result.perExpiration).toHaveLength(0);
                expect(result.result.signals).toHaveLength(0);
            }
        });

        it('빈 응답이 감지되면 경고를 로그하고 done을 반환한다', async () => {
            // Force summary to empty string to trigger the empty-detection path.
            // The fallback constant is non-empty, so we need to pass an object
            // with summary: '' explicitly.
            mockGetJobResult.mockResolvedValueOnce(
                JSON.stringify({ summary: '', perExpiration: [], signals: [] })
            );
            const warnSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => {});

            const result = await pollOptionsAnalysis('job-empty');

            expect(result.status).toBe('done');
            expect(warnSpy).toHaveBeenCalledWith(
                '[PollOptions] Empty options analysis',
                { jobId: 'job-empty' }
            );
            warnSpy.mockRestore();
        });
    });

});
