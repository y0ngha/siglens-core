import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { TEST_TIER_CONFIG } from '@/__tests__/helpers/testTierConfig';
import type { MarketDataProvider } from '@/domain/ports/marketDataProvider';

// ── Mock dependencies before importing the module under test ──
vi.mock('@/application/overall/dependencyResolver');
vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/jobs/queue');
vi.mock('@/application/background');
vi.mock('@/application/market/barsApi');
vi.mock('@/domain/analysis/overallPrompt', () => ({
    buildOverallAnalysisPrompt: vi.fn(() => 'mock-overall-prompt'),
}));
vi.mock('@/domain/indicators/fearGreed', () => ({
    computeFearGreedIndex: vi.fn(),
}));

import { submitOverallAnalysis } from '@/application/overall/submitOverallAnalysis';
import { resolveOverallDependencies } from '@/application/overall/dependencyResolver';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { analysisSeed } from '@/infrastructure/hash/analysisInput';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { fireAndForget } from '@/application/background';
import { fetchBarsWithIndicators } from '@/application/market/barsApi';
import { buildOverallAnalysisPrompt } from '@/domain/analysis/overallPrompt';
import { OVERALL_SYSTEM_PROMPT } from '@/domain/analysis/systemPrompt';
import { computeFearGreedIndex } from '@/domain/indicators/fearGreed';
import { EMPTY_SMC_RESULT } from '@/domain/indicators/constants';
import type {
    AnalysisResponse,
    FearGreedSnapshot,
    FundamentalAnalysisResponse,
    NewsAnalysisResponse,
    TierConfig,
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
const mockFetchBarsWithIndicators = fetchBarsWithIndicators as Mock;
const mockBuildOverallAnalysisPrompt = buildOverallAnalysisPrompt as Mock;
const mockComputeFearGreedIndex = computeFearGreedIndex as Mock;

/**
 * Minimal bars+indicators fixture for the daily fearGreed fetch.
 *
 * Single-bar data is intentionally insufficient for walk-forward sampling,
 * which causes `computeFearGreedIndex` to return null. Both the success and
 * failure paths in submitOverallAnalysis are exercised either way (the
 * snapshot is forwarded as `undefined` when the compute fails).
 */
const mockDailyBarsData = {
    bars: [
        {
            time: 1705312200,
            open: 100,
            high: 105,
            low: 99,
            close: 103,
            volume: 1_000_000,
        },
    ],
    indicators: {
        macd: [],
        bollinger: [],
        dmi: [],
        stochastic: [],
        stochRsi: [],
        rsi: [],
        cci: [],
        vwap: [],
        ma: {},
        ema: {},
        volumeProfile: null,
        ichimoku: [],
        atr: [],
        obv: [],
        parabolicSar: [],
        williamsR: [],
        supertrend: [],
        mfi: [],
        keltnerChannel: [],
        cmf: [],
        donchianChannel: [],
        buySellVolume: [],
        squeezeMomentum: [],
        smc: EMPTY_SMC_RESULT,
    },
};

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
    optionsBulletsKo: [],
    integratedConclusionKo: '3축 결론',
    scenarios: [],
    riskFactorsKo: [],
    // `optionsOiStale` is omitted (not set to false) — the normalizer drops
    // the field when not stale rather than emitting `false`, matching the
    // optional-field contract on `OverallAnalysisResponse`.
};

const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheProvider = {
    get: mockCacheGet,
    set: mockCacheSet,
    delete: vi.fn(),
};

const mockFetch = vi.fn();

const fakeProvider: MarketDataProvider = {
    getBars: vi.fn().mockResolvedValue([]),
    getQuote: vi.fn().mockResolvedValue(null),
};

/** Default options for submitOverallAnalysis. */
function makeOptions(
    overrides: Partial<SubmitOverallAnalysisOptions> = {}
): SubmitOverallAnalysisOptions {
    return {
        symbol: 'AAPL',
        timeframe: '1Day',
        modelId: 'gemini-2.5-flash',
        fundamentalProvider: minimalProvider,
        marketDataProvider: fakeProvider,
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
        mockFetchBarsWithIndicators.mockResolvedValue(mockDailyBarsData);
        // Default fearGreed compute → null (matches real behavior on the
        // 1-bar fixture where walk-forward sampling is insufficient).
        // Individual tests override with mockReturnValueOnce when they need
        // a deterministic snapshot.
        mockComputeFearGreedIndex.mockReturnValue(null);
        mockBuildOverallAnalysisPrompt.mockReturnValue('mock-overall-prompt');
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        process.env = originalEnv;
    });

    describe('의존성 축이 error 일 때', () => {
        it('error 를 반환하고 axis 와 error 를 포함한다', async () => {
            const innerError = { code: 'timeframe_not_allowed' };
            mockResolveOverallDependencies.mockResolvedValue({
                kind: 'error',
                axis: 'technical',
                // resolver stores the full result object; submitOverallAnalysis
                // unwraps `.error` for the backward-compatible SubmitOverallAnalysisError shape.
                error: { status: 'error', error: innerError },
            });

            const result = await submitOverallAnalysis(makeOptions());

            expect(result.status).toBe('error');
            if (result.status === 'error' && 'axis' in result) {
                expect(result.axis).toBe('technical');
                expect(result.error).toEqual(innerError);
            }
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockSetJobMeta).not.toHaveBeenCalled();
            expect(mockFireAndForget).not.toHaveBeenCalled();
        });

        it('axis 에서 key_error 가 반환되면 top-level key_error 로 re-surface 한다', async () => {
            const axisKeyError = {
                status: 'key_error' as const,
                code: 'user_api_key_required' as const,
                error: 'BYOK required',
                modelId: 'gemini-2.5-pro' as const,
                tier: 'member' as const,
            };
            mockResolveOverallDependencies.mockResolvedValue({
                kind: 'error',
                axis: 'fundamental',
                error: axisKeyError,
            });

            const result = await submitOverallAnalysis(makeOptions());

            expect(result.status).toBe('key_error');
            if (result.status === 'key_error') {
                expect(result.code).toBe('user_api_key_required');
                expect(result.modelId).toBe('gemini-2.5-pro');
                expect(result.tier).toBe('member');
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

        it('overall 캐시에 부분 형태가 들어 있어도 정규화된 cached 결과를 반환한다', async () => {
            const stalePoisonedCache = {
                overallSentiment: 'bullish',
                oldField: true,
            };
            mockCacheGet.mockResolvedValue(stalePoisonedCache);

            const result = await submitOverallAnalysis(makeOptions());

            expect(result.status).toBe('cached');
            if (result.status === 'cached') {
                expect(result.result).toEqual({
                    headlineKo: '',
                    technicalBulletsKo: [],
                    fundamentalBulletsKo: [],
                    newsBulletsKo: [],
                    optionsBulletsKo: [],
                    integratedConclusionKo: '',
                    scenarios: [],
                    riskFactorsKo: [],
                });
            }
            expect(mockSetJobMeta).not.toHaveBeenCalled();
            expect(mockFireAndForget).not.toHaveBeenCalled();
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

        it('options.analyzedAt 만 다르면 동일한 캐시 키로 조회된다', async () => {
            // The options-axis cache-hit path unconditionally re-stamps
            // `analyzedAt` to the server clock on every submit, so polling
            // the same overall analysis would otherwise shift the overall
            // cache key every time. stripVolatileOptionsFields must drop
            // the field from the hash input to keep the overall TTL alive.
            const baseOptions = {
                summary: 'Options summary',
                perExpiration: [],
                signals: [],
                analyzedAt: '2026-05-22T10:00:00Z',
            };

            mockResolveOverallDependencies.mockResolvedValueOnce({
                kind: 'cached',
                technical: cachedTechnical,
                fundamental: cachedFundamental,
                news: cachedNews,
                options: baseOptions,
            });
            mockCacheGet.mockResolvedValueOnce(null);
            await submitOverallAnalysis(makeOptions());
            const firstCacheKey = mockCacheGet.mock.calls[0]?.[0];

            mockResolveOverallDependencies.mockResolvedValueOnce({
                kind: 'cached',
                technical: cachedTechnical,
                fundamental: cachedFundamental,
                news: cachedNews,
                options: { ...baseOptions, analyzedAt: '2026-05-22T11:00:00Z' },
            });
            mockCacheGet.mockResolvedValueOnce(null);
            await submitOverallAnalysis(makeOptions());
            const secondCacheKey = mockCacheGet.mock.calls[1]?.[0];

            expect(firstCacheKey).toBe(secondCacheKey);
        });

        it('options 본문(summary)이 달라지면 캐시 키가 달라진다', async () => {
            // Inverse of the analyzedAt-stability test — only non-volatile
            // options fields participate in the hash, so a meaningful body
            // change must still bust the overall cache.
            const baseOptions = {
                summary: 'Options summary A',
                perExpiration: [],
                signals: [],
                analyzedAt: '2026-05-22T10:00:00Z',
            };

            mockResolveOverallDependencies.mockResolvedValueOnce({
                kind: 'cached',
                technical: cachedTechnical,
                fundamental: cachedFundamental,
                news: cachedNews,
                options: baseOptions,
            });
            mockCacheGet.mockResolvedValueOnce(null);
            await submitOverallAnalysis(makeOptions());
            const firstCacheKey = mockCacheGet.mock.calls[0]?.[0];

            mockResolveOverallDependencies.mockResolvedValueOnce({
                kind: 'cached',
                technical: cachedTechnical,
                fundamental: cachedFundamental,
                news: cachedNews,
                options: { ...baseOptions, summary: 'Options summary B' },
            });
            mockCacheGet.mockResolvedValueOnce(null);
            await submitOverallAnalysis(makeOptions());
            const secondCacheKey = mockCacheGet.mock.calls[1]?.[0];

            expect(firstCacheKey).not.toBe(secondCacheKey);
        });
    });

    describe('overall-scoped usage 추적이', () => {
        const restrictedTierConfig: TierConfig = {
            limits: {
                analysisPerDay: {
                    free: 1,
                    member: Infinity,
                    pro: Infinity,
                },
                chatbotPerDay: {
                    free: Infinity,
                    member: Infinity,
                    pro: Infinity,
                },
            },
            timeframes: { free: ['1Day'], member: ['1Day'], pro: ['1Day'] },
            infoDepth: {
                free: ['summary'],
                member: ['summary'],
                pro: ['summary'],
            },
            models: {
                free: ['gemini-2.5-flash'],
                member: ['gemini-2.5-flash'],
                pro: ['gemini-2.5-flash'],
            },
            featureFlags: { enableTierRestrictions: true },
        };

        it('한도 초과 시 dependency resolver 를 호출하지 않고 limit error 를 반환한다', async () => {
            const recordUsage = vi.fn();
            const result = await submitOverallAnalysis(
                makeOptions({
                    tier: 'free',
                    tierConfig: restrictedTierConfig,
                    usage: {
                        usageRepository: {
                            recordUsage,
                            getUsageToday: vi.fn().mockResolvedValue({
                                analysis: 1,
                                chatbot: 0,
                            }),
                        },
                        clientIp: '203.0.113.10',
                    },
                })
            );

            expect(result.status).toBe('limit_error');
            if (result.status === 'limit_error') {
                expect(result.code).toBe('usage_limit_exceeded');
            }
            expect(mockResolveOverallDependencies).not.toHaveBeenCalled();
            expect(recordUsage).not.toHaveBeenCalled();
        });

        it('overall 캐시 히트 경로에서 recordUsage 가 정확히 1회 호출된다', async () => {
            mockResolveOverallDependencies.mockResolvedValue({
                kind: 'cached',
                technical: cachedTechnical,
                fundamental: cachedFundamental,
                news: cachedNews,
            });
            mockCacheGet.mockResolvedValue(cachedOverallResult);
            const recordUsage = vi.fn().mockResolvedValue(undefined);

            await submitOverallAnalysis(
                makeOptions({
                    usage: {
                        usageRepository: {
                            recordUsage,
                            getUsageToday: vi.fn().mockResolvedValue({
                                analysis: 0,
                                chatbot: 0,
                            }),
                        },
                        clientIp: '203.0.113.10',
                    },
                })
            );

            expect(recordUsage).toHaveBeenCalledTimes(1);
            expect(recordUsage).toHaveBeenCalledWith(
                expect.objectContaining({
                    actionType: 'analysis',
                    ipAddress: '203.0.113.10',
                    modelUsed: 'gemini-2.5-flash',
                })
            );
        });

        it('overall submitted 경로에서 recordUsage 가 정확히 1회 호출된다', async () => {
            mockResolveOverallDependencies.mockResolvedValue({
                kind: 'cached',
                technical: cachedTechnical,
                fundamental: cachedFundamental,
                news: cachedNews,
            });
            mockCacheGet.mockResolvedValue(null);
            const recordUsage = vi.fn().mockResolvedValue(undefined);

            const result = await submitOverallAnalysis(
                makeOptions({
                    usage: {
                        usageRepository: {
                            recordUsage,
                            getUsageToday: vi.fn().mockResolvedValue({
                                analysis: 0,
                                chatbot: 0,
                            }),
                        },
                        clientIp: '203.0.113.10',
                    },
                })
            );

            expect(result.status).toBe('submitted');
            expect(recordUsage).toHaveBeenCalledTimes(1);
        });

        it('pending_dependencies 경로에서는 recordUsage 가 호출되지 않는다', async () => {
            mockResolveOverallDependencies.mockResolvedValue({
                kind: 'pending',
                pendingJobs: {
                    technical: 'tech-job',
                    fundamental: undefined,
                    news: undefined,
                },
            });
            const recordUsage = vi.fn().mockResolvedValue(undefined);

            await submitOverallAnalysis(
                makeOptions({
                    usage: {
                        usageRepository: {
                            recordUsage,
                            getUsageToday: vi.fn().mockResolvedValue({
                                analysis: 0,
                                chatbot: 0,
                            }),
                        },
                        clientIp: '203.0.113.10',
                    },
                })
            );

            expect(recordUsage).not.toHaveBeenCalled();
        });

        it('axis-error 경로에서는 recordUsage 가 호출되지 않는다', async () => {
            mockResolveOverallDependencies.mockResolvedValue({
                kind: 'error',
                axis: 'technical',
                error: {
                    status: 'error',
                    error: { code: 'timeframe_not_allowed' },
                },
            });
            const recordUsage = vi.fn().mockResolvedValue(undefined);

            await submitOverallAnalysis(
                makeOptions({
                    usage: {
                        usageRepository: {
                            recordUsage,
                            getUsageToday: vi.fn().mockResolvedValue({
                                analysis: 0,
                                chatbot: 0,
                            }),
                        },
                        clientIp: '203.0.113.10',
                    },
                })
            );

            expect(recordUsage).not.toHaveBeenCalled();
        });

        it('resolver 호출 시 dropAxisUsage: true 를 전달해 triple-counting 을 방지한다', async () => {
            mockResolveOverallDependencies.mockResolvedValue({
                kind: 'cached',
                technical: cachedTechnical,
                fundamental: cachedFundamental,
                news: cachedNews,
            });
            mockCacheGet.mockResolvedValue(cachedOverallResult);

            await submitOverallAnalysis(makeOptions());

            expect(mockResolveOverallDependencies).toHaveBeenCalledWith(
                expect.any(Object),
                { dropAxisUsage: true }
            );
        });
    });

    describe('FearGreed 주입 시', () => {
        beforeEach(() => {
            mockResolveOverallDependencies.mockResolvedValue({
                kind: 'cached',
                technical: cachedTechnical,
                fundamental: cachedFundamental,
                news: cachedNews,
            });
            mockCacheGet.mockResolvedValue(null); // overall cache miss → submit path
        });

        it('일봉 bars를 fetch해 buildOverallAnalysisPrompt 7번째 인자로 fearGreed가 전달된다', async () => {
            const mockSnapshot: FearGreedSnapshot = {
                score: 50,
                label: 'NEUTRAL',
                groups: [
                    { name: 'Flow', score: 50, factors: [] },
                    { name: 'Trend', score: 50, factors: [] },
                ],
                confidence: 'normal',
                sampleSize: 100,
                warning: null,
            };
            mockComputeFearGreedIndex.mockReturnValueOnce(mockSnapshot);

            await submitOverallAnalysis(makeOptions());

            // 일봉 데이터가 정확히 1번 fetch됨 (overall은 daily-only).
            expect(mockFetchBarsWithIndicators).toHaveBeenCalledTimes(1);
            expect(mockFetchBarsWithIndicators).toHaveBeenCalledWith(
                fakeProvider,
                'AAPL',
                '1Day',
                undefined
            );

            // buildOverallAnalysisPrompt가 호출되었고, 7번째 인자(fearGreed)는
            // mock한 FearGreedSnapshot 객체와 정확히 동일해야 함.
            expect(mockBuildOverallAnalysisPrompt).toHaveBeenCalledTimes(1);
            const args = mockBuildOverallAnalysisPrompt.mock.calls[0];
            // Positional-arg assertion: if buildOverallAnalysisPrompt's signature ever
            // switches to an options object, replace args[6] with args[0].fearGreed.
            const seventh = args[6];
            expect(seventh).toBe(mockSnapshot);
            // Phase 4-Core extended the signature to 9 positional args:
            // (..., fearGreed, options, optionsOiStale). The first 7 retain
            // their meaning; args 8/9 are the new options axis hooks.
            expect(args.length).toBe(9);
        });

        it('일봉 fetch가 throw해도 overall 분석은 fearGreed=undefined로 계속 진행된다', async () => {
            const consoleSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});

            mockFetchBarsWithIndicators.mockRejectedValueOnce(
                new Error('daily fetch failed')
            );

            const result = await submitOverallAnalysis(makeOptions());

            expect(result.status).toBe('submitted');
            expect(consoleSpy).toHaveBeenCalledWith(
                '[submitOverallAnalysis] FearGreed daily fetch/compute failed; proceeding without sentiment:',
                expect.any(Error)
            );

            // buildOverallAnalysisPrompt 7번째 인자는 undefined여야 함.
            expect(mockBuildOverallAnalysisPrompt).toHaveBeenCalledTimes(1);
            const args = mockBuildOverallAnalysisPrompt.mock.calls[0];
            expect(args[6]).toBeUndefined();

            consoleSpy.mockRestore();
        });

        it('options.technical.fmpSymbol이 일봉 fetch에 전달된다', async () => {
            await submitOverallAnalysis(
                makeOptions({
                    technical: { fmpSymbol: 'AAPL.US' },
                })
            );

            expect(mockFetchBarsWithIndicators).toHaveBeenCalledWith(
                fakeProvider,
                'AAPL',
                '1Day',
                'AAPL.US'
            );
        });
    });

    describe('submitOverallAnalysis BYOK gate + tier forwarding', () => {
        /** TierConfig where gemini-2.5-pro is premium (not in free list). */
        const testTierConfig = TEST_TIER_CONFIG;

        it('returns key_error when non-pro tier + premium model + no userApiKey', async () => {
            const result = await submitOverallAnalysis(
                makeOptions({
                    tier: 'member',
                    tierConfig: testTierConfig,
                    modelId: 'gemini-2.5-pro',
                })
            );

            expect(result.status).toBe('key_error');
            if (result.status === 'key_error') {
                expect(result.code).toBe('user_api_key_required');
                expect(result.modelId).toBe('gemini-2.5-pro');
                expect(result.tier).toBe('member');
                expect(typeof result.error).toBe('string');
                expect(result.error.length).toBeGreaterThan(0);
            }
            // BYOK gate fires before dependency resolver
            expect(mockResolveOverallDependencies).not.toHaveBeenCalled();
        });

        it('proceeds when pro tier + premium model + no userApiKey', async () => {
            mockResolveOverallDependencies.mockResolvedValue({
                kind: 'cached',
                technical: cachedTechnical,
                fundamental: cachedFundamental,
                news: cachedNews,
            });
            mockCacheGet.mockResolvedValue(null);

            const result = await submitOverallAnalysis(
                makeOptions({
                    tier: 'pro',
                    tierConfig: testTierConfig,
                    modelId: 'gemini-2.5-pro',
                })
            );

            // Gate does not fire for pro tier
            expect(result.status).toBe('submitted');
            expect(mockResolveOverallDependencies).toHaveBeenCalled();
        });

        it('proceeds when non-pro tier + premium model + userApiKey provided', async () => {
            mockResolveOverallDependencies.mockResolvedValue({
                kind: 'cached',
                technical: cachedTechnical,
                fundamental: cachedFundamental,
                news: cachedNews,
            });
            mockCacheGet.mockResolvedValue(null);

            const result = await submitOverallAnalysis(
                makeOptions({
                    tier: 'member',
                    tierConfig: testTierConfig,
                    modelId: 'gemini-2.5-pro',
                    userApiKey: 'my-byok-key',
                })
            );

            expect(result.status).toBe('submitted');
            expect(mockResolveOverallDependencies).toHaveBeenCalled();
        });

        it('forwards tier in worker POST body', async () => {
            mockResolveOverallDependencies.mockResolvedValue({
                kind: 'cached',
                technical: cachedTechnical,
                fundamental: cachedFundamental,
                news: cachedNews,
            });
            mockCacheGet.mockResolvedValue(null);

            await submitOverallAnalysis(
                makeOptions({
                    tier: 'pro',
                    tierConfig: testTierConfig,
                    modelId: 'gemini-2.5-flash',
                })
            );

            expect(mockFetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    body: expect.stringContaining('"tier":"pro"'),
                })
            );
        });

        it('forwards analysisType and overall system prompt in worker POST body', async () => {
            mockResolveOverallDependencies.mockResolvedValue({
                kind: 'cached',
                technical: cachedTechnical,
                fundamental: cachedFundamental,
                news: cachedNews,
            });
            mockCacheGet.mockResolvedValue(null);

            await submitOverallAnalysis(makeOptions());

            const body = JSON.parse(
                mockFetch.mock.calls[0][1].body as string
            ) as Record<string, unknown>;
            expect(body.analysisType).toBe('overall');
            expect(body.system).toBe(OVERALL_SYSTEM_PROMPT);
            expect(body.seed).toBe(analysisSeed(body.prompt as string));
            expect(Number.isInteger(body.seed)).toBe(true);
            expect(body.seed as number).toBeGreaterThanOrEqual(0);
        });

        it('treats missing tier as DEFAULT_TIER (free) in worker POST body', async () => {
            mockResolveOverallDependencies.mockResolvedValue({
                kind: 'cached',
                technical: cachedTechnical,
                fundamental: cachedFundamental,
                news: cachedNews,
            });
            mockCacheGet.mockResolvedValue(null);

            // No tier supplied → defaults to DEFAULT_TIER ('free')
            await submitOverallAnalysis(makeOptions());

            expect(mockFetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    body: expect.stringContaining('"tier":"free"'),
                })
            );
        });

        it('forwards top-level userApiKey as X-AI-API-KEY header in worker POST', async () => {
            mockResolveOverallDependencies.mockResolvedValue({
                kind: 'cached',
                technical: cachedTechnical,
                fundamental: cachedFundamental,
                news: cachedNews,
            });
            mockCacheGet.mockResolvedValue(null);

            await submitOverallAnalysis(
                makeOptions({
                    userApiKey: 'top-key',
                    // free model is not premium — gate won't block
                    modelId: 'gemini-2.5-flash',
                })
            );

            expect(mockFetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'X-AI-API-KEY': 'top-key',
                    }),
                })
            );
        });

        it('omits X-AI-API-KEY header when userApiKey is not provided', async () => {
            mockResolveOverallDependencies.mockResolvedValue({
                kind: 'cached',
                technical: cachedTechnical,
                fundamental: cachedFundamental,
                news: cachedNews,
            });
            mockCacheGet.mockResolvedValue(null);

            await submitOverallAnalysis(makeOptions());

            const fetchCall = mockFetch.mock.calls[0];
            expect(fetchCall).toBeDefined();
            const headers = fetchCall?.[1]?.headers as Record<string, string>;
            expect(headers?.['X-AI-API-KEY']).toBeUndefined();
        });

        it('passes top-level userApiKey and tier to resolveOverallDependencies inputs', async () => {
            mockResolveOverallDependencies.mockResolvedValue({
                kind: 'cached',
                technical: cachedTechnical,
                fundamental: cachedFundamental,
                news: cachedNews,
            });
            mockCacheGet.mockResolvedValue(null);

            await submitOverallAnalysis(
                makeOptions({
                    tier: 'pro',
                    userApiKey: 'propagated-key',
                    modelId: 'gemini-2.5-flash',
                })
            );

            // The first arg to resolveOverallDependencies is the full options object,
            // which includes top-level userApiKey and tier for propagation to axes.
            expect(mockResolveOverallDependencies).toHaveBeenCalledWith(
                expect.objectContaining({
                    userApiKey: 'propagated-key',
                    tier: 'pro',
                }),
                expect.any(Object)
            );
        });
    });

    describe('marketDataProvider 가드', () => {
        it('options.marketDataProvider가 없으면 에러를 던진다', async () => {
            // Guard sits after resolveOverallDependencies, cache check, and
            // skipEnqueueIfMiss early-return, but before readWorkerConfig —
            // reproduce the same cache-miss + worker-config setup the other
            // cache-miss tests use, but omit marketDataProvider.
            mockResolveOverallDependencies.mockResolvedValue({
                kind: 'cached',
                technical: cachedTechnical,
                fundamental: cachedFundamental,
                news: cachedNews,
            });
            mockCacheGet.mockResolvedValue(null);

            await expect(
                submitOverallAnalysis(
                    makeOptions({ marketDataProvider: undefined })
                )
            ).rejects.toThrow('marketDataProvider');
        });
    });

    describe('skipEnqueueIfMiss 옵션이 true일 때', () => {
        beforeEach(() => {
            // 이 파일의 다른 테스트들이 mockResolvedValueOnce 큐를 남기는
            // 경우가 있어 격리 차원에서 reset (vi.clearAllMocks는 큐를 지우지 않음).
            mockCacheGet.mockReset();
            mockResolveOverallDependencies.mockReset();
            mockResolveOverallDependencies.mockResolvedValue({
                kind: 'cached',
                technical: cachedTechnical,
                fundamental: cachedFundamental,
                news: cachedNews,
            });
        });

        it('sub-axis는 모두 캐시 히트지만 overall 캐시는 미스인 경우 워커를 트리거하지 않고 miss_no_trigger를 반환한다', async () => {
            // resolver는 mockResolvedValue로 'cached' 분기로 들어가도록 셋업됨 (beforeEach 참고).
            // 즉 sub-axis 미스 short-circuit 경로가 아니라 overall-cache 미스 분기를 검증한다.
            mockCacheGet.mockResolvedValue(null);

            const result = await submitOverallAnalysis(
                makeOptions({ skipEnqueueIfMiss: true })
            );

            expect(result).toEqual({ status: 'miss_no_trigger' });
            expect(mockCacheGet).toHaveBeenCalledTimes(1);
            expect(mockSetJobMeta).not.toHaveBeenCalled();
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('캐시 히트면 평소처럼 cached 결과를 반환한다', async () => {
            mockCacheGet.mockResolvedValue(cachedOverallResult);

            const result = await submitOverallAnalysis(
                makeOptions({ skipEnqueueIfMiss: true })
            );

            expect(result.status).toBe('cached');
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('옵션이 생략되면 기존대로 캐시 미스 시 submitted를 반환한다', async () => {
            mockCacheGet.mockResolvedValue(null);

            const result = await submitOverallAnalysis(makeOptions());

            expect(result.status).toBe('submitted');
            expect(mockFetch).toHaveBeenCalled();
        });

        it('resolver가 miss_no_trigger를 반환하면 워커 트리거 없이 miss_no_trigger를 반환한다', async () => {
            // resolver-level short-circuit (any sub-axis missed cache while
            // skipEnqueueIfMiss was propagated) — overall must not enqueue,
            // not even reach the overall cache check.
            mockResolveOverallDependencies.mockResolvedValue({
                kind: 'miss_no_trigger',
            });

            const result = await submitOverallAnalysis(
                makeOptions({ skipEnqueueIfMiss: true })
            );

            expect(result).toEqual({ status: 'miss_no_trigger' });
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockSetJobMeta).not.toHaveBeenCalled();
            expect(mockFetch).not.toHaveBeenCalled();
        });
    });

    describe('options axis integration', () => {
        // `tone` lives on OptionsPerExpirationCommentary, not on the
        // top-level OptionsAnalysisResponse. Keep the fixture limited to the
        // real shape.
        const cachedOptionsResponse = {
            summary: '옵션 시장 요약',
            perExpiration: [],
            signals: [],
            analyzedAt: '2099-01-01T00:00:00Z',
        };

        beforeEach(() => {
            mockCacheGet.mockReset();
            mockResolveOverallDependencies.mockReset();
        });

        it('includes options payload in input hash so cached overall keys differ when options changes', async () => {
            // First call: options = null
            mockResolveOverallDependencies.mockResolvedValueOnce({
                kind: 'cached',
                technical: cachedTechnical,
                fundamental: cachedFundamental,
                news: cachedNews,
                options: null,
            });
            mockCacheGet.mockResolvedValueOnce(null);
            await submitOverallAnalysis(makeOptions());
            const firstCacheKey = mockCacheGet.mock.calls[0]?.[0];

            // Second call: same axes but options is now non-null
            mockResolveOverallDependencies.mockResolvedValueOnce({
                kind: 'cached',
                technical: cachedTechnical,
                fundamental: cachedFundamental,
                news: cachedNews,
                options: cachedOptionsResponse,
            });
            mockCacheGet.mockResolvedValueOnce(null);
            await submitOverallAnalysis(makeOptions());
            const secondCacheKey = mockCacheGet.mock.calls[1]?.[0];

            expect(firstCacheKey).not.toBe(secondCacheKey);
        });

        it('passes options payload to buildOverallAnalysisPrompt (8th arg)', async () => {
            mockResolveOverallDependencies.mockResolvedValueOnce({
                kind: 'cached',
                technical: cachedTechnical,
                fundamental: cachedFundamental,
                news: cachedNews,
                options: cachedOptionsResponse,
            });
            mockCacheGet.mockResolvedValueOnce(null);
            await submitOverallAnalysis(makeOptions());

            expect(mockBuildOverallAnalysisPrompt).toHaveBeenCalledTimes(1);
            const args = mockBuildOverallAnalysisPrompt.mock.calls[0];
            // 8th positional arg = options payload.
            expect(args[7]).toEqual(cachedOptionsResponse);
        });

        it('passes optionsOiStale to buildOverallAnalysisPrompt (9th arg) and setJobMeta', async () => {
            mockResolveOverallDependencies.mockResolvedValueOnce({
                kind: 'cached',
                technical: cachedTechnical,
                fundamental: cachedFundamental,
                news: cachedNews,
                options: cachedOptionsResponse,
            });
            mockCacheGet.mockResolvedValueOnce(null);
            await submitOverallAnalysis(makeOptions({ optionsOiStale: true }));

            const args = mockBuildOverallAnalysisPrompt.mock.calls[0];
            expect(args[8]).toBe(true);

            // setJobMeta receives optionsOiStale so pollOverallAnalysis can
            // echo it back when normalizing.
            expect(mockSetJobMeta).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ optionsOiStale: true })
            );
        });

        it('defaults optionsOiStale to false when omitted', async () => {
            mockResolveOverallDependencies.mockResolvedValueOnce({
                kind: 'cached',
                technical: cachedTechnical,
                fundamental: cachedFundamental,
                news: cachedNews,
                options: cachedOptionsResponse,
            });
            mockCacheGet.mockResolvedValueOnce(null);
            await submitOverallAnalysis(makeOptions());

            const args = mockBuildOverallAnalysisPrompt.mock.calls[0];
            expect(args[8]).toBe(false);
        });

        it('surfaces options axis error like other axis errors', async () => {
            mockResolveOverallDependencies.mockResolvedValueOnce({
                kind: 'error',
                axis: 'options',
                error: {
                    status: 'limit_error',
                    code: 'usage_limit_exceeded',
                    error: { code: 'usage_limit_exceeded', message: 'limit' },
                },
            });

            const result = await submitOverallAnalysis(makeOptions());

            expect(result.status).toBe('error');
            if (result.status === 'error' && 'axis' in result) {
                expect(result.axis).toBe('options');
            }
        });

        it('forwards pending options jobId in pendingJobs', async () => {
            mockResolveOverallDependencies.mockResolvedValueOnce({
                kind: 'pending',
                pendingJobs: {
                    technical: undefined,
                    fundamental: undefined,
                    news: undefined,
                    options: 'opt-job-abc',
                },
            });

            const result = await submitOverallAnalysis(makeOptions());

            expect(result.status).toBe('pending_dependencies');
            if (result.status === 'pending_dependencies') {
                expect(result.pendingJobs.options).toBe('opt-job-abc');
            }
        });
    });
});
