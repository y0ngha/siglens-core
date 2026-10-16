import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/application/analysis/callAnalysisAi');
vi.mock('@/infrastructure/cache/redis');
vi.mock('@/application/market/runAnalysis');
vi.mock('@/application/news/runNewsAnalysis');
vi.mock('@/application/market/barsApi');
vi.mock('@/application/usage');
vi.mock('@/application/fundamental/runFundamentalAnalysis');
vi.mock('@/application/options/runOptionsAnalysis');

import { runOverallAnalysis } from '@/application/overall/runOverallAnalysis';
import { CRYPTO_SESSION } from '@/domain/session';
import { makeKrSession } from '../../helpers/krSession';
import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { runAnalysisForOverall } from '@/application/market/runAnalysis';
import { runNewsAnalysis } from '@/application/news/runNewsAnalysis';
import { fetchBarsWithIndicators } from '@/application/market/barsApi';
import { runFundamentalAnalysis } from '@/application/fundamental/runFundamentalAnalysis';
import { runOptionsAnalysis } from '@/application/options/runOptionsAnalysis';
import {
    checkAnalysisUsageAllowed,
    recordAnalysisUsageSafely,
} from '@/application/usage';
import { OVERALL_CACHE_TTL_SECONDS } from '@/infrastructure/cache/config';
import {
    OVERALL_RESPONSE_SCHEMA,
    OVERALL_WITH_INVESTOR_FLOWS_RESPONSE_SCHEMA,
} from '@/domain/analysis/responseSchemas';
import { evaluateInvestorFlows } from '@/domain/investorFlows/evaluateInvestorFlows';
import {
    emptySnapshot,
    insiderTx,
    quarter,
    topHolders,
} from '../../fixtures/investorFlows';
import type { RunOverallAnalysisOptions } from '@/application/overall/types';
import type {
    InvestorFlowsScorecard,
    AnalysisResponse,
    EconomicCalendarEvent,
    EnrichedNewsItem,
    FundamentalAnalysisResponse,
    MarketEvent,
    OptionsAnalysisResponse,
    OptionsSnapshot,
    NewsAnalysisResponse,
    OverallAnalysisResponse,
    PriorAnalysis,
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
const mockRunFundamentalAnalysis = runFundamentalAnalysis as Mock;
const mockRunOptionsAnalysis = runOptionsAnalysis as Mock;

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

const mockFundamentalResult: FundamentalAnalysisResponse = {
    overallConclusionKo: '펀더멘털 결론.',
    categoryAssessments: [],
    riskFactorsKo: [],
    overallSentiment: 'neutral',
};

const mockOptionsResult: OptionsAnalysisResponse = {
    summary: '옵션 포지셔닝 요약.',
    perExpiration: [],
    signals: [],
    analyzedAt: '2026-09-01T00:00:00.000Z',
};

/** Options snapshot whose only expiration is far in the future. */
const FUTURE_EXPIRATION = '2099-01-15';
const futureOptionsSnapshot: OptionsSnapshot = {
    symbol: 'AAPL',
    underlyingPrice: 200,
    chains: [
        {
            expirationDate: FUTURE_EXPIRATION,
            daysToExpiration: 9999,
            calls: [],
            puts: [],
        },
    ],
    capturedAt: '2026-09-01T00:00:00.000Z',
};

/** Options snapshot whose only expiration is already in the past. */
const expiredOptionsSnapshot: OptionsSnapshot = {
    ...futureOptionsSnapshot,
    chains: [
        {
            expirationDate: '2000-01-21',
            daysToExpiration: 0,
            calls: [],
            puts: [],
        },
    ],
};

function makeUsage(): NonNullable<RunOverallAnalysisOptions['usage']> {
    return {
        usageRepository: {
            recordUsage: vi.fn(),
            getUsageToday: vi.fn().mockResolvedValue(0),
        },
        clientIp: '203.0.113.10',
        userId: 'u1',
        occurredAt: new Date(),
    };
}

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
        modelId: 'deepseek-v4.1-flash',
        assetClass: 'crypto',
        technical: {},
        newsItems: [mockNewsItem],
        upcomingCalendar: [],
        fundamentalProvider: stubFundamentalProvider,
        marketDataProvider: stubMarketDataProvider,
    };
}

/** `baseOptions()` switched to equity so the fundamental/options axes run. */
function equityOptions(): RunOverallAnalysisOptions {
    return { ...baseOptions(), assetClass: 'equity' };
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

        // Equity-only axes (crypto `baseOptions()` never reaches them)
        mockRunFundamentalAnalysis.mockResolvedValue({
            status: 'done',
            result: mockFundamentalResult,
        });
        mockRunOptionsAnalysis.mockResolvedValue({
            status: 'done',
            result: mockOptionsResult,
        });
    });

    describe('cache hit', () => {
        it('overall cache hit → callAnalysisAi NOT called, returns {status:"cached"}', async () => {
            mockCacheGet.mockResolvedValueOnce(mockOverallResult);

            const result = await runOverallAnalysis(baseOptions());

            expect(result.status).toBe('cached');
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });

        it('캐시 히트 결과가 analyzedAt을 이미 가지고 있으면 그대로 통과시킨다 (스펙 §2.5)', async () => {
            mockCacheGet.mockResolvedValueOnce({
                ...mockOverallResult,
                analyzedAt: '2026-05-30T00:00:00.000Z',
            });

            const result = await runOverallAnalysis(baseOptions());

            expect(result.status).toBe('cached');
            if (result.status === 'cached') {
                expect(result.result.analyzedAt).toBe(
                    '2026-05-30T00:00:00.000Z'
                );
            }
        });

        it('캐시 히트 결과에 analyzedAt이 없으면(과거 항목) 생략된 채로 반환한다', async () => {
            mockCacheGet.mockResolvedValueOnce(mockOverallResult);

            const result = await runOverallAnalysis(baseOptions());

            expect(result.status).toBe('cached');
            if (result.status === 'cached') {
                expect(result.result.analyzedAt).toBeUndefined();
            }
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

        it('news 축 오류(usage_limit_exceeded) → status:error / axis:news', async () => {
            mockRunNewsAnalysis.mockResolvedValueOnce({
                status: 'error',
                code: 'usage_limit_exceeded',
                error: 'limit',
            });

            const result = await runOverallAnalysis(baseOptions());

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.axis).toBe('news');
            }
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });

        /**
         * `no_news`는 장애가 아니라 커버리지의 성질이다(레버리지 ETF·뮤추얼펀드·
         * 저커버리지 OTC). 여기서 error로 올리면 그 종목들은 기술적·펀더멘털
         * 데이터가 멀쩡해도 overall을 영원히 못 만든다.
         */
        it('news 축 no_news → 오류가 아니라 abstain, 분석은 그대로 진행된다', async () => {
            mockRunNewsAnalysis.mockResolvedValueOnce({
                status: 'error',
                code: 'no_news',
                error: 'No news to analyze',
            });

            const result = await runOverallAnalysis(baseOptions());

            // `not.toBe('error')`는 miss_no_trigger로 조용히 빠지는 회귀도
            // 통과시킨다 — 그게 이 변경이 없애려던 증상이므로 결과를 못박는다.
            expect(result.status).toBe('done');
        });

        /**
         * 이 변경의 핵심은 "뉴스 축이 **지어낸 내용이 아니라 abstain으로**
         * 모델에 도달한다"는 것이다. 그 경로에 단언이 없으면, 없는 뉴스를
         * 날조해 넘기는 변경이 들어와도 스위트가 전부 초록으로 남는다.
         */
        it('no_news면 프롬프트에 방향 중립 안내가 실리고 날조된 뉴스가 실리지 않는다', async () => {
            mockRunNewsAnalysis.mockResolvedValueOnce({
                status: 'error',
                code: 'no_news',
                error: 'No news to analyze',
            });

            await runOverallAnalysis(baseOptions());

            const prompt = (
                mockCallAnalysisAi.mock.calls.at(-1)![0] as { prompt: string }
            ).prompt;
            const newsSection = prompt
                .split('## Axis 3 — News Analysis')[1]!
                .split('## Axis 4')[0]!;
            expect(newsSection).toContain(
                'No news items were available for this symbol in the analysis window.'
            );
            expect(newsSection).not.toContain('- Overall Sentiment:');
            expect(newsSection).not.toContain('- Current Driver (KO):');
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

        it('새로 생성된 결과에 analyzedAt(ISO 문자열)을 부착한다 (스펙 §2.5)', async () => {
            const before = Date.now();
            const result = await runOverallAnalysis(baseOptions());
            const after = Date.now();

            expect(result.status).toBe('done');
            if (result.status === 'done') {
                expect(result.result.analyzedAt).toBeDefined();
                const t = new Date(result.result.analyzedAt!).getTime();
                expect(t).toBeGreaterThanOrEqual(before);
                expect(t).toBeLessThanOrEqual(after);
            }
        });

        it('캐시에 쓰는 결과에도 analyzedAt이 포함된다', async () => {
            await runOverallAnalysis(baseOptions());

            expect(mockCacheSet).toHaveBeenCalled();
            const [, cachedValue] = mockCacheSet.mock.calls.find(
                call => typeof call[1] === 'object' && call[1] !== null
            )!;
            expect(
                (cachedValue as OverallAnalysisResponse).analyzedAt
            ).toBeDefined();
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

    describe('onPromptAssembled', () => {
        it('cache miss → called once with the exact system/stable/dynamic the provider call receives', async () => {
            const onPromptAssembled = vi.fn();

            await runOverallAnalysis({ ...baseOptions(), onPromptAssembled });

            expect(onPromptAssembled).toHaveBeenCalledTimes(1);
            const providerArgs = mockCallAnalysisAi.mock.calls[0]![0] as {
                system: string;
                prompt: string;
            };
            expect(onPromptAssembled).toHaveBeenCalledWith({
                system: providerArgs.system,
                // Design C: no skills catalog on the overall axis, so `stable`
                // is always ''.
                stable: '',
                dynamic: providerArgs.prompt,
                promptVersion: expect.any(String),
            });
        });

        it('cache hit → NOT called', async () => {
            mockCacheGet.mockResolvedValueOnce(mockOverallResult);
            const onPromptAssembled = vi.fn();

            await runOverallAnalysis({ ...baseOptions(), onPromptAssembled });

            expect(onPromptAssembled).not.toHaveBeenCalled();
        });

        it('a throwing callback does not fail the analysis or change the result', async () => {
            const onPromptAssembled = vi.fn(() => {
                throw new Error('persistence boom');
            });
            const consoleErrorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});

            const withCallback = await runOverallAnalysis({
                ...baseOptions(),
                onPromptAssembled,
            });

            mockCacheGet.mockClear();
            const withoutCallback = await runOverallAnalysis(baseOptions());

            expect(onPromptAssembled).toHaveBeenCalledTimes(1);
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('onPromptAssembled'),
                expect.any(Error)
            );
            // `analyzedAt` (spec 2026-09-18 §2.5) is a real wall-clock
            // timestamp attached fresh on each call — two genuinely separate
            // `runOverallAnalysis` invocations can land in different
            // milliseconds, which is not the thing this test is checking.
            // Compare everything else exactly, and only assert both have
            // SOME defined `analyzedAt` (not that it's numerically identical).
            expect(withCallback.status).toBe('done');
            expect(withoutCallback.status).toBe('done');
            if (
                withCallback.status === 'done' &&
                withoutCallback.status === 'done'
            ) {
                const { analyzedAt: withCallbackAt, ...withCallbackRest } =
                    withCallback.result;
                const {
                    analyzedAt: withoutCallbackAt,
                    ...withoutCallbackRest
                } = withoutCallback.result;
                expect(withCallbackRest).toEqual(withoutCallbackRest);
                expect(withCallbackAt).toBeDefined();
                expect(withoutCallbackAt).toBeDefined();
            }

            consoleErrorSpy.mockRestore();
        });

        it('omitting it leaves the result and the cache key unchanged', async () => {
            await runOverallAnalysis(baseOptions());
            const keyWithoutCallback = mockCacheGet.mock.calls[0]![0];

            mockCacheGet.mockClear();
            await runOverallAnalysis({
                ...baseOptions(),
                onPromptAssembled: vi.fn(),
            });
            const keyWithCallback = mockCacheGet.mock.calls[0]![0];

            expect(keyWithCallback).toEqual(keyWithoutCallback);
        });
    });

    describe('technical dataAsOf and the overall cache key', () => {
        it('a technical result carrying dataAsOf hashes to the same overall key as one without it', async () => {
            await runOverallAnalysis(baseOptions());
            const keyWithout = mockCacheGet.mock.calls.find(([key]) =>
                String(key).includes(':overall:')
            )?.[0];

            mockCacheGet.mockClear();
            mockRunAnalysisForOverall.mockResolvedValue({
                status: 'done',
                result: {
                    ...mockTechnicalResult,
                    dataAsOf: { barTime: 1_759_363_200, close: 333.69 },
                },
            });
            await runOverallAnalysis(baseOptions());
            const keyWith = mockCacheGet.mock.calls.find(([key]) =>
                String(key).includes(':overall:')
            )?.[0];

            expect(keyWithout).toBeDefined();
            expect(keyWith).toEqual(keyWithout);
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

        it('동시 호출이어도 onPromptAssembled는 생성 1회당 한 번만 발화한다', async () => {
            // 회귀 가드 — `runAnalysis.test.ts`의 동명 테스트와 같은 이유.
            let resolveAi: (value: string) => void = () => {};
            mockCallAnalysisAi.mockReturnValueOnce(
                new Promise<string>(resolve => {
                    resolveAi = resolve;
                })
            );

            const onPromptAssembled = vi.fn();
            const both = Promise.all([
                runOverallAnalysis({ ...baseOptions(), onPromptAssembled }),
                runOverallAnalysis({ ...baseOptions(), onPromptAssembled }),
            ]);

            resolveAi(JSON.stringify(mockOverallResult));
            await both;

            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(onPromptAssembled).toHaveBeenCalledTimes(1);

            const sent = mockCallAnalysisAi.mock.calls[0]![0] as {
                prompt: string;
                system: string;
            };
            const captured = onPromptAssembled.mock.calls[0]![0] as {
                dynamic: string;
                system: string;
            };
            expect(captured.dynamic).toBe(sent.prompt);
            expect(captured.system).toBe(sent.system);
        });
    });

    /**
     * `options.priorAnalyses`가 `narrowPriorAnalysesForCacheKey`를 거쳐
     * `inputHash`(→ `buildOverallCacheKey`)에 접히는지, 그리고 생략했을 때
     * 기존 캐시 키와 바이트가 같은지 확인한다 (Task 6c).
     */
    describe('prior-analysis-context (Task 6c)', () => {
        it('priorAnalyses를 생략하면 캐시 키가 예전과 동일하다', async () => {
            await runOverallAnalysis(baseOptions());
            const omittedKey = mockCacheGet.mock.calls[0]![0] as string;

            mockCacheGet.mockClear();
            await runOverallAnalysis({ ...baseOptions(), priorAnalyses: [] });
            const emptyArrayKey = mockCacheGet.mock.calls[0]![0] as string;

            expect(emptyArrayKey).toBe(omittedKey);
        });

        it('현재 캐시 윈도우 안에서 생성된 priorAnalyses만 있으면(생존자 0명) 캐시 키가 생략 시와 동일하다', async () => {
            await runOverallAnalysis(baseOptions());
            const omittedKey = mockCacheGet.mock.calls[0]![0] as string;

            mockCacheGet.mockClear();
            await runOverallAnalysis({
                ...baseOptions(),
                // '1Day' → OVERALL_CACHE_TTL_SECONDS window; "now" is inside it,
                // so stage 1 excludes it and the fingerprint stays undefined —
                // same `ph: undefined` folded into inputHash as the omitted case.
                priorAnalyses: [
                    {
                        generatedAt: new Date(),
                        trend: 'bullish',
                        riskLevel: 'low',
                    },
                ],
            });
            const withRecentHistoryKey = mockCacheGet.mock
                .calls[0]![0] as string;

            expect(withRecentHistoryKey).toBe(omittedKey);
        });

        it('윈도우 밖의 priorAnalyses가 있으면 캐시 키가 생략 시와 달라진다', async () => {
            await runOverallAnalysis(baseOptions());
            const omittedKey = mockCacheGet.mock.calls[0]![0] as string;

            mockCacheGet.mockClear();
            await runOverallAnalysis({
                ...baseOptions(),
                priorAnalyses: [
                    {
                        generatedAt: new Date('2020-01-01T00:00:00.000Z'),
                        trend: 'bullish',
                        riskLevel: 'low',
                    },
                ],
            });
            const withOldHistoryKey = mockCacheGet.mock.calls[0]![0] as string;

            expect(withOldHistoryKey).not.toBe(omittedKey);
        });

        it('technical.session이 있으면 overall 이력 버킷도 마지막 세션 경계에서 시작한다', async () => {
            const now = new Date('2026-09-29T21:30:00.000Z'); // 06:30 KST 수
            const eveningRow: PriorAnalysis = {
                generatedAt: new Date('2026-09-29T10:30:00.000Z'), // 19:30 KST 화
                trend: 'bullish',
                riskLevel: 'low',
            };
            const keyFor = async (
                priorAnalyses: readonly PriorAnalysis[],
                withSession: boolean
            ): Promise<string> => {
                mockCacheGet.mockClear();
                const base = baseOptions();
                await runOverallAnalysis({
                    ...base,
                    now,
                    priorAnalyses,
                    technical: {
                        ...base.technical,
                        session: withSession ? makeKrSession() : undefined,
                    },
                });
                return mockCacheGet.mock.calls[0]![0] as string;
            };

            // 세션 경계(16:00 KST 화) 뒤의 행은 키에서 빠진다 → 이력 없는 키와 같다.
            expect(await keyFor([eveningRow], true)).toBe(
                await keyFor([], true)
            );
            // 세션 없이는 KST 05:00 앵커라 같은 행이 키를 바꾼다(수정 전 동작).
            expect(await keyFor([eveningRow], false)).not.toBe(
                await keyFor([], false)
            );
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
    /**
     * 배포 안정성 감사 지적: `fetchBarsWithIndicators`는 core 안에서 캐시되지
     * 않는다(provider 호출 pass-through). 렌더할 이력이 없는데도 매 캐시
     * 미스마다 페치 + `calculateIndicators`를 돌리면 순수 낭비다.
     *
     * 타임프레임은 `baseOptions()`의 '1Day'를 유지한다 — tier를 넘기지 않으면
     * free로 떨어져 장중 타임프레임이 게이트에 막히고, 그러면 step 8b에
     * 도달하기도 전에 리턴돼 이 테스트가 무의미해진다. 그래서 페치 두 종류를
     * 인자가 아니라 **호출 수**로 가른다: Fear & Greed 몫 1회는 항상 있고,
     * 이력용 페치가 붙으면 2회가 된다.
     */
    describe('prior-analysis bars fetch gating', () => {
        it('priorAnalyses가 없으면 이력용 봉을 페치하지 않는다 (F&G 1회뿐)', async () => {
            await runOverallAnalysis(baseOptions());

            expect(mockFetchBarsWithIndicators).toHaveBeenCalledTimes(1);
        });

        it('priorAnalyses가 전부 현재 캐시 윈도우 안이면(생존자 0명) 페치하지 않는다', async () => {
            await runOverallAnalysis({
                ...baseOptions(),
                priorAnalyses: [
                    {
                        generatedAt: new Date(),
                        trend: 'bullish',
                        riskLevel: 'medium',
                    },
                ],
            });

            expect(mockFetchBarsWithIndicators).toHaveBeenCalledTimes(1);
        });

        it('페치한 봉이 실제로 프롬프트의 Prior Analyses 섹션까지 배선된다', async () => {
            // 호출 수만 세는 위 두 테스트는 게이트의 on/off만 고정한다 — 두 번째
            // 페치 결과가 buildOverallAnalysisPrompt의 `bars`로 흘러가는지는
            // 잡지 못한다(기본 목이 `bars: []`를 돌려줘 섹션이 어차피 안 그려짐).
            // 여기서만 실물 봉을 돌려주고, 렌더된 프롬프트로 배선을 확인한다.
            const generatedAt = new Date('2026-01-05T00:00:00.000Z');
            const bars = Array.from({ length: 30 }, (_, i) => ({
                // generatedAt이 중간 봉에 앵커되도록 그 앞뒤로 봉을 깐다.
                time:
                    Math.floor(generatedAt.getTime() / 1000) -
                    (15 - i) * 86_400,
                open: 100,
                high: 101,
                low: 99,
                close: 100,
                volume: 1000,
            }));
            mockFetchBarsWithIndicators.mockResolvedValue({
                bars,
                indicators: { buySellVolume: [] },
            });

            await runOverallAnalysis({
                ...baseOptions(),
                priorAnalyses: [
                    {
                        generatedAt,
                        trend: 'bullish',
                        riskLevel: 'medium',
                    },
                ],
            });

            const prompt = (
                mockCallAnalysisAi.mock.calls.at(-1)![0] as { prompt: string }
            ).prompt;
            expect(prompt).toContain('## Prior Analyses');
        });

        it("공유된 '1Day' 페치가 실패하면 로그가 한 번만 찍힌다", async () => {
            // 두 파생 promise가 같은 `dailyBarsPromise`를 공유하므로, 각자
            // catch를 달면 하나의 원인에 대해 console.error가 두 줄 찍혀
            // 독립된 두 장애처럼 읽힌다. 로깅은 공유 지점 한 곳에만 둔다.
            mockFetchBarsWithIndicators.mockRejectedValue(
                new Error('upstream down')
            );
            const errorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});

            try {
                await runOverallAnalysis({
                    ...baseOptions(), // timeframe: '1Day'
                    priorAnalyses: [
                        {
                            generatedAt: new Date('2020-01-01T00:00:00.000Z'),
                            trend: 'bullish',
                            riskLevel: 'medium',
                        },
                    ],
                });

                const barsFailureLogs = errorSpy.mock.calls.filter(call =>
                    String(call[0]).includes('Daily bars fetch failed')
                );
                expect(barsFailureLogs).toHaveLength(1);
            } finally {
                errorSpy.mockRestore();
            }
        });

        it("timeframe이 '1Day'면 Fear & Greed 페치를 재사용해 한 번만 부른다", async () => {
            // F&G는 언제나 '1Day'를 부른다. overall 요청 자체가 '1Day'면 두 호출의
            // 인자가 완전히 동일해지는데, `fetchBarsWithIndicators`는 core에서
            // 캐시되지 않으므로(+ `calculateIndicators` 포함) 같은 업스트림 호출과
            // 지표 계산을 두 번 치르게 된다. 같은 promise를 공유해 한 번으로 줄인다.
            await runOverallAnalysis({
                ...baseOptions(), // timeframe: '1Day'
                priorAnalyses: [
                    {
                        generatedAt: new Date('2020-01-01T00:00:00.000Z'),
                        trend: 'bullish',
                        riskLevel: 'medium',
                    },
                ],
            });

            expect(mockFetchBarsWithIndicators).toHaveBeenCalledTimes(1);
        });

        it('timeframe이 1Day가 아니면 이력용 봉을 따로 한 번 더 페치한다', async () => {
            // pro tier를 명시해야 장중 타임프레임이 티어 게이트에 막히지 않는다 —
            // 막히면 봉 페치 지점에 도달하기도 전에 리턴돼 이 테스트가 무의미해진다.
            await runOverallAnalysis({
                ...baseOptions(),
                timeframe: '1Hour',
                tier: 'pro',
                priorAnalyses: [
                    {
                        generatedAt: new Date('2020-01-01T00:00:00.000Z'),
                        trend: 'bullish',
                        riskLevel: 'medium',
                    },
                ],
            });

            expect(mockFetchBarsWithIndicators).toHaveBeenCalledTimes(2);
        });
    });

    describe('technical 축 캐시 키 정합', () => {
        /**
         * `priorAnalyses`/`marketEvents`는 technical 축 캐시 키의 `:hist=`·`:evt=`
         * 구간으로 접힌다. 소비자가 자기 단독 `runAnalysis` 호출에는 넘기면서
         * 여기에는 안 넘기면 같은 분석에 키가 둘 생기고, overall이 캐시에서 읽을 수
         * 있었을 technical을 다시 생성한다 — siglens가 2026-09-11부터 실제로 그
         * 모양이었고 심볼당 매일 밤 ~5k 토큰을 중복 지불했다.
         *
         * 이 테스트가 지키는 것은 "전달된다"이지 "키가 같다"가 아니다. 키 조립은
         * `runAnalysisImpl` 안에 있고 여기서는 목이라 볼 수 없다 — 전달만 끊기지
         * 않으면 키 정합은 그쪽 테스트가 담당한다.
         *
         * ⚠️ **이 테스트 단독으로는 타입 축소를 못 잡는다.** `technical` Pick에서
         * 두 키를 도로 빼도 여기는 통과한다 — 전달이 `...technicalRest` 스프레드라
         * 런타임엔 타입이 없기 때문이다(실측: 되돌린 상태에서 35/35 통과). 그 방향을
         * 잡는 건 `yarn typecheck`다(TS2353). 이 테스트가 실제로 막는 것은 축 호출에
         * `priorAnalyses: undefined` 같은 명시적 덮어쓰기가 끼어드는 경우다.
         */
        it('technical.priorAnalyses와 technical.marketEvents를 technical 축 호출로 그대로 넘긴다', async () => {
            const priorAnalyses: readonly PriorAnalysis[] = [
                {
                    generatedAt: new Date('2026-09-01T00:00:00.000Z'),
                    trend: 'bullish',
                    riskLevel: 'medium',
                },
            ];
            const marketEvents: readonly MarketEvent[] = [
                {
                    publishedAt: new Date('2026-09-02T00:00:00.000Z'),
                    category: 'earnings',
                    sentiment: 'bullish',
                    impact: 'high',
                },
            ];

            await runOverallAnalysis({
                ...baseOptions(),
                // 심볼로 이 테스트의 호출을 식별한다 — `mock.calls[0]`을 쓰면 앞선
                // 테스트의 늦은 호출이 그 자리를 차지할 수 있다.
                symbol: 'PARITY',
                technical: { priorAnalyses, marketEvents },
            });

            const call = mockRunAnalysisForOverall.mock.calls.find(
                c => c[0] === 'PARITY'
            );
            expect(call).toBeDefined();
            expect(call?.[5]).toMatchObject({ priorAnalyses, marketEvents });
        });

        // 보유 종목이 있는 회원의 technical 탭은 `:pos=` 키로 캐시된다. overall의
        // technical 축이 버킷을 못 받으면 그 키를 영원히 못 맞혀 매번 다시
        // 생성했다(2026-09-29 감사). `technical.positionBucket`이 그대로 전달돼야 한다.
        it('technical.positionBucket을 technical 축 호출에 그대로 넘긴다', async () => {
            await runOverallAnalysis({
                ...baseOptions(),
                symbol: 'BUCKET',
                technical: { positionBucket: 'profit' },
            });

            const call = mockRunAnalysisForOverall.mock.calls.find(
                c => c[0] === 'BUCKET'
            );
            expect(call).toBeDefined();
            expect(call?.[5]).toMatchObject({ positionBucket: 'profit' });
        });

        // `session`은 캐시 키가 아니라 technical 분석의 캐시 수명만 정한다. overall을 거친
        // technical 생성물도 단독 호출과 같은 만료를 가져야 한다.
        it('technical.session을 technical 축 호출에 그대로 넘긴다', async () => {
            await runOverallAnalysis({
                ...baseOptions(),
                symbol: 'SESSION',
                technical: { session: CRYPTO_SESSION },
            });

            const call = mockRunAnalysisForOverall.mock.calls.find(
                c => c[0] === 'SESSION'
            );
            expect(call).toBeDefined();
            expect(call?.[5]).toMatchObject({ session: CRYPTO_SESSION });
        });
    });

    describe('사전 게이트 (축 호출 전)', () => {
        it('티어가 허용하지 않는 타임프레임 → error/technical, 어떤 축도 호출하지 않는다', async () => {
            // tier 생략 → DEFAULT_TIER(free) — free는 '1Day'만 허용한다.
            const result = await runOverallAnalysis({
                ...baseOptions(),
                timeframe: '1Hour',
            });

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.axis).toBe('technical');
            }
            expect(mockRunAnalysisForOverall).not.toHaveBeenCalled();
            expect(mockRunNewsAnalysis).not.toHaveBeenCalled();
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });

        it('BYOK 모델 + 비-pro 티어 + 키 없음 → key_error, 축을 돌리지 않는다', async () => {
            const result = await runOverallAnalysis({
                ...baseOptions(),
                modelId: 'claude-opus-5',
                tier: 'free',
            });

            expect(result).toMatchObject({
                status: 'key_error',
                code: 'user_api_key_required',
                modelId: 'claude-opus-5',
                tier: 'free',
            });
            expect(mockRunAnalysisForOverall).not.toHaveBeenCalled();
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });

        it('BYOK 모델이라도 userApiKey가 있으면 통과하고 그 키로 LLM을 호출한다', async () => {
            const result = await runOverallAnalysis({
                ...baseOptions(),
                modelId: 'claude-opus-5',
                tier: 'free',
                userApiKey: 'sk-user',
            });

            expect(result.status).toBe('done');
            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({
                    model: 'claude-opus-5',
                    userApiKey: 'sk-user',
                })
            );
        });

        it('일일 한도 초과 → limit_error, 축·LLM 모두 호출하지 않고 사용량도 기록하지 않는다', async () => {
            mockCheckAnalysisUsageAllowed.mockResolvedValueOnce(false);

            const result = await runOverallAnalysis({
                ...baseOptions(),
                tier: 'free',
                usage: makeUsage(),
            });

            expect(result).toMatchObject({
                status: 'limit_error',
                code: 'usage_limit_exceeded',
            });
            expect(mockCheckAnalysisUsageAllowed).toHaveBeenCalledTimes(1);
            expect(mockRunAnalysisForOverall).not.toHaveBeenCalled();
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
            expect(mockRecordAnalysisUsageSafely).not.toHaveBeenCalled();
        });

        it('한도 내면 tier·usage로 검사한 뒤 분석을 진행하고 사용량을 정확히 1회 기록한다', async () => {
            const usage = makeUsage();
            const now = new Date('2026-09-26T00:00:00.000Z');

            const result = await runOverallAnalysis({
                ...baseOptions(),
                tier: 'free',
                usage,
                now,
            });

            expect(result.status).toBe('done');
            expect(mockCheckAnalysisUsageAllowed).toHaveBeenCalledWith(
                usage,
                'free',
                now,
                expect.anything()
            );
            expect(mockRecordAnalysisUsageSafely).toHaveBeenCalledTimes(1);
            expect(mockRecordAnalysisUsageSafely).toHaveBeenCalledWith(
                usage,
                'deepseek-v4.1-flash',
                now
            );
        });

        it('tier를 생략하면 usage가 있어도 한도 검사를 건너뛴다 (하위 호환 경로)', async () => {
            const result = await runOverallAnalysis({
                ...baseOptions(),
                usage: makeUsage(),
            });

            expect(mockCheckAnalysisUsageAllowed).not.toHaveBeenCalled();
            expect(result.status).toBe('done');
        });

        it('newsItems도 레거시 news 배열도 없으면 축 호출 전에 throw한다', async () => {
            const { newsItems: _omit, ...withoutNews } = baseOptions();

            await expect(runOverallAnalysis(withoutNews)).rejects.toThrow(
                /missing news items/
            );
            expect(mockRunAnalysisForOverall).not.toHaveBeenCalled();
        });
    });

    describe('news 입력의 두 가지 형태', () => {
        it('레거시 news 배열은 뉴스 데이터로 해석되어 news 축에 전달된다', async () => {
            const { newsItems: _omit, ...withoutNewsItems } = baseOptions();

            const result = await runOverallAnalysis({
                ...withoutNewsItems,
                news: [mockNewsItem],
            });

            expect(result.status).toBe('done');
            expect(mockRunNewsAnalysis).toHaveBeenCalledWith(
                expect.objectContaining({ news: [mockNewsItem] })
            );
        });

        it('news 객체는 축별 옵션으로 펼쳐져 최상위 기본값(userApiKey)을 덮어쓴다 — 데이터는 newsItems에서 온다', async () => {
            const controller = new AbortController();

            await runOverallAnalysis({
                ...baseOptions(),
                userApiKey: 'sk-top',
                signal: controller.signal,
                news: { userApiKey: 'sk-news' },
            });

            expect(mockRunNewsAnalysis).toHaveBeenCalledWith(
                expect.objectContaining({
                    userApiKey: 'sk-news',
                    news: [mockNewsItem],
                    force: false,
                    signal: controller.signal,
                })
            );
        });
    });

    describe('macroCalendar (spec 2026-09-28 §5)', () => {
        const MACRO_EVENT: EconomicCalendarEvent = {
            date: '2026-08-01 12:00:00',
            event: 'CPI MoM',
            impact: 'High',
            actual: null,
            estimate: 0.3,
            previous: 0.2,
            unit: '%',
        };

        it('최상위 macroCalendar를 news 축의 runNewsAnalysis 호출에 변형 없이 그대로 전달한다', async () => {
            await runOverallAnalysis({
                ...baseOptions(),
                macroCalendar: [MACRO_EVENT],
            });

            expect(mockRunNewsAnalysis).toHaveBeenCalledWith(
                expect.objectContaining({ macroCalendar: [MACRO_EVENT] })
            );
        });

        it('생략하면 news 축에도 undefined가 간다 (runNewsAnalysis 자체 기본값 [] 사용)', async () => {
            await runOverallAnalysis(baseOptions());

            expect(mockRunNewsAnalysis).toHaveBeenCalledWith(
                expect.objectContaining({ macroCalendar: undefined })
            );
        });
    });

    describe('assetClass 전달 (review round 1 finding 9)', () => {
        // baseOptions()는 assetClass: 'crypto' — 이 값이 news 축까지 전달되지
        // 않으면 crypto로 돌린 overall 호출이 equity로 프레이밍된 뉴스
        // 프롬프트를 만들고, buildNewsCacheKey가 assetClass를 키에 넣지
        // 않으므로 그 결과가 실제 crypto `/news` 호출과 같은 캐시 키에
        // 쓰일 수 있었다(발견된 기존 버그).
        it('crypto 최상위 assetClass를 news 축의 runNewsAnalysis 호출에 그대로 전달한다', async () => {
            await runOverallAnalysis(baseOptions());

            expect(mockRunNewsAnalysis).toHaveBeenCalledWith(
                expect.objectContaining({ assetClass: 'crypto' })
            );
        });

        it('equity 최상위 assetClass도 news 축에 그대로 전달한다', async () => {
            await runOverallAnalysis(equityOptions());

            expect(mockRunNewsAnalysis).toHaveBeenCalledWith(
                expect.objectContaining({ assetClass: 'equity' })
            );
        });

        it('생략하면 news 축에도 undefined가 간다 (runNewsAnalysis 자체 기본값 equity 사용)', async () => {
            const { assetClass: _omit, ...withoutAssetClass } = baseOptions();

            await runOverallAnalysis(withoutAssetClass);

            expect(mockRunNewsAnalysis).toHaveBeenCalledWith(
                expect.objectContaining({ assetClass: undefined })
            );
        });
    });

    describe('equity 경로 — fundamental·options 축', () => {
        it('options 스냅샷이 없으면 options 축을 건너뛰고 fundamental 축만 추가로 돈다', async () => {
            const result = await runOverallAnalysis(equityOptions());

            expect(result.status).toBe('done');
            expect(mockRunFundamentalAnalysis).toHaveBeenCalledTimes(1);
            expect(mockRunOptionsAnalysis).not.toHaveBeenCalled();
        });

        it('미래 만기가 있는 스냅샷이면 가장 가까운 만기로 options 축을 호출한다', async () => {
            const result = await runOverallAnalysis({
                ...equityOptions(),
                optionsSnapshot: futureOptionsSnapshot,
            });

            expect(result.status).toBe('done');
            expect(mockRunOptionsAnalysis).toHaveBeenCalledWith(
                expect.objectContaining({
                    snapshot: futureOptionsSnapshot,
                    expirationDate: FUTURE_EXPIRATION,
                })
            );
        });

        it('스냅샷의 만기가 전부 지났으면 options 축을 호출하지 않고 분석은 계속된다', async () => {
            const result = await runOverallAnalysis({
                ...equityOptions(),
                optionsSnapshot: expiredOptionsSnapshot,
            });

            expect(result.status).toBe('done');
            expect(mockRunOptionsAnalysis).not.toHaveBeenCalled();
        });

        it('assetClass를 생략하면 equity로 취급해 fundamental 축을 돌린다', async () => {
            const { assetClass: _omit, ...withoutAssetClass } = baseOptions();

            const result = await runOverallAnalysis(withoutAssetClass);

            expect(result.status).toBe('done');
            expect(mockRunFundamentalAnalysis).toHaveBeenCalledTimes(1);
        });

        it('crypto는 스냅샷이 있어도 fundamental·options 축을 모두 건너뛴다', async () => {
            const result = await runOverallAnalysis({
                ...baseOptions(),
                optionsSnapshot: futureOptionsSnapshot,
            });

            expect(result.status).toBe('done');
            expect(mockRunFundamentalAnalysis).not.toHaveBeenCalled();
            expect(mockRunOptionsAnalysis).not.toHaveBeenCalled();
        });

        it('tier를 생략하면 하위 축에 DEFAULT_TIER(free)를, 지정하면 그 값을 넘긴다', async () => {
            await runOverallAnalysis({
                ...equityOptions(),
                optionsSnapshot: futureOptionsSnapshot,
            });
            expect(mockRunFundamentalAnalysis).toHaveBeenLastCalledWith(
                expect.objectContaining({ tier: 'free' })
            );
            expect(mockRunOptionsAnalysis).toHaveBeenLastCalledWith(
                expect.objectContaining({ tier: 'free' })
            );

            await runOverallAnalysis({
                ...equityOptions(),
                optionsSnapshot: futureOptionsSnapshot,
                tier: 'pro',
            });
            expect(mockRunFundamentalAnalysis).toHaveBeenLastCalledWith(
                expect.objectContaining({ tier: 'pro' })
            );
            expect(mockRunOptionsAnalysis).toHaveBeenLastCalledWith(
                expect.objectContaining({ tier: 'pro' })
            );
        });

        it('signal·최상위 force를 네 축 모두에 전달하고 usage는 어느 축에도 넘기지 않는다', async () => {
            const controller = new AbortController();
            const usage = makeUsage();

            await runOverallAnalysis({
                ...equityOptions(),
                optionsSnapshot: futureOptionsSnapshot,
                signal: controller.signal,
                force: true,
                usage,
            });

            for (const mock of [
                mockRunFundamentalAnalysis,
                mockRunNewsAnalysis,
                mockRunOptionsAnalysis,
            ]) {
                const args = mock.mock.calls[0]![0] as Record<string, unknown>;
                expect(args.signal).toBe(controller.signal);
                expect(args.force).toBe(true);
                expect(args).not.toHaveProperty('usage');
            }
            const technicalCall = mockRunAnalysisForOverall.mock.calls[0]!;
            expect(technicalCall[3]).toBe(true); // effectiveTechnicalForce
            expect(technicalCall[5]).toMatchObject({
                signal: controller.signal,
            });
            expect(technicalCall[5]).not.toHaveProperty('usage');
        });

        it('options 결과의 analyzedAt만 다르면 overall 캐시 키가 같다 (휘발 필드 제거)', async () => {
            const snapshotOptions = {
                ...equityOptions(),
                optionsSnapshot: futureOptionsSnapshot,
            };
            await runOverallAnalysis(snapshotOptions);
            const firstKey = mockCacheGet.mock.calls[0]![0] as string;

            mockCacheGet.mockClear();
            mockRunOptionsAnalysis.mockResolvedValueOnce({
                status: 'cached',
                result: {
                    ...mockOptionsResult,
                    analyzedAt: '2026-09-20T12:34:56.000Z',
                },
            });
            await runOverallAnalysis(snapshotOptions);
            const secondKey = mockCacheGet.mock.calls[0]![0] as string;

            expect(secondKey).toBe(firstKey);
        });

        it('options 결과의 내용이 바뀌면 overall 캐시 키도 바뀐다', async () => {
            const snapshotOptions = {
                ...equityOptions(),
                optionsSnapshot: futureOptionsSnapshot,
            };
            await runOverallAnalysis(snapshotOptions);
            const firstKey = mockCacheGet.mock.calls[0]![0] as string;

            mockCacheGet.mockClear();
            mockRunOptionsAnalysis.mockResolvedValueOnce({
                status: 'done',
                result: { ...mockOptionsResult, summary: '다른 요약.' },
            });
            await runOverallAnalysis(snapshotOptions);
            const secondKey = mockCacheGet.mock.calls[0]![0] as string;

            expect(secondKey).not.toBe(firstKey);
        });
    });

    describe('축 오류 매핑 (equity)', () => {
        it('technical 축 key_error → axis:technical, error에 key_error 결과 객체를 그대로 싣는다', async () => {
            const keyError = {
                status: 'key_error',
                code: 'user_api_key_required',
                error: 'key required',
                modelId: 'claude-opus-5',
                tier: 'free',
            };
            mockRunAnalysisForOverall.mockResolvedValueOnce(keyError);

            const result = await runOverallAnalysis(baseOptions());

            expect(result).toEqual({
                status: 'error',
                axis: 'technical',
                error: keyError,
            });
        });

        it('fundamental 축 fetch_failed(메시지 있음) → axis:fundamental, 메시지를 전달한다', async () => {
            mockRunFundamentalAnalysis.mockResolvedValueOnce({
                status: 'error',
                code: 'fetch_failed',
                error: 'FMP 503',
            });

            const result = await runOverallAnalysis(equityOptions());

            expect(result).toEqual({
                status: 'error',
                axis: 'fundamental',
                error: 'FMP 503',
            });
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });

        it('fundamental 축 fetch_failed(메시지 없음) → code로 대체한다', async () => {
            mockRunFundamentalAnalysis.mockResolvedValueOnce({
                status: 'error',
                code: 'fetch_failed',
            });

            const result = await runOverallAnalysis(equityOptions());

            expect(result).toEqual({
                status: 'error',
                axis: 'fundamental',
                error: 'fetch_failed',
            });
        });

        it('fundamental 축 key_error → error에 결과 객체를 그대로 싣는다', async () => {
            const keyError = {
                status: 'key_error',
                code: 'user_api_key_required',
                error: 'key required',
                modelId: 'claude-opus-5',
                tier: 'free',
            };
            mockRunFundamentalAnalysis.mockResolvedValueOnce(keyError);

            const result = await runOverallAnalysis(equityOptions());

            expect(result).toEqual({
                status: 'error',
                axis: 'fundamental',
                error: keyError,
            });
        });

        it('news 축 key_error → axis:news, error에 결과 객체를 그대로 싣는다', async () => {
            const keyError = {
                status: 'key_error',
                code: 'user_api_key_required',
                error: 'key required',
                modelId: 'claude-opus-5',
                tier: 'free',
            };
            mockRunNewsAnalysis.mockResolvedValueOnce(keyError);

            const result = await runOverallAnalysis(baseOptions());

            expect(result).toEqual({
                status: 'error',
                axis: 'news',
                error: keyError,
            });
        });

        it.each([
            [
                'limit_error',
                {
                    status: 'limit_error',
                    code: 'usage_limit_exceeded',
                    error: 'limit',
                },
            ],
            [
                'key_error',
                {
                    status: 'key_error',
                    code: 'user_api_key_required',
                    error: 'key required',
                    modelId: 'claude-opus-5',
                    tier: 'free',
                },
            ],
        ])(
            'options 축 %s → axis:options, LLM을 호출하지 않는다',
            async (_label, axisResult) => {
                mockRunOptionsAnalysis.mockResolvedValueOnce(axisResult);

                const result = await runOverallAnalysis({
                    ...equityOptions(),
                    optionsSnapshot: futureOptionsSnapshot,
                });

                expect(result).toEqual({
                    status: 'error',
                    axis: 'options',
                    error: axisResult,
                });
                expect(mockCallAnalysisAi).not.toHaveBeenCalled();
            }
        );

        it('fundamental 축 miss_no_trigger → 전체 miss_no_trigger', async () => {
            mockRunFundamentalAnalysis.mockResolvedValueOnce({
                status: 'miss_no_trigger',
            });

            const result = await runOverallAnalysis(equityOptions());

            expect(result.status).toBe('miss_no_trigger');
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });

        it('options 축 miss_no_trigger → 전체 miss_no_trigger', async () => {
            mockRunOptionsAnalysis.mockResolvedValueOnce({
                status: 'miss_no_trigger',
            });

            const result = await runOverallAnalysis({
                ...equityOptions(),
                optionsSnapshot: futureOptionsSnapshot,
            });

            expect(result.status).toBe('miss_no_trigger');
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });

        /**
         * `newsData === null && !newsAxisAbsent` 가드: union에 새 상태가 생기면
         * 뉴스 축이 조용히 빠진 분석이 캐시에 굳는다. 알 수 없는 상태로 그
         * 경로를 흉내 내 가드가 살아 있는지 고정한다.
         */
        it('news 축이 알 수 없는 상태를 돌려주면 뉴스가 빠진 분석을 만들지 않고 error로 막는다', async () => {
            mockRunNewsAnalysis.mockResolvedValueOnce({
                status: 'submitted',
                jobId: 'legacy',
            });

            const result = await runOverallAnalysis(baseOptions());

            expect(result).toEqual({
                status: 'error',
                axis: 'news',
                error: 'News analysis returned no result',
            });
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });
    });

    describe('캐시 장애·부재 시 동작', () => {
        it('캐시 읽기가 실패하면 로그만 남기고 LLM으로 진행해 done을 반환한다', async () => {
            mockCacheGet.mockRejectedValueOnce(new Error('redis down'));
            const errorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});

            try {
                const result = await runOverallAnalysis(baseOptions());

                expect(result.status).toBe('done');
                expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
                expect(errorSpy).toHaveBeenCalledWith(
                    '[RunOverallAnalysis] Cache read failed:',
                    expect.any(Error)
                );
            } finally {
                errorSpy.mockRestore();
            }
        });

        it('캐시 프로바이더가 없으면(null) 읽기·쓰기 없이 LLM 결과를 반환하고 사용량을 기록한다', async () => {
            mockCreateCacheProvider.mockReturnValue(null);

            const result = await runOverallAnalysis({
                ...baseOptions(),
                usage: makeUsage(),
            });

            expect(result.status).toBe('done');
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockCacheSet).not.toHaveBeenCalled();
            expect(mockRecordAnalysisUsageSafely).toHaveBeenCalledTimes(1);
        });

        it('정규 키와 peek 키는 서로 다른 키이며, 정규 키는 읽기에 쓴 키와 같다', async () => {
            await runOverallAnalysis(baseOptions());

            const readKey = mockCacheGet.mock.calls[0]![0] as string;
            const writtenKeys = mockCacheSet.mock.calls.map(
                c => c[0] as string
            );
            expect(writtenKeys).toHaveLength(2);
            expect(writtenKeys[0]).toBe(readKey);
            expect(writtenKeys[1]).not.toBe(readKey);
        });

        it('정규·peek 캐시 쓰기가 실패해도 결과는 done이고 각각 로그가 남는다', async () => {
            mockCacheSet.mockRejectedValue(new Error('write failed'));
            const errorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});

            try {
                const result = await runOverallAnalysis(baseOptions());

                expect(result.status).toBe('done');
                await vi.waitFor(() => {
                    expect(errorSpy).toHaveBeenCalledWith(
                        '[RunOverallAnalysis] Cache write failed:',
                        expect.any(Error)
                    );
                    expect(errorSpy).toHaveBeenCalledWith(
                        '[RunOverallAnalysis] Peek cache write failed:',
                        expect.any(Error)
                    );
                });
            } finally {
                errorSpy.mockRestore();
            }
        });
    });

    describe('LLM 호출 전후 저하(degrade) 경로', () => {
        it('캐시 미스인데 marketDataProvider가 없으면 LLM 호출 전에 throw한다', async () => {
            const { marketDataProvider: _omit, ...withoutProvider } =
                baseOptions();

            await expect(runOverallAnalysis(withoutProvider)).rejects.toThrow(
                /marketDataProvider is required/
            );
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });

        it('marketDataProvider가 없어도 캐시 히트면 정상 반환한다', async () => {
            mockCacheGet.mockResolvedValueOnce(mockOverallResult);
            const { marketDataProvider: _omit, ...withoutProvider } =
                baseOptions();

            const result = await runOverallAnalysis(withoutProvider);

            expect(result.status).toBe('cached');
        });

        it('Fear & Greed 계산이 던지면 sentiment 없이 분석을 계속한다', async () => {
            // indicators 누락 = 프로바이더가 비정상 페이로드를 돌려준 경우.
            mockFetchBarsWithIndicators.mockResolvedValue({ bars: [] });
            const errorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});

            try {
                const result = await runOverallAnalysis(baseOptions());

                expect(result.status).toBe('done');
                expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
                expect(errorSpy).toHaveBeenCalledWith(
                    expect.stringContaining('FearGreed computation failed'),
                    expect.any(Error)
                );
            } finally {
                errorSpy.mockRestore();
            }
        });

        it('1Day가 아닌 타임프레임에서 이력용 봉 페치만 실패하면 이력 섹션 없이 분석을 계속한다', async () => {
            mockFetchBarsWithIndicators.mockImplementation(
                async (_provider: unknown, _symbol: string, tf: string) => {
                    if (tf === '1Day') {
                        return { bars: [], indicators: { buySellVolume: [] } };
                    }
                    throw new Error('intraday bars down');
                }
            );
            const errorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});

            try {
                const result = await runOverallAnalysis({
                    ...baseOptions(),
                    timeframe: '1Hour',
                    tier: 'pro',
                    priorAnalyses: [
                        {
                            generatedAt: new Date('2020-01-01T00:00:00.000Z'),
                            trend: 'bullish',
                            riskLevel: 'medium',
                        },
                    ],
                });

                expect(result.status).toBe('done');
                expect(errorSpy).toHaveBeenCalledWith(
                    expect.stringContaining('Prior-analysis bars fetch failed'),
                    expect.any(Error)
                );
                const prompt = (
                    mockCallAnalysisAi.mock.calls.at(-1)![0] as {
                        prompt: string;
                    }
                ).prompt;
                expect(prompt).not.toContain('## Prior Analyses');
            } finally {
                errorSpy.mockRestore();
            }
        });

        it('헤드라인·시나리오가 모두 빈 응답이면 경고를 남기되 결과는 그대로 캐시한다', async () => {
            mockCallAnalysisAi.mockResolvedValueOnce(
                JSON.stringify({
                    ...mockOverallResult,
                    headlineKo: '',
                    scenarios: [],
                })
            );
            const warnSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => {});

            try {
                const result = await runOverallAnalysis(baseOptions());

                expect(result.status).toBe('done');
                expect(warnSpy).toHaveBeenCalledWith(
                    '[RunOverallAnalysis] Empty overall analysis',
                    { symbol: 'AAPL' }
                );
                expect(mockCacheSet).toHaveBeenCalledTimes(2);
            } finally {
                warnSpy.mockRestore();
            }
        });
    });

    /**
     * 수급(investor flows) 스코어카드 주입. 생략하면 프롬프트·스키마·캐시 키가
     * 예전과 같고, 주입하면 inputHash에 접혀 카드가 바뀔 때 캐시가 갈린다.
     */
    describe('investorFlowsScorecard', () => {
        const flowsQuarter = quarter({
            holders: 106_000,
            newHolders: 7000,
            exited: 1000,
            netShareChange: 35_000_000,
        });
        const scorecard: InvestorFlowsScorecard = evaluateInvestorFlows(
            emptySnapshot({
                institutional: {
                    quarters: [flowsQuarter],
                    topHolders: topHolders(10, 8, 0),
                    topHoldersPeriod: flowsQuarter.period,
                },
                insider: { transactions: [insiderTx({ value: 400_000 })] },
            })
        );
        const changedScorecard: InvestorFlowsScorecard = evaluateInvestorFlows(
            emptySnapshot({
                institutional: {
                    quarters: [
                        { ...flowsQuarter, netShareChange: -35_000_000 },
                    ],
                    topHolders: topHolders(10, 0, 8),
                    topHoldersPeriod: flowsQuarter.period,
                },
                insider: { transactions: [insiderTx({ value: 400_000 })] },
            })
        );

        const cacheKeyFor = async (
            flows: InvestorFlowsScorecard | null | undefined
        ): Promise<string> => {
            mockCacheGet.mockClear();
            await runOverallAnalysis({
                ...baseOptions(),
                investorFlowsScorecard: flows,
            });
            return mockCacheGet.mock.calls[0]![0] as string;
        };
        const lastCall = () =>
            mockCallAnalysisAi.mock.calls.at(-1)![0] as {
                prompt: string;
                responseSchema: unknown;
            };

        it('생략하면 캐시 키가 정확히 고정된 값이고 프롬프트·스키마도 달라지지 않는다', async () => {
            // Golden: the key this input produced BEFORE the field existed. It is
            // sha256 of the inputHash JSON without an `investorFlows` key (an
            // `undefined` value drops out of JSON.stringify), so any change that
            // lets the omitted case leak into the hash (e.g. `?? 0`, `?? null`)
            // changes this literal.
            expect(await cacheKeyFor(undefined)).toBe(
                'v1:analysis:overall:AAPL:1Day:deepseek-v4.1-flash:p5:db97fcfbcde0adcb'
            );
            await runOverallAnalysis(baseOptions());
            expect(lastCall().prompt).not.toContain('Investor Flows');
            expect(lastCall().responseSchema).toBe(OVERALL_RESPONSE_SCHEMA);
        });

        it('주입하면 캐시 키가 생략 시와 달라지고 같은 카드면 같다', async () => {
            const omitted = await cacheKeyFor(undefined);
            const withCard = await cacheKeyFor(scorecard);
            expect(withCard).not.toBe(omitted);
            expect(await cacheKeyFor(scorecard)).toBe(withCard);
        });

        it('카드가 바뀌면 inputHash가 바뀌어 캐시 키가 갈린다', async () => {
            expect(await cacheKeyFor(changedScorecard)).not.toBe(
                await cacheKeyFor(scorecard)
            );
        });

        it('null(데이터 없음)은 생략과도, 카드와도 다른 키다', async () => {
            const nullKey = await cacheKeyFor(null);
            expect(nullKey).not.toBe(await cacheKeyFor(undefined));
            expect(nullKey).not.toBe(await cacheKeyFor(scorecard));
        });

        it('주입하면 섹션이 프롬프트에 들어가고 수급 필드를 포함한 스키마를 쓴다', async () => {
            await runOverallAnalysis({
                ...baseOptions(),
                investorFlowsScorecard: scorecard,
            });
            expect(lastCall().prompt).toContain(
                '## Investor Flows (supplementary axis)'
            );
            expect(lastCall().responseSchema).toBe(
                OVERALL_WITH_INVESTOR_FLOWS_RESPONSE_SCHEMA
            );
        });

        it('null이어도 데이터 없음 섹션과 확장 스키마를 쓴다', async () => {
            await runOverallAnalysis({
                ...baseOptions(),
                investorFlowsScorecard: null,
            });
            expect(lastCall().prompt).toContain(
                'NO DATA — investor-flows data'
            );
            expect(lastCall().responseSchema).toBe(
                OVERALL_WITH_INVESTOR_FLOWS_RESPONSE_SCHEMA
            );
        });

        it('모델이 돌려준 investorFlowsBulletsKo를 결과와 캐시에 싣는다', async () => {
            mockCallAnalysisAi.mockResolvedValueOnce(
                JSON.stringify({
                    ...mockOverallResult,
                    investorFlowsBulletsKo: [
                        '기관 순매수 (13F 2026-06-30 기준)',
                    ],
                })
            );
            const result = await runOverallAnalysis({
                ...baseOptions(),
                investorFlowsScorecard: scorecard,
            });
            expect(result.status).toBe('done');
            if (result.status === 'done') {
                expect(result.result.investorFlowsBulletsKo).toEqual([
                    '기관 순매수 (13F 2026-06-30 기준)',
                ]);
            }
            expect(mockCacheSet).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    investorFlowsBulletsKo: [
                        '기관 순매수 (13F 2026-06-30 기준)',
                    ],
                }),
                OVERALL_CACHE_TTL_SECONDS
            );
        });
    });
});
