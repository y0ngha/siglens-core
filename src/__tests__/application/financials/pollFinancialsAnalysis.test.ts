import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/jobs/queue');
vi.mock('@/application/background');

import { pollFinancialsAnalysis } from '@/application/financials/pollFinancialsAnalysis';
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

/** Minimal valid raw financials result string. */
const rawFinancialsJson = JSON.stringify({
    overallConclusionKo: '종합 재무 분석',
    axisAssessments: [
        {
            axis: 'growth',
            sentiment: 'bullish',
            rationaleKo: '성장세 양호',
        },
        {
            axis: 'quality',
            sentiment: 'neutral',
            rationaleKo: '수익 품질 보통',
        },
        {
            axis: 'solvency',
            sentiment: 'bullish',
            rationaleKo: '재무건전성 양호',
        },
        {
            axis: 'cash',
            sentiment: 'neutral',
            rationaleKo: '현금흐름 보통',
        },
    ],
    riskFactorsKo: ['환율 리스크'],
    overallSentiment: 'bullish',
});

const mockMeta = {
    symbol: 'AAPL',
    modelId: 'gemini-2.5-flash',
    cacheKey: 'financials:AAPL:flash:abc123',
};

describe('pollFinancialsAnalysis 함수는', () => {
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
            const result = await pollFinancialsAnalysis('job-1');
            expect(result.status).toBe('processing');
        });

        it('processing이면 processing을 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce('processing');
            const result = await pollFinancialsAnalysis('job-2');
            expect(result.status).toBe('processing');
        });
    });

    describe('status가 error일 때', () => {
        it('에러 메시지와 함께 error 상태를 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce('error');
            mockGetJobError.mockResolvedValueOnce('Worker crashed');

            const result = await pollFinancialsAnalysis('job-err');

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.error).toBe('Worker crashed');
            }
            expect(mockCleanupInBackground).toHaveBeenCalledWith(
                'job-err',
                '[PollFinancials]',
                undefined
            );
        });

        it('에러 메시지가 null이면 Unknown error를 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce('error');
            mockGetJobError.mockResolvedValueOnce(null);

            const result = await pollFinancialsAnalysis('job-err-null');

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

            const result = await pollFinancialsAnalysis('job-no-result');

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.error).toBe('Result not found');
            }
        });

        it('유효한 결과이면 normalize하고 done 상태를 반환한다', async () => {
            mockGetJobResult.mockResolvedValueOnce(rawFinancialsJson);

            const result = await pollFinancialsAnalysis('job-done');

            expect(result.status).toBe('done');
            if (result.status === 'done') {
                expect(result.result.overallConclusionKo).toBe(
                    '종합 재무 분석'
                );
                expect(result.result.overallSentiment).toBe('bullish');
            }
        });

        it('normalize가 실패하면 error를 반환한다', async () => {
            mockGetJobResult.mockResolvedValueOnce('not valid json {{{');

            const consoleSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            const result = await pollFinancialsAnalysis('job-invalid');
            consoleSpy.mockRestore();

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.error).toBe('Invalid response from worker');
            }
        });

        it('meta.cacheKey가 있으면 캐시에 저장한다', async () => {
            mockGetJobResult.mockResolvedValueOnce(rawFinancialsJson);

            await pollFinancialsAnalysis('job-cache');

            expect(mockFireAndForget).toHaveBeenCalled();
        });

        it('meta.cacheKey가 없으면 캐시 저장을 건너뛴다', async () => {
            mockGetJobMeta.mockResolvedValueOnce({
                symbol: 'AAPL',
                modelId: 'flash',
            });
            mockGetJobResult.mockResolvedValueOnce(rawFinancialsJson);

            await pollFinancialsAnalysis('job-no-cache-key');

            expect(mockFireAndForget).not.toHaveBeenCalled();
        });

        it('캐시 프로바이더가 null이면 캐시 저장을 건너뛴다', async () => {
            mockCreateCacheProvider.mockReturnValueOnce(null);
            mockGetJobResult.mockResolvedValueOnce(rawFinancialsJson);

            const result = await pollFinancialsAnalysis('job-no-provider');

            expect(result.status).toBe('done');
            expect(mockCacheSet).not.toHaveBeenCalled();
        });

        it('빈 응답이 감지되면 경고를 로그하고 done을 반환한다', async () => {
            mockGetJobResult.mockResolvedValueOnce(JSON.stringify({}));
            const warnSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => {});

            const result = await pollFinancialsAnalysis('job-empty');

            expect(result.status).toBe('done');
            expect(warnSpy).toHaveBeenCalledWith(
                '[PollFinancials] Empty financials analysis',
                { jobId: 'job-empty' }
            );
            warnSpy.mockRestore();
        });
    });
});
