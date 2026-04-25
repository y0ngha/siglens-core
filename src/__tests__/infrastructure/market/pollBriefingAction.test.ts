import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/infrastructure/jobs/queue');
vi.mock('@/infrastructure/cache/redis');
vi.mock('@/domain/analysis/normalizeMarketBriefing');

import { pollBriefingAction } from '@/infrastructure/market/pollBriefingAction';
import {
    getJobStatus,
    getJobError,
    getJobResult,
    cleanupJob,
} from '@/infrastructure/jobs/queue';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { normalizeMarketBriefing } from '@/domain/analysis/normalizeMarketBriefing';

const mockGetJobStatus = getJobStatus as Mock;
const mockGetJobError = getJobError as Mock;
const mockGetJobResult = getJobResult as Mock;
const mockCleanupJob = cleanupJob as Mock;
const mockCreateCacheProvider = createCacheProvider as Mock;
const mockNormalizeMarketBriefing = normalizeMarketBriefing as Mock;

const mockCacheSet = vi.fn();
const mockCacheProvider = { get: vi.fn(), set: mockCacheSet, delete: vi.fn() };

const mockBriefing = {
    summary: '시장 요약',
    dominantThemes: [],
    sectorAnalysis: {
        leadingSectors: [],
        laggingSectors: [],
        performanceDescription: '',
    },
    volatilityAnalysis: { description: '' },
    riskSentiment: 'neutral',
};

describe('pollBriefingAction 함수는', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCleanupJob.mockResolvedValue(undefined);
        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockCacheSet.mockResolvedValue(undefined);
        mockNormalizeMarketBriefing.mockReturnValue(mockBriefing);
    });

    describe('status가 null이거나 processing일 때', () => {
        it('null이면 processing을 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce(null);

            const result = await pollBriefingAction('job-1');

            expect(result.status).toBe('processing');
        });

        it('processing이면 processing을 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce('processing');

            const result = await pollBriefingAction('job-2');

            expect(result.status).toBe('processing');
        });
    });

    describe('status가 error일 때', () => {
        it('에러 메시지와 함께 error 상태를 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce('error');
            mockGetJobError.mockResolvedValueOnce('Worker crash');

            const result = await pollBriefingAction('job-err');

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.error).toBe('Worker crash');
            }
            expect(mockCleanupJob).toHaveBeenCalledWith('job-err');
        });

        it('에러 메시지가 null이면 Unknown error를 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce('error');
            mockGetJobError.mockResolvedValueOnce(null);

            const result = await pollBriefingAction('job-err-null');

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.error).toBe('Unknown error');
            }
        });
    });

    describe('status가 done일 때', () => {
        beforeEach(() => {
            mockGetJobStatus.mockResolvedValue('done');
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2025-01-15T12:00:00.000Z'));
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('결과를 정규화하고 done 상태를 반환한다', async () => {
            mockGetJobResult.mockResolvedValueOnce({ raw: 'data' });

            const result = await pollBriefingAction('job-done');

            expect(result.status).toBe('done');
            if (result.status === 'done') {
                expect(result.briefing).toEqual(mockBriefing);
                expect(result.generatedAt).toBe('2025-01-15T12:00:00.000Z');
            }
            expect(mockNormalizeMarketBriefing).toHaveBeenCalledWith({
                raw: 'data',
            });
        });

        it('결과가 없으면 error를 반환한다', async () => {
            mockGetJobResult.mockResolvedValueOnce(null);

            const result = await pollBriefingAction('job-no-result');

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.error).toBe('Result not found');
            }
            expect(mockCleanupJob).toHaveBeenCalled();
        });

        it('summary가 없는 briefing이면 Invalid briefing result 에러를 반환한다', async () => {
            mockGetJobResult.mockResolvedValueOnce({ raw: 'data' });
            mockNormalizeMarketBriefing.mockReturnValueOnce({
                ...mockBriefing,
                summary: '',
            });

            const result = await pollBriefingAction('job-invalid');

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.error).toBe('Invalid briefing result');
            }
        });

        it('캐시에 briefing을 저장한다', async () => {
            mockGetJobResult.mockResolvedValueOnce({ raw: 'data' });

            await pollBriefingAction('job-cache');

            expect(mockCacheSet).toHaveBeenCalled();
        });

        it('cleanup을 호출한다', async () => {
            mockGetJobResult.mockResolvedValueOnce({ raw: 'data' });

            await pollBriefingAction('job-cleanup');

            expect(mockCleanupJob).toHaveBeenCalledWith('job-cleanup');
        });
    });

    describe('캐시 프로바이더가 없을 때', () => {
        it('캐시 저장을 건너뛰고 done을 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce('done');
            mockGetJobResult.mockResolvedValueOnce({ raw: 'data' });
            mockCreateCacheProvider.mockReturnValueOnce(null);

            const result = await pollBriefingAction('job-no-cache');

            expect(result.status).toBe('done');
            expect(mockCacheSet).not.toHaveBeenCalled();
        });
    });
});
