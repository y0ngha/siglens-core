import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/infrastructure/jobs/queue');
vi.mock('@/infrastructure/cache/redis');
vi.mock('@/domain/analysis/normalizeMarketBriefing');

import { pollBriefing } from '@/application/market/pollBriefing';
import {
    getJobStatus,
    getJobError,
    getJobMeta,
    getJobResult,
    cleanupJob,
} from '@/infrastructure/jobs/queue';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { normalizeMarketBriefing } from '@/domain/analysis/normalizeMarketBriefing';

const mockGetJobStatus = getJobStatus as Mock;
const mockGetJobError = getJobError as Mock;
const mockGetJobMeta = getJobMeta as Mock;
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

describe('pollBriefing 함수는', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCleanupJob.mockResolvedValue(undefined);
        mockGetJobMeta.mockResolvedValue({
            symbol: 'market',
            cacheKey: 'briefing:market:2025-01-15T12:deadbeefdeadbeef',
        });
        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockCacheSet.mockResolvedValue(undefined);
        mockNormalizeMarketBriefing.mockReturnValue(mockBriefing);
    });

    describe('status가 null이거나 processing일 때', () => {
        it('null이면 processing을 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce(null);

            const result = await pollBriefing('job-1');

            expect(result.status).toBe('processing');
        });

        it('processing이면 processing을 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce('processing');

            const result = await pollBriefing('job-2');

            expect(result.status).toBe('processing');
        });
    });

    describe('status가 error일 때', () => {
        it('에러 메시지와 함께 error 상태를 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce('error');
            mockGetJobError.mockResolvedValueOnce('Worker crash');

            const result = await pollBriefing('job-err');

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.error).toBe('Worker crash');
            }
            expect(mockCleanupJob).toHaveBeenCalledWith('job-err');
        });

        it('에러 메시지가 null이면 Unknown error를 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce('error');
            mockGetJobError.mockResolvedValueOnce(null);

            const result = await pollBriefing('job-err-null');

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

            const result = await pollBriefing('job-done');

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

            const result = await pollBriefing('job-no-result');

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

            const result = await pollBriefing('job-invalid');

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.error).toBe('Invalid briefing result');
            }
        });

        it('job meta의 입력 해시 캐시 키로 briefing을 저장한다 (read==write)', async () => {
            mockGetJobResult.mockResolvedValueOnce({ raw: 'data' });
            mockGetJobMeta.mockResolvedValueOnce({
                symbol: 'market',
                cacheKey: 'briefing:market:2025-01-15T12:cafebabecafebabe',
            });

            await pollBriefing('job-cache');

            expect(mockCacheSet).toHaveBeenCalledWith(
                'briefing:market:2025-01-15T12:cafebabecafebabe',
                expect.objectContaining({ briefing: mockBriefing }),
                expect.any(Number)
            );
        });

        it('job meta가 없으면(null이면) 캐시 저장을 건너뛴다 (잘못된 키로 쓰지 않음)', async () => {
            mockGetJobResult.mockResolvedValueOnce({ raw: 'data' });
            mockGetJobMeta.mockResolvedValueOnce(null);

            const result = await pollBriefing('job-no-meta');

            expect(result.status).toBe('done');
            expect(mockCacheSet).not.toHaveBeenCalled();
        });

        it('job meta는 있지만 cacheKey가 없으면 캐시 저장을 건너뛴다', async () => {
            mockGetJobResult.mockResolvedValueOnce({ raw: 'data' });
            mockGetJobMeta.mockResolvedValueOnce({ symbol: 'market' });

            const result = await pollBriefing('job-meta-no-cachekey');

            expect(result.status).toBe('done');
            expect(mockCacheSet).not.toHaveBeenCalled();
        });

        it('waitUntil이 제공되면 캐시 저장과 cleanup promise를 등록한다', async () => {
            const waitUntil = vi.fn();
            mockGetJobResult.mockResolvedValueOnce({ raw: 'data' });

            await pollBriefing('job-wait-until', { waitUntil });

            expect(waitUntil).toHaveBeenCalledTimes(2);
            expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
        });

        it('cleanup을 호출한다', async () => {
            mockGetJobResult.mockResolvedValueOnce({ raw: 'data' });

            await pollBriefing('job-cleanup');

            expect(mockCleanupJob).toHaveBeenCalledWith('job-cleanup');
        });

        it('캐시 쓰기가 실패해도 done을 반환하고 에러를 로깅한다', async () => {
            const consoleErrorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            mockGetJobResult.mockResolvedValueOnce({ raw: 'data' });
            mockGetJobMeta.mockResolvedValueOnce({
                symbol: 'market',
                cacheKey: 'briefing:market:2025-01-15T12:deadbeefdeadbeef',
            });
            mockCacheSet.mockRejectedValueOnce(new Error('write failed'));

            const result = await pollBriefing('job-cache-fail');

            expect(result.status).toBe('done');
            // fire-and-forget .catch 는 microtask 로 큐잉되므로, fake timer 환경에서
            // 한 틱(0ms) 진행시켜 대기 중인 microtask 가 모두 비워진 뒤
            // .catch 가 실행 완료된 상태를 보장한다.
            await vi.advanceTimersByTimeAsync(0);
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                '[Briefing/Poll] Cache write failed:',
                expect.any(Error)
            );
            consoleErrorSpy.mockRestore();
        });
    });

    describe('캐시 프로바이더가 없을 때', () => {
        it('캐시 저장을 건너뛰고 done을 반환한다', async () => {
            mockGetJobStatus.mockResolvedValueOnce('done');
            mockGetJobResult.mockResolvedValueOnce({ raw: 'data' });
            mockCreateCacheProvider.mockReturnValueOnce(null);

            const result = await pollBriefing('job-no-cache');

            expect(result.status).toBe('done');
            expect(mockCacheSet).not.toHaveBeenCalled();
        });
    });
});
