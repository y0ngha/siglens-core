import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/jobs/queue');
vi.mock('@/domain/analysis/normalizeMarketBriefing');
vi.mock('@/domain/analysis/marketBriefingPrompt');

import { submitBriefing } from '@/application/market/submitBriefing';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { claimOrJoinInFlightJob } from '@/infrastructure/jobs/queue';
import { normalizeMarketBriefing } from '@/domain/analysis/normalizeMarketBriefing';
import { buildMarketBriefingPrompt } from '@/domain/analysis/marketBriefingPrompt';
import type { MarketSummaryData, MarketBriefingResponse } from '@/domain/types';

const mockCreateCacheProvider = createCacheProvider as Mock;
const mockClaimOrJoinInFlightJob = claimOrJoinInFlightJob as Mock;
const mockNormalizeMarketBriefing = normalizeMarketBriefing as Mock;
const mockBuildMarketBriefingPrompt = buildMarketBriefingPrompt as Mock;

const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheProvider = {
    get: mockCacheGet,
    set: mockCacheSet,
    delete: vi.fn(),
};
const mockFetch = vi.fn();

const mockData: MarketSummaryData = {
    indices: [],
    sectors: [],
};

const mockBriefing: MarketBriefingResponse = {
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

describe('submitBriefing 함수는', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', mockFetch);
        process.env = {
            ...originalEnv,
            WORKER_URL: 'https://worker.test',
            WORKER_SECRET: 'test-secret',
        };
        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockCacheGet.mockResolvedValue(null);
        mockCacheSet.mockResolvedValue(undefined);
        // Default: 새 슬롯을 claim한 것으로 가정. dedup 분기는 per-test에서 override.
        mockClaimOrJoinInFlightJob.mockImplementation(
            async (_cacheKey: string, newJobId: string) => ({
                status: 'claimed' as const,
                jobId: newJobId,
            })
        );
        mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
        mockBuildMarketBriefingPrompt.mockReturnValue('mock prompt');
        mockNormalizeMarketBriefing.mockReturnValue(mockBriefing);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        process.env = originalEnv;
    });

    describe('캐시 히트일 때', () => {
        it('cached 상태와 briefing을 반환한다', async () => {
            const cachedData = {
                briefing: mockBriefing,
                generatedAt: '2024-01-15T09:00:00.000Z',
            };
            mockCacheGet.mockResolvedValueOnce(cachedData);

            const result = await submitBriefing(mockData);

            expect(result.status).toBe('cached');
            if (result.status === 'cached') {
                expect(result.generatedAt).toBe(cachedData.generatedAt);
                expect(result.briefing).toBe(mockBriefing);
            }
            expect(mockFetch).not.toHaveBeenCalled();
        });
    });

    describe('캐시 미스일 때', () => {
        it('Worker /briefing 엔드포인트에 요청을 보낸다', async () => {
            const result = await submitBriefing(mockData);

            expect(result.status).toBe('submitted');
            expect(mockFetch).toHaveBeenCalledWith(
                'https://worker.test/briefing',
                expect.objectContaining({
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Worker-Secret': 'test-secret',
                    },
                })
            );
        });

        it('submitted 상태와 jobId를 반환한다', async () => {
            const result = await submitBriefing(mockData);

            expect(result.status).toBe('submitted');
            if (result.status === 'submitted') {
                expect(typeof result.jobId).toBe('string');
                expect(result.jobId.length).toBeGreaterThan(0);
            }
        });

        it('waitUntil이 제공되면 Worker 요청 promise를 등록한다', async () => {
            const waitUntil = vi.fn();

            await submitBriefing(mockData, { waitUntil });

            expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
        });
    });

    describe('환경변수가 없을 때', () => {
        it('WORKER_URL이 없으면 에러를 던진다', async () => {
            delete process.env.WORKER_URL;

            await expect(submitBriefing(mockData)).rejects.toThrow(
                'WORKER_URL and WORKER_SECRET environment variables are required'
            );
        });

        it('WORKER_SECRET이 없으면 에러를 던진다', async () => {
            delete process.env.WORKER_SECRET;

            await expect(submitBriefing(mockData)).rejects.toThrow(
                'WORKER_URL and WORKER_SECRET environment variables are required'
            );
        });
    });

    describe('캐시 프로바이더가 없을 때', () => {
        it('캐시 조회를 건너뛰고 submitted를 반환한다', async () => {
            mockCreateCacheProvider.mockReturnValueOnce(null);

            const result = await submitBriefing(mockData);

            expect(result.status).toBe('submitted');
            expect(mockCacheGet).not.toHaveBeenCalled();
        });
    });

    describe('dedup으로 기존 in-flight job에 join되면', () => {
        it('worker로 dispatch하지 않고 기존 jobId를 반환한다', async () => {
            mockClaimOrJoinInFlightJob.mockImplementationOnce(async () => ({
                status: 'joined',
                jobId: 'existing-briefing-job',
            }));

            const result = await submitBriefing(mockData);

            expect(result).toEqual({
                status: 'submitted',
                jobId: 'existing-briefing-job',
            });
            // 같은 시간대(briefing cacheKey)에 동시 submit이 들어와도 worker
            // 호출은 한 번만 발생해야 한다 — 나머지는 기존 jobId만 polling.
            expect(mockFetch).not.toHaveBeenCalled();
        });
    });
});
