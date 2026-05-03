import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/jobs/queue');
vi.mock('@/application/background');

import { pollNewsAnalysis } from '@/application/news/pollNewsAnalysis';
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

/** Minimal valid raw news analysis result. */
const rawNewsJson = JSON.stringify({
    currentDriverKo: '현재 상승 요인',
    keyEventsKo: ['실적 발표', 'AI 신제품'],
    upcomingEventsKo: ['WWDC 2026'],
    overallSentiment: 'bullish',
});

const mockMeta = {
    symbol: 'AAPL',
    modelId: 'gemini-2.5-flash',
    cacheKey: 'news:AAPL:flash:abc123',
};

describe('pollNewsAnalysis 함수는', () => {
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
            const result = await pollNewsAnalysis('job-1');
            expect(result.status).toBe('processing');
        });

        it('processing이면 processing을 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce('processing');
            const result = await pollNewsAnalysis('job-2');
            expect(result.status).toBe('processing');
        });
    });

    describe('status가 error일 때', () => {
        it('getJobError를 호출하고 error 상태를 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce('error');
            mockGetJobError.mockResolvedValueOnce('LLM timeout');

            const result = await pollNewsAnalysis('job-err');

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.error).toBe('LLM timeout');
            }
            expect(mockCleanupInBackground).toHaveBeenCalledWith(
                'job-err',
                '[PollNews]',
                undefined
            );
        });

        it('에러 메시지가 null이면 Unknown error를 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce('error');
            mockGetJobError.mockResolvedValueOnce(null);

            const result = await pollNewsAnalysis('job-err-null');

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

            const result = await pollNewsAnalysis('job-no-result');

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.error).toBe('Result not found');
            }
        });

        it('normalize가 실패하면 error를 반환한다', async () => {
            mockGetJobResult.mockResolvedValueOnce('invalid {{{');

            const consoleSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            const result = await pollNewsAnalysis('job-invalid');
            consoleSpy.mockRestore();

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.error).toBe('Invalid response from worker');
            }
        });

        it('유효한 결과이면 normalize하고 done 상태를 반환한다', async () => {
            mockGetJobResult.mockResolvedValueOnce(rawNewsJson);

            const result = await pollNewsAnalysis('job-done');

            expect(result.status).toBe('done');
            if (result.status === 'done') {
                expect(result.result.overallSentiment).toBe('bullish');
                expect(result.result.currentDriverKo).toBe('현재 상승 요인');
            }
        });

        it('meta.cacheKey가 있으면 fireAndForget으로 캐시에 저장한다', async () => {
            mockGetJobResult.mockResolvedValueOnce(rawNewsJson);

            await pollNewsAnalysis('job-cache');

            expect(mockFireAndForget).toHaveBeenCalled();
        });

        it('meta.cacheKey가 없으면 캐시 저장을 건너뛴다', async () => {
            mockGetJobMeta.mockResolvedValueOnce({
                symbol: 'AAPL',
                modelId: 'flash',
            });
            mockGetJobResult.mockResolvedValueOnce(rawNewsJson);

            await pollNewsAnalysis('job-no-key');

            expect(mockFireAndForget).not.toHaveBeenCalled();
        });

        it('캐시 프로바이더가 null이면 캐시 저장을 건너뛴다', async () => {
            mockCreateCacheProvider.mockReturnValueOnce(null);
            mockGetJobResult.mockResolvedValueOnce(rawNewsJson);

            const result = await pollNewsAnalysis('job-no-provider');

            expect(result.status).toBe('done');
            expect(mockCacheSet).not.toHaveBeenCalled();
        });
    });
});
