import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import type { RawAnalysisResponse } from '@/domain/types';

vi.mock('@/infrastructure/jobs/queue');
vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/skills/loader');
vi.mock('@/domain/analysis/confidence');
vi.mock('@/domain/analysis/ai-levels');
vi.mock('@/infrastructure/cache/config', async () => {
    const actual = await vi.importActual<
        typeof import('@/infrastructure/cache/config')
    >('@/infrastructure/cache/config');
    return { ...actual, computeEffectiveTtl: vi.fn().mockReturnValue(3600) };
});

import { pollAnalysis } from '@/application/market/pollAnalysis';
import { DEFAULT_ANALYSIS_MODEL_ID } from '@/infrastructure/cache/config';
import {
    getJobStatus,
    getJobError,
    getJobResult,
    getJobMeta,
    cleanupJob,
} from '@/infrastructure/jobs/queue';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { FileSkillsLoader } from '@/infrastructure/skills/loader';
import { enrichAnalysisWithConfidence } from '@/domain/analysis/confidence';
import { postProcessAnalysisWithReconcile } from '@/domain/analysis/ai-levels';

const mockGetJobStatus = getJobStatus as Mock;
const mockGetJobError = getJobError as Mock;
const mockGetJobResult = getJobResult as Mock;
const mockGetJobMeta = getJobMeta as Mock;
const mockCleanupJob = cleanupJob as Mock;
const mockCreateCacheProvider = createCacheProvider as Mock;
const mockEnrichAnalysisWithConfidence = enrichAnalysisWithConfidence as Mock;
const mockPostProcessAnalysisWithReconcile =
    postProcessAnalysisWithReconcile as Mock;

const mockCacheSet = vi.fn();
const mockCacheProvider = { get: vi.fn(), set: mockCacheSet, delete: vi.fn() };
const mockLoadSkills = vi.fn();

const rawResult: RawAnalysisResponse = {
    summary: '테스트 요약',
    trend: 'bullish',
    indicatorResults: [],
    riskLevel: 'low',
    keyLevels: { support: [], resistance: [] },
    priceTargets: {
        bullish: { targets: [], condition: '' },
        bearish: { targets: [], condition: '' },
    },
    patternSummaries: [],
    strategyResults: [],
    candlePatterns: [],
    trendlines: [],
};

const mockMeta = {
    symbol: 'AAPL',
    timeframe: '1Day',
    lastClose: 150,
    atr: 2.5,
    skillsDegraded: false,
    modelId: 'gemini-2.5-flash',
};

describe('pollAnalysis 함수는', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCleanupJob.mockResolvedValue(undefined);
        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockCacheSet.mockResolvedValue(undefined);
        (FileSkillsLoader as Mock).mockImplementation(() => ({
            loadSkills: mockLoadSkills,
        }));
        mockLoadSkills.mockResolvedValue([]);
        mockEnrichAnalysisWithConfidence.mockReturnValue(rawResult);
        mockPostProcessAnalysisWithReconcile.mockReturnValue(rawResult);
    });

    describe('status가 null이거나 processing일 때', () => {
        it('null이면 processing을 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce(null);

            const result = await pollAnalysis('job-1');

            expect(result.status).toBe('processing');
        });

        it('processing이면 processing을 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce('processing');

            const result = await pollAnalysis('job-2');

            expect(result.status).toBe('processing');
        });
    });

    describe('status가 error일 때', () => {
        it('에러 메시지와 함께 error 상태를 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce('error');
            mockGetJobError.mockResolvedValueOnce('Worker crash');

            const result = await pollAnalysis('job-err');

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.error).toBe('Worker crash');
            }
            expect(mockCleanupJob).toHaveBeenCalledWith('job-err');
        });

        it('에러 메시지가 null이면 Unknown error를 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce('error');
            mockGetJobError.mockResolvedValueOnce(null);

            const result = await pollAnalysis('job-err-null');

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

        afterEach(() => {
            vi.useRealTimers();
        });

        it('결과를 enrichment하고 done 상태를 반환한다', async () => {
            mockGetJobResult.mockResolvedValueOnce(rawResult);

            const result = await pollAnalysis('job-done');

            expect(result.status).toBe('done');
            expect(mockEnrichAnalysisWithConfidence).toHaveBeenCalled();
            expect(mockPostProcessAnalysisWithReconcile).toHaveBeenCalledWith(
                rawResult,
                mockMeta.lastClose,
                mockMeta.atr
            );
        });

        it('결과가 없으면 error를 반환한다', async () => {
            mockGetJobResult.mockResolvedValueOnce(null);

            const result = await pollAnalysis('job-no-result');

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.error).toBe('Result not found');
            }
            expect(mockCleanupJob).toHaveBeenCalled();
        });

        it('summary가 없는 결과이면 Invalid response 에러를 반환한다', async () => {
            mockGetJobResult.mockResolvedValueOnce({ trend: 'bullish' });

            const result = await pollAnalysis('job-invalid');

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.error).toBe('Invalid response from worker');
            }
        });

        it('meta가 있으면 모델 ID 포함 캐시 키로 저장한다', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2025-01-15T12:00:00.000Z'));
            mockGetJobResult.mockResolvedValueOnce(rawResult);

            await pollAnalysis('job-cache');

            expect(mockCacheSet).toHaveBeenCalledWith(
                'analysis:AAPL:1Day:gemini-2.5-flash',
                expect.objectContaining({
                    analyzedAt: '2025-01-15T12:00:00.000Z',
                }),
                3600
            );
        });

        it('meta에 modelId가 없으면 기본 모델 ID를 포함한 캐시 키로 저장한다', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2025-01-15T12:00:00.000Z'));
            mockGetJobResult.mockResolvedValueOnce(rawResult);
            mockGetJobMeta.mockResolvedValueOnce({
                ...mockMeta,
                modelId: undefined,
            });

            await pollAnalysis('job-cache-no-model');

            expect(mockCacheSet).toHaveBeenCalledWith(
                `analysis:AAPL:1Day:${DEFAULT_ANALYSIS_MODEL_ID}`,
                expect.objectContaining({
                    analyzedAt: '2025-01-15T12:00:00.000Z',
                }),
                3600
            );
        });

        it('waitUntil이 제공되면 캐시 저장과 cleanup promise를 등록한다', async () => {
            const waitUntil = vi.fn();
            mockGetJobResult.mockResolvedValueOnce(rawResult);

            await pollAnalysis('job-wait-until', { waitUntil });

            expect(waitUntil).toHaveBeenCalledTimes(2);
            expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
        });

        it('skills 로딩 실패해도 done을 반환한다', async () => {
            mockGetJobResult.mockResolvedValueOnce(rawResult);
            mockLoadSkills.mockRejectedValueOnce(new Error('load failed'));
            const consoleSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});

            const result = await pollAnalysis('job-skills-fail');

            expect(result.status).toBe('done');
            consoleSpy.mockRestore();
        });

        it('cleanup을 호출한다', async () => {
            mockGetJobResult.mockResolvedValueOnce(rawResult);

            await pollAnalysis('job-cleanup');

            expect(mockCleanupJob).toHaveBeenCalledWith('job-cleanup');
        });

        it('analyzedAt은 ISO 형식의 현재 시각이다', async () => {
            const fixedDate = new Date('2025-01-15T12:00:00.000Z');
            vi.useFakeTimers();
            vi.setSystemTime(fixedDate);
            mockGetJobResult.mockResolvedValueOnce(rawResult);

            const result = await pollAnalysis('job-analyzedAt');

            expect(result.status).toBe('done');
            if (result.status === 'done') {
                expect(result.result.analyzedAt).toBe(
                    '2025-01-15T12:00:00.000Z'
                );
            }
        });
    });

    describe('캐시 프로바이더가 없을 때', () => {
        it('캐시 저장을 건너뛰고 done을 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce('done');
            mockGetJobResult.mockResolvedValueOnce(rawResult);
            mockGetJobMeta.mockResolvedValueOnce(mockMeta);
            mockCreateCacheProvider.mockReturnValueOnce(null);

            const result = await pollAnalysis('job-no-cache');

            expect(result.status).toBe('done');
            expect(mockCacheSet).not.toHaveBeenCalled();
        });
    });

    describe('B-5: meta.timeframe undefined 분기', () => {
        beforeEach(() => {
            mockGetJobStatus.mockResolvedValue('done');
        });

        it('meta.timeframe이 undefined이면 캐시 저장을 건너뛴다', async () => {
            mockGetJobResult.mockResolvedValueOnce(rawResult);
            mockGetJobMeta.mockResolvedValueOnce({
                ...mockMeta,
                timeframe: undefined,
            });

            const result = await pollAnalysis('job-no-timeframe');

            expect(result.status).toBe('done');
            expect(mockCacheSet).not.toHaveBeenCalled();
        });

        it('meta.timeframe이 정의되어 있으면 캐시에 저장한다', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2025-01-15T12:00:00.000Z'));
            mockGetJobResult.mockResolvedValueOnce(rawResult);
            mockGetJobMeta.mockResolvedValueOnce({
                ...mockMeta,
                timeframe: '1Day',
            });

            await pollAnalysis('job-with-timeframe');

            expect(mockCacheSet).toHaveBeenCalled();
            vi.useRealTimers();
        });
    });
});
