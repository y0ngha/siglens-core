import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

// ── Mock dependencies before importing the module under test ──
vi.mock('@/application/overall/dependencyResolver');
vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/jobs/queue');
vi.mock('@/application/background');

import { submitOverallAnalysis } from '@/application/overall/submitOverallAnalysis';
import { resolveOverallDependencies } from '@/application/overall/dependencyResolver';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { fireAndForget } from '@/application/background';
import type {
    AnalysisResponse,
    FundamentalAnalysisResponse,
    NewsAnalysisResponse,
} from '@/domain/types';
import type { SubmitOverallAnalysisOptions } from '@/application/overall/types';
import {
    makeEnrichedNewsItem,
    makeCalendarItem,
    minimalProvider,
} from './fixtures';

const mockResolveOverallDependencies = resolveOverallDependencies as Mock;
const mockCreateCacheProvider = createCacheProvider as Mock;
const mockSetJobMeta = setJobMeta as Mock;
const mockFireAndForget = fireAndForget as Mock;

// ─────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────

const cachedTechnical: AnalysisResponse = {
    trend: 'bullish',
    summary: 'Technical axis summary',
    riskLevel: 'medium',
    keyLevels: { support: [], resistance: [] },
    priceTargets: { bullish: null, bearish: null },
    indicatorResults: [],
    patternSummaries: [],
    strategyResults: [],
    candlePatterns: [],
    trendlines: [],
};

const cachedFundamental: FundamentalAnalysisResponse = {
    overallConclusionKo: '캐시된 펀더멘털 분석',
    categoryAssessments: [],
    riskFactorsKo: [],
    overallSentiment: 'neutral',
};

const cachedNews: NewsAnalysisResponse = {
    currentDriverKo: '캐시된 뉴스 분석',
    keyEventsKo: [],
    upcomingEventsKo: [],
    overallSentiment: 'neutral',
};

const cachedOverallResult = {
    headlineKo: '캐시된 종합 분석',
    technicalBulletsKo: [],
    fundamentalBulletsKo: [],
    newsBulletsKo: [],
    threeAxisConclusionKo: '3축 결론',
    scenarios: [],
    riskFactorsKo: [],
};

const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheProvider = {
    get: mockCacheGet,
    set: mockCacheSet,
    delete: vi.fn(),
};

const mockFetch = vi.fn();

/** Default options for submitOverallAnalysis. */
function makeOptions(
    overrides: Partial<SubmitOverallAnalysisOptions> = {}
): SubmitOverallAnalysisOptions {
    return {
        symbol: 'AAPL',
        timeframe: '1Day',
        modelId: 'gemini-2.5-flash',
        fundamentalProvider: minimalProvider,
        newsItems: [makeEnrichedNewsItem('n001')],
        upcomingCalendar: [makeCalendarItem('2026-07-25')],
        technical: {},
        ...overrides,
    };
}

// ─────────────────────────────────────────
// Tests
// ─────────────────────────────────────────

describe('submitOverallAnalysis 함수는', () => {
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
        mockSetJobMeta.mockResolvedValue(undefined);
        mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
        mockFireAndForget.mockImplementation(() => undefined);
        mockCacheGet.mockResolvedValue(null);
        mockCacheSet.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        process.env = originalEnv;
    });

    describe('의존성 축이 error 일 때', () => {
        it('error 를 반환하고 axis 와 error 를 포함한다', async () => {
            mockResolveOverallDependencies.mockResolvedValue({
                kind: 'error',
                axis: 'technical',
                error: { code: 'timeframe_not_allowed' },
            });

            const result = await submitOverallAnalysis(makeOptions());

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.axis).toBe('technical');
                expect(result.error).toEqual({ code: 'timeframe_not_allowed' });
            }
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockSetJobMeta).not.toHaveBeenCalled();
            expect(mockFireAndForget).not.toHaveBeenCalled();
        });
    });

    describe('의존성 축이 pending 일 때', () => {
        it('pending_dependencies 를 반환하고 캐시 및 잡 등록을 하지 않는다', async () => {
            mockResolveOverallDependencies.mockResolvedValue({
                kind: 'pending',
                pendingJobs: {
                    technical: 'tech-job-001',
                    fundamental: undefined,
                    news: 'news-job-001',
                },
            });

            const result = await submitOverallAnalysis(makeOptions());

            expect(result.status).toBe('pending_dependencies');
            if (result.status === 'pending_dependencies') {
                expect(result.pendingJobs.technical).toBe('tech-job-001');
                expect(result.pendingJobs.fundamental).toBeUndefined();
                expect(result.pendingJobs.news).toBe('news-job-001');
            }
            // No cache lookup or job submission should occur
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockSetJobMeta).not.toHaveBeenCalled();
            expect(mockFireAndForget).not.toHaveBeenCalled();
        });

        it('모든 축이 pending 이면 세 jobId 가 모두 반환된다', async () => {
            mockResolveOverallDependencies.mockResolvedValue({
                kind: 'pending',
                pendingJobs: {
                    technical: 'tech-job-aaa',
                    fundamental: 'fund-job-bbb',
                    news: 'news-job-ccc',
                },
            });

            const result = await submitOverallAnalysis(makeOptions());

            expect(result.status).toBe('pending_dependencies');
            if (result.status === 'pending_dependencies') {
                expect(result.pendingJobs.technical).toBe('tech-job-aaa');
                expect(result.pendingJobs.fundamental).toBe('fund-job-bbb');
                expect(result.pendingJobs.news).toBe('news-job-ccc');
            }
        });
    });

    describe('세 축 모두 cached 일 때', () => {
        beforeEach(() => {
            mockResolveOverallDependencies.mockResolvedValue({
                kind: 'cached',
                technical: cachedTechnical,
                fundamental: cachedFundamental,
                news: cachedNews,
            });
        });

        it('overall 캐시 히트 → cached 를 반환하고 잡 등록을 하지 않는다', async () => {
            mockCacheGet.mockResolvedValue(cachedOverallResult);

            const result = await submitOverallAnalysis(makeOptions());

            expect(result.status).toBe('cached');
            if (result.status === 'cached') {
                expect(result.result).toEqual(cachedOverallResult);
            }
            expect(mockSetJobMeta).not.toHaveBeenCalled();
            expect(mockFireAndForget).not.toHaveBeenCalled();
        });

        it('overall 캐시 미스 → submitted 를 반환하고 jobId 를 포함한다', async () => {
            mockCacheGet.mockResolvedValue(null);

            const result = await submitOverallAnalysis(makeOptions());

            expect(result.status).toBe('submitted');
            if (result.status === 'submitted') {
                expect(typeof result.jobId).toBe('string');
                expect(result.jobId.length).toBeGreaterThan(0);
            }
        });

        it('캐시 미스 시 setJobMeta 를 호출한다 (timeframe 포함)', async () => {
            mockCacheGet.mockResolvedValue(null);

            await submitOverallAnalysis(makeOptions());

            expect(mockSetJobMeta).toHaveBeenCalledTimes(1);
            expect(mockSetJobMeta).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    symbol: 'AAPL',
                    timeframe: '1Day',
                    modelId: 'gemini-2.5-flash',
                })
            );
        });

        it('캐시 미스 시 fireAndForget 으로 워커 POST 를 보낸다', async () => {
            mockCacheGet.mockResolvedValue(null);

            await submitOverallAnalysis(makeOptions());

            expect(mockFireAndForget).toHaveBeenCalledTimes(1);
            expect(mockFetch).toHaveBeenCalledWith(
                'https://worker.test/analyze',
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        'X-Worker-Secret': 'test-secret',
                    }),
                })
            );
        });

        it('캐시 프로바이더가 null 이어도 submitted 를 반환한다', async () => {
            mockCreateCacheProvider.mockReturnValue(null);

            const result = await submitOverallAnalysis(makeOptions());

            expect(result.status).toBe('submitted');
        });
    });

    describe('overall 캐시 키 안정성 (휘발성 필드 무시)', () => {
        it('technical.analyzedAt 만 다르면 동일한 캐시 키로 조회된다', async () => {
            // ── First call: technical has an analyzedAt timestamp ──
            mockResolveOverallDependencies.mockResolvedValueOnce({
                kind: 'cached',
                technical: {
                    ...cachedTechnical,
                    analyzedAt: '2026-05-03T12:00:00.000Z',
                },
                fundamental: cachedFundamental,
                news: cachedNews,
            });
            mockCacheGet.mockResolvedValueOnce(null);
            await submitOverallAnalysis(makeOptions());
            const firstCacheKey = mockCacheGet.mock.calls[0]?.[0];

            // ── Second call: same content but different analyzedAt ──
            mockResolveOverallDependencies.mockResolvedValueOnce({
                kind: 'cached',
                technical: {
                    ...cachedTechnical,
                    analyzedAt: '2026-05-03T13:30:00.000Z',
                },
                fundamental: cachedFundamental,
                news: cachedNews,
            });
            mockCacheGet.mockResolvedValueOnce(null);
            await submitOverallAnalysis(makeOptions());
            const secondCacheKey = mockCacheGet.mock.calls[1]?.[0];

            expect(firstCacheKey).toBe(secondCacheKey);
        });

        it('technical.skillsDegraded 만 다르면 동일한 캐시 키로 조회된다', async () => {
            mockResolveOverallDependencies.mockResolvedValueOnce({
                kind: 'cached',
                technical: {
                    ...cachedTechnical,
                    // skillsDegraded는 public 타입에 없지만 pollAnalysis가 캐시 본문에 부착할 수 있음
                    skillsDegraded: false,
                } as typeof cachedTechnical,
                fundamental: cachedFundamental,
                news: cachedNews,
            });
            mockCacheGet.mockResolvedValueOnce(null);
            await submitOverallAnalysis(makeOptions());
            const firstCacheKey = mockCacheGet.mock.calls[0]?.[0];

            mockResolveOverallDependencies.mockResolvedValueOnce({
                kind: 'cached',
                technical: {
                    ...cachedTechnical,
                    skillsDegraded: true,
                } as typeof cachedTechnical,
                fundamental: cachedFundamental,
                news: cachedNews,
            });
            mockCacheGet.mockResolvedValueOnce(null);
            await submitOverallAnalysis(makeOptions());
            const secondCacheKey = mockCacheGet.mock.calls[1]?.[0];

            expect(firstCacheKey).toBe(secondCacheKey);
        });

        it('technical 본문(summary)이 달라지면 캐시 키가 달라진다', async () => {
            mockResolveOverallDependencies.mockResolvedValueOnce({
                kind: 'cached',
                technical: { ...cachedTechnical, summary: 'A' },
                fundamental: cachedFundamental,
                news: cachedNews,
            });
            mockCacheGet.mockResolvedValueOnce(null);
            await submitOverallAnalysis(makeOptions());
            const firstCacheKey = mockCacheGet.mock.calls[0]?.[0];

            mockResolveOverallDependencies.mockResolvedValueOnce({
                kind: 'cached',
                technical: { ...cachedTechnical, summary: 'B' },
                fundamental: cachedFundamental,
                news: cachedNews,
            });
            mockCacheGet.mockResolvedValueOnce(null);
            await submitOverallAnalysis(makeOptions());
            const secondCacheKey = mockCacheGet.mock.calls[1]?.[0];

            expect(firstCacheKey).not.toBe(secondCacheKey);
        });
    });
});
