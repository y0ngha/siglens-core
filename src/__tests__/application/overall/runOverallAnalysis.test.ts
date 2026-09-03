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
            expect(withCallback).toEqual(withoutCallback);

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
});
