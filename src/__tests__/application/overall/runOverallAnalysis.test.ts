import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/application/analysis/callAnalysisAi');
vi.mock('@/infrastructure/cache/redis');
vi.mock('@/application/market/runAnalysis');
vi.mock('@/application/news/runNewsAnalysis');
vi.mock('@/application/market/barsApi');
vi.mock('@/application/usage');

import { runOverallAnalysis } from '@/application/overall/runOverallAnalysis';
import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { runAnalysisForOverall } from '@/application/market/runAnalysis';
import { runNewsAnalysis } from '@/application/news/runNewsAnalysis';
import { fetchBarsWithIndicators } from '@/application/market/barsApi';
import {
    checkAnalysisUsageAllowed,
    recordAnalysisUsageSafely,
} from '@/application/usage';
import { OVERALL_CACHE_TTL_SECONDS } from '@/infrastructure/cache/config';
import type { RunOverallAnalysisOptions } from '@/application/overall/types';
import type {
    AnalysisResponse,
    EnrichedNewsItem,
    NewsAnalysisResponse,
    OverallAnalysisResponse,
} from '@/domain/types';
import type { FundamentalDataProvider } from '@/domain/ports/fundamentalDataProvider';
import type { MarketDataProvider } from '@/domain/ports/marketDataProvider';

const mockCallAnalysisAi = callAnalysisAi as Mock;
const mockCreateCacheProvider = createCacheProvider as Mock;
const mockRunAnalysisForOverall = runAnalysisForOverall as Mock;
const mockRunNewsAnalysis = runNewsAnalysis as Mock;
const mockFetchBarsWithIndicators = fetchBarsWithIndicators as Mock;
const mockCheckAnalysisUsageAllowed = checkAnalysisUsageAllowed as Mock;
const mockRecordAnalysisUsageSafely = recordAnalysisUsageSafely as Mock;

const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheProvider = {
    get: mockCacheGet,
    set: mockCacheSet,
    delete: vi.fn(),
};

// ─────────────────────────────────────────
// Minimal domain mock data
// ─────────────────────────────────────────

/**
 * Minimal `AnalysisResponse` — all arrays empty so `buildOverallAnalysisPrompt`
 * skips every `if (arr.length > 0)` branch without crashing.
 * keyLevels has required `support` and `resistance` arrays.
 */
const mockTechnicalResult: AnalysisResponse = {
    summary: '기술적 강세 추세.',
    trend: 'bullish',
    riskLevel: 'medium',
    keyLevels: { support: [], resistance: [] },
    priceTargets: { bullish: null, bearish: null },
    patternSummaries: [],
    strategyResults: [],
    candlePatterns: [],
    trendlines: [],
    indicatorResults: [],
};

const mockNewsResult: NewsAnalysisResponse = {
    currentDriverKo: '뉴스 드라이버 요약.',
    keyEventsKo: [],
    upcomingEventsKo: [],
    overallSentiment: 'bullish',
};

const mockOverallResult: OverallAnalysisResponse = {
    headlineKo: '종합 분석 헤드라인.',
    technicalBulletsKo: [],
    fundamentalBulletsKo: [],
    newsBulletsKo: [],
    optionsBulletsKo: [],
    financialsBulletsKo: [],
    integratedConclusionKo: '통합 결론.',
    scenarios: [],
    riskFactorsKo: [],
};

const mockNewsItem: EnrichedNewsItem = {
    id: 'news-001',
    symbol: 'AAPL',
    source: 'Reuters',
    url: 'https://reuters.com/1',
    publishedAt: '2026-08-01T10:00:00Z',
    titleEn: 'Apple news',
    bodyEn: 'Body text.',
    card: {
        titleKo: '애플 뉴스',
        bodyKo: '본문.',
        summaryKo: '요약.',
        sentiment: 'bullish',
        category: 'earnings',
        priceImpact: 'medium',
    },
};

// Stub providers — never called in the crypto test path.
const stubFundamentalProvider = {} as FundamentalDataProvider;
const stubMarketDataProvider = {} as MarketDataProvider;

/**
 * Base options that use `assetClass: 'crypto'` to skip the fundamental and
 * options axes — keeps the test focused on overall-layer gating, not axis deps.
 *
 * `tier` is omitted so the usage-limit check is bypassed
 * (guard: `if (options.tier !== undefined && usage !== undefined)`).
 */
function baseOptions(): RunOverallAnalysisOptions {
    return {
        symbol: 'AAPL',
        timeframe: '1Day',
        modelId: 'deepseek-v4-flash',
        assetClass: 'crypto',
        technical: {},
        newsItems: [mockNewsItem],
        upcomingCalendar: [],
        fundamentalProvider: stubFundamentalProvider,
        marketDataProvider: stubMarketDataProvider,
    };
}

describe('runOverallAnalysis', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockCacheGet.mockResolvedValue(null);
        mockCacheSet.mockResolvedValue(undefined);

        // Default axis mocks: all return 'done'
        mockRunAnalysisForOverall.mockResolvedValue({
            status: 'done',
            result: mockTechnicalResult,
        });
        mockRunNewsAnalysis.mockResolvedValue({
            status: 'done',
            result: mockNewsResult,
        });

        // fetchBarsWithIndicators: return empty bars so computeFearGreedIndex → null
        mockFetchBarsWithIndicators.mockResolvedValue({
            bars: [],
            indicators: { buySellVolume: [] },
        });

        mockCallAnalysisAi.mockResolvedValue(JSON.stringify(mockOverallResult));

        mockCheckAnalysisUsageAllowed.mockResolvedValue(true);
        mockRecordAnalysisUsageSafely.mockResolvedValue(undefined);
    });

    describe('cache hit', () => {
        it('overall cache hit → callAnalysisAi NOT called, returns {status:"cached"}', async () => {
            mockCacheGet.mockResolvedValueOnce(mockOverallResult);

            const result = await runOverallAnalysis(baseOptions());

            expect(result.status).toBe('cached');
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });

        it('캐시 히트 시 recordAnalysisUsageSafely가 호출된다', async () => {
            mockCacheGet.mockResolvedValueOnce(mockOverallResult);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const usage = { userId: 'u1', occurredAt: new Date() } as any;
            await runOverallAnalysis({ ...baseOptions(), usage });

            // usage record is called on cache hit too (overall-layer ownership)
            expect(mockRecordAnalysisUsageSafely).toHaveBeenCalledTimes(1);
        });
    });

    describe('skipEnqueueIfMiss', () => {
        it('모든 축 resolved 후 overall cache miss + skipEnqueueIfMiss → miss_no_trigger', async () => {
            const result = await runOverallAnalysis({
                ...baseOptions(),
                skipEnqueueIfMiss: true,
            });

            expect(result.status).toBe('miss_no_trigger');
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });
    });

    describe('axis error propagation', () => {
        it('technical 축 오류 → status:error / axis:technical', async () => {
            mockRunAnalysisForOverall.mockResolvedValueOnce({
                status: 'error',
                error: 'bars fetch failed',
            });

            const result = await runOverallAnalysis(baseOptions());

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.axis).toBe('technical');
            }
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });

        it('news 축 오류 → status:error / axis:news', async () => {
            mockRunNewsAnalysis.mockResolvedValueOnce({
                status: 'error',
                code: 'no_news',
                error: 'no news items',
            });

            const result = await runOverallAnalysis(baseOptions());

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.axis).toBe('news');
            }
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });
    });

    describe('miss_no_trigger propagation from axis', () => {
        it('technical 축 miss_no_trigger → 전체 miss_no_trigger 반환', async () => {
            mockRunAnalysisForOverall.mockResolvedValueOnce({
                status: 'miss_no_trigger',
            });

            const result = await runOverallAnalysis(baseOptions());

            expect(result.status).toBe('miss_no_trigger');
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });

        it('news 축 miss_no_trigger → 전체 miss_no_trigger 반환', async () => {
            mockRunNewsAnalysis.mockResolvedValueOnce({
                status: 'miss_no_trigger',
            });

            const result = await runOverallAnalysis(baseOptions());

            expect(result.status).toBe('miss_no_trigger');
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });
    });

    describe('happy path — cache miss → LLM', () => {
        it('callAnalysisAi를 1회 호출하고 done을 반환한다', async () => {
            const result = await runOverallAnalysis(baseOptions());

            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(result.status).toBe('done');
        });

        it('signal을 callAnalysisAi에 그대로 전달한다', async () => {
            const controller = new AbortController();

            await runOverallAnalysis({
                ...baseOptions(),
                signal: controller.signal,
            });

            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ signal: controller.signal })
            );
        });

        it('결과를 OVERALL_CACHE_TTL_SECONDS로 캐시에 기록한다', async () => {
            await runOverallAnalysis(baseOptions());

            expect(mockCacheSet).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    headlineKo: expect.any(String),
                }),
                OVERALL_CACHE_TTL_SECONDS
            );
        });

        it('peek 키도 OVERALL_CACHE_TTL_SECONDS로 캐시에 기록한다', async () => {
            await runOverallAnalysis(baseOptions());

            // Two cache writes: canonical key + peek key
            const writeCalls = mockCacheSet.mock.calls.filter(
                ([, , ttl]) => ttl === OVERALL_CACHE_TTL_SECONDS
            );
            expect(writeCalls.length).toBeGreaterThanOrEqual(2);
        });

        it('recordAnalysisUsageSafely는 LLM 반환 후 호출된다', async () => {
            let aiResolve: (v: string) => void = () => {};
            mockCallAnalysisAi.mockReturnValueOnce(
                new Promise<string>(resolve => {
                    aiResolve = resolve;
                })
            );

            const call = runOverallAnalysis({
                ...baseOptions(),
                usage: {
                    usageRepository: {
                        recordUsage: vi.fn(),
                        getUsageToday: vi.fn().mockResolvedValue(0),
                    },
                    clientIp: '203.0.113.10',
                    userId: 'u1',
                    occurredAt: new Date(),
                },
            });

            // Usage not yet recorded (LLM still in-flight)
            expect(mockRecordAnalysisUsageSafely).not.toHaveBeenCalled();

            aiResolve(JSON.stringify(mockOverallResult));
            await call;

            expect(mockRecordAnalysisUsageSafely).toHaveBeenCalledTimes(1);
        });
    });

    describe('in-flight 중복 제거', () => {
        it('같은 캐시 키 동시 호출은 LLM을 1회만 태운다', async () => {
            let resolveAi: (value: string) => void = () => {};
            mockCallAnalysisAi.mockReturnValueOnce(
                new Promise<string>(resolve => {
                    resolveAi = resolve;
                })
            );

            const both = Promise.all([
                runOverallAnalysis(baseOptions()),
                runOverallAnalysis(baseOptions()),
            ]);

            resolveAi(JSON.stringify(mockOverallResult));
            const [a, b] = await both;

            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(a.status).toBe('done');
            expect(b.status).toBe('done');
        });
    });

    describe('runOverallAnalysis — 출력 로케일', () => {
        /**
         * 상위 프롬프트만 로케일을 받고 축은 안 받으면, 축은 늘 한국어로 답하고
         * 그 한국어가 `Summary (KO): …`로 상위 프롬프트에 박힌다 — "다른 언어로
         * 쓰라"는 지시와 **모순되는 입력**이 만들어진다(PR #184 리뷰 1라운드).
         */
        it('로케일을 하위 축(technical·news)에 그대로 넘긴다', async () => {
            await runOverallAnalysis({ ...baseOptions(), locale: 'en' });

            expect(mockRunAnalysisForOverall).toHaveBeenCalled();
            const technicalArgs = mockRunAnalysisForOverall.mock.calls[0]!;
            expect(
                technicalArgs.some(a =>
                    typeof a === 'object' && a !== null && 'locale' in a
                        ? (a as { locale?: string }).locale === 'en'
                        : false
                )
            ).toBe(true);

            expect(mockRunNewsAnalysis).toHaveBeenCalledWith(
                expect.objectContaining({ locale: 'en' })
            );
        });

        it('로케일을 생략하면 축에도 undefined가 간다 — 축이 기본(ko)으로 떨어진다', async () => {
            await runOverallAnalysis(baseOptions());

            expect(mockRunNewsAnalysis).toHaveBeenCalledWith(
                expect.objectContaining({ locale: undefined })
            );
        });

        it('비-ko는 상위 프롬프트 말미에 출력 언어 리마인더를 싣는다', async () => {
            await runOverallAnalysis({ ...baseOptions(), locale: 'ja' });

            const prompt = (
                mockCallAnalysisAi.mock.calls.at(-1)![0] as { prompt: string }
            ).prompt as string;
            expect(prompt).toContain(
                'OUTPUT LANGUAGE (FINAL, OVERRIDES EVERYTHING ABOVE)'
            );
        });
    });
});
