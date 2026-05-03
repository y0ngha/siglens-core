import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/jobs/queue');
vi.mock('@/application/background');

import { pollNewsCardAnalysis } from '@/application/news/pollNewsCardAnalysis';
import {
    getJobStatus,
    getJobError,
    getJobResult,
    getJobMeta,
    cleanupJob,
} from '@/infrastructure/jobs/queue';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { fireAndForget, cleanupInBackground } from '@/application/background';

const mockGetJobStatus = getJobStatus as Mock;
const mockGetJobError = getJobError as Mock;
const mockGetJobResult = getJobResult as Mock;
const mockGetJobMeta = getJobMeta as Mock;
const mockCleanupJob = cleanupJob as Mock;
const mockCreateCacheProvider = createCacheProvider as Mock;
const mockFireAndForget = fireAndForget as Mock;
const mockCleanupInBackground = cleanupInBackground as Mock;

const mockCacheSet = vi.fn();
const mockCacheProvider = { get: vi.fn(), set: mockCacheSet, delete: vi.fn() };

/** Minimal valid raw news card analysis result. */
const rawCardJson = JSON.stringify({
    titleKo: '애플, 신제품 발표',
    bodyKo: '애플이 오늘 신제품을 발표했습니다.',
    summaryKo: '애플 신제품 발표 요약',
    sentiment: 'bullish',
    category: 'product',
});

const mockMeta = {
    symbol: 'AAPL',
    modelId: 'gemini-2.5-flash-lite',
    cacheKey: 'news-card:news-001',
};

describe('pollNewsCardAnalysis 함수는', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockCacheSet.mockResolvedValue(undefined);
        mockCleanupJob.mockResolvedValue(undefined);
        mockFireAndForget.mockImplementation(() => undefined);
        mockCleanupInBackground.mockImplementation(() => undefined);
    });

    describe('status가 null이거나 processing일 때', () => {
        it('null이면 processing을 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce(null);
            const result = await pollNewsCardAnalysis('job-1');
            expect(result.status).toBe('processing');
        });

        it('processing이면 processing을 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce('processing');
            const result = await pollNewsCardAnalysis('job-2');
            expect(result.status).toBe('processing');
        });
    });

    describe('status가 error일 때', () => {
        it('getJobError를 호출하고 error 상태를 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce('error');
            mockGetJobError.mockResolvedValueOnce('Card analysis failed');

            const result = await pollNewsCardAnalysis('job-err');

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.error).toBe('Card analysis failed');
            }
            expect(mockCleanupInBackground).toHaveBeenCalledWith(
                'job-err',
                '[PollNewsCard]',
                undefined
            );
        });

        it('에러 메시지가 null이면 Unknown error를 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce('error');
            mockGetJobError.mockResolvedValueOnce(null);

            const result = await pollNewsCardAnalysis('job-err-null');

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.error).toBe('Unknown error');
            }
        });
    });

    describe('status가 done일 때', () => {
        beforeEach(() => {
            mockGetJobStatus.mockResolvedValue('done');
            mockGetJobMeta.mockResolvedValue(mockMeta);
        });

        it('결과가 없으면 error를 반환한다', async () => {
            mockGetJobResult.mockResolvedValueOnce(null);

            const result = await pollNewsCardAnalysis('job-no-result');

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.error).toBe('Result not found');
            }
        });

        it('normalize가 실패하면 error를 반환한다', async () => {
            mockGetJobResult.mockResolvedValueOnce('invalid json {{{');

            const consoleSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            const result = await pollNewsCardAnalysis('job-invalid');
            consoleSpy.mockRestore();

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.error).toBe('Invalid response from worker');
            }
        });

        it('유효한 결과이면 normalize하고 done 상태를 반환한다', async () => {
            mockGetJobResult.mockResolvedValueOnce(rawCardJson);

            const result = await pollNewsCardAnalysis('job-done');

            expect(result.status).toBe('done');
            if (result.status === 'done') {
                expect(result.result.titleKo).toBe('애플, 신제품 발표');
                expect(result.result.sentiment).toBe('bullish');
            }
        });

        it('meta.cacheKey가 있으면 fireAndForget으로 캐시에 저장한다', async () => {
            mockGetJobResult.mockResolvedValueOnce(rawCardJson);

            await pollNewsCardAnalysis('job-cache');

            expect(mockFireAndForget).toHaveBeenCalled();
        });

        it('meta.cacheKey가 없으면 캐시 저장을 건너뛴다', async () => {
            mockGetJobMeta.mockResolvedValueOnce({
                symbol: 'AAPL',
                modelId: 'flash-lite',
            });
            mockGetJobResult.mockResolvedValueOnce(rawCardJson);

            await pollNewsCardAnalysis('job-no-key');

            expect(mockFireAndForget).not.toHaveBeenCalled();
        });

        it('캐시 프로바이더가 null이면 캐시 저장을 건너뛴다', async () => {
            mockCreateCacheProvider.mockReturnValueOnce(null);
            mockGetJobResult.mockResolvedValueOnce(rawCardJson);

            const result = await pollNewsCardAnalysis('job-no-provider');

            expect(result.status).toBe('done');
            expect(mockCacheSet).not.toHaveBeenCalled();
        });
    });
});
