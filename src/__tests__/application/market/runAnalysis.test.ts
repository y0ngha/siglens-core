import type { AnalysisLocale } from '@/domain/analysis/outputLocale';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { DEEPSEEK_V4_1_FLASH_MODEL } from '@/application/chat/constants';
import type { AnalysisResponse, Skill, Timeframe } from '@/domain/types';
import {
    EMPTY_INDICATOR_RESULT,
    EMPTY_SMC_RESULT,
} from '@/domain/indicators/constants';
import { getAllowedTimeframes } from '@/domain/tier';
import { CRYPTO_SESSION, US_EQUITY_SESSION } from '@/domain/session';
import { makeKrSession } from '../../helpers/krSession';
import type { MarketDataProvider } from '@/domain/ports/marketDataProvider';

vi.mock('@/application/analysis/callAnalysisAi');
vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/skills/loader');
vi.mock('@/application/market/barsApi');
vi.mock('@/domain/analysis/prompt', () => ({
    buildAnalysisPrompt: vi.fn(() => ({
        stable: 'mock-stable',
        dynamic: 'mock-dynamic',
        overlayCandidates: [],
        overlayBuildFailures: [],
        patternScreenFailure: null,
        patternArbitration: { kept: [], dropped: [] },
        patternGeometries: new Map(),
    })),
}));
vi.mock('@/domain/indicators/fearGreed', async () => ({
    ...(await vi.importActual<typeof import('@/domain/indicators/fearGreed')>(
        '@/domain/indicators/fearGreed'
    )),
    computeFearGreedIndex: vi.fn(),
}));
// Partial mock: keep isFallbackAnalysis real so cache-skip predicate
// runs against actual logic; mock enrichAnalysisWithConfidence for isolation.
vi.mock('@/domain/analysis/confidence', async () => {
    const actual = await vi.importActual<
        typeof import('@/domain/analysis/confidence')
    >('@/domain/analysis/confidence');
    return { ...actual, enrichAnalysisWithConfidence: vi.fn() };
});
vi.mock('@/domain/analysis/ai-levels');
// Spy wrapping the real function: the wiring test asserts what runAnalysis feeds it.
vi.mock('@/domain/analysis/riskLevel', async importOriginal => {
    const actual =
        await importOriginal<typeof import('@/domain/analysis/riskLevel')>();
    return { ...actual, computeRiskLevel: vi.fn(actual.computeRiskLevel) };
});
vi.mock('@/infrastructure/cache/config', async () => {
    const actual = await vi.importActual<
        typeof import('@/infrastructure/cache/config')
    >('@/infrastructure/cache/config');
    return { ...actual, computeEffectiveTtl: vi.fn().mockReturnValue(3600) };
});
vi.mock('@/infrastructure/skills/sampling', async importOriginal => {
    const actual =
        await importOriginal<
            typeof import('@/infrastructure/skills/sampling')
        >();
    return {
        ...actual,
        createSkillSamplingPlan: vi.fn(actual.createSkillSamplingPlan),
    };
});

import {
    runAnalysis,
    runAnalysisForOverall,
} from '@/application/market/runAnalysis';
import { computeRiskLevel } from '@/domain/analysis/riskLevel';
import { USER_API_KEY_REQUIRED_MESSAGE } from '@/application/byok/messages';
import type { UsageRepository } from '@/domain/ports/usageRepository';
import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import {
    buildAnalysisPeekCacheKey,
    computeEffectiveTtl,
    DEFAULT_ANALYSIS_MODEL_ID,
    PROMPT_TEMPLATE_VERSION,
} from '@/infrastructure/cache/config';
import { DEFAULT_TIER } from '@/domain/tier';
import { loadSkillsCached } from '@/infrastructure/skills/loader';
import { fetchBarsWithIndicators } from '@/application/market/barsApi';
import { buildAnalysisPrompt } from '@/domain/analysis/prompt';
import { AI_SYSTEM_PROMPT } from '@/domain/analysis/systemPrompt';
import { computeFearGreedIndex } from '@/domain/indicators/fearGreed';
import {
    enrichAnalysisWithConfidence,
    EMPTY_ANALYSIS_FALLBACK_SUMMARY,
} from '@/domain/analysis/confidence';
import { postProcessAnalysisWithReconcile } from '@/domain/analysis/ai-levels';
import { analysisSeed } from '@/infrastructure/hash/analysisInput';

const mockCallAnalysisAi = callAnalysisAi as Mock;
const mockCreateCacheProvider = createCacheProvider as Mock;
const mockLoadSkillsCached = loadSkillsCached as Mock;
const mockFetchBarsWithIndicators = fetchBarsWithIndicators as Mock;
const mockBuildAnalysisPrompt = buildAnalysisPrompt as Mock;
const mockComputeFearGreedIndex = computeFearGreedIndex as Mock;
const mockEnrichAnalysisWithConfidence = enrichAnalysisWithConfidence as Mock;
const mockPostProcessAnalysisWithReconcile =
    postProcessAnalysisWithReconcile as Mock;
const mockComputeEffectiveTtl = computeEffectiveTtl as Mock;

const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheProvider = {
    get: mockCacheGet,
    set: mockCacheSet,
    delete: vi.fn(),
};

const mockSymbol = 'AAPL';
const mockCompanyName = 'Apple Inc.';
const mockTimeframe: Timeframe = '1Day';

const mockBarsData = {
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
        ...EMPTY_INDICATOR_RESULT,
        smc: EMPTY_SMC_RESULT,
    },
};

const mockRawResult: AnalysisResponse = {
    summary: '테스트 요약',
    trend: 'bullish' as const,
    indicatorResults: [],
    riskLevel: 'low' as const,
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

const fakeProvider: MarketDataProvider = {
    getBars: vi.fn().mockResolvedValue([]),
    getQuote: vi.fn().mockResolvedValue(null),
};

const restrictedTierConfig = {
    limits: {
        analysisPerDay: { free: 1, member: Infinity, pro: Infinity },
        chatbotPerDay: { free: Infinity, member: Infinity, pro: Infinity },
    },
    timeframes: { free: ['1Day'], member: ['1Day'], pro: ['1Day'] },
    infoDepth: { free: ['summary'], member: ['summary'], pro: ['summary'] },
    models: {
        free: ['gemini-3.6-flash'],
        member: ['gemini-3.6-flash'],
        pro: ['gemini-3.6-flash'],
    },
    featureFlags: { enableTierRestrictions: true },
} as const;

describe('runAnalysis', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockLoadSkillsCached.mockResolvedValue({
            skills: [] as Skill[],
            skillsDegraded: false,
        });
        mockFetchBarsWithIndicators.mockResolvedValue(mockBarsData);
        mockComputeFearGreedIndex.mockReturnValue(null);
        // Provide defaults for enrichment/reconcile mocks so the done path works.
        mockEnrichAnalysisWithConfidence.mockReturnValue(mockRawResult);
        mockPostProcessAnalysisWithReconcile.mockReturnValue(mockRawResult);
        mockCacheSet.mockResolvedValue(undefined);
        mockCacheGet.mockResolvedValue(null);
        mockCallAnalysisAi.mockResolvedValue(JSON.stringify(mockRawResult));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('tier gate', () => {
        it('tier not allowed for timeframe → returns {status:"error"}', async () => {
            const result = await runAnalysis(
                mockSymbol,
                mockCompanyName,
                '5Min',
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    tierConfig: restrictedTierConfig,
                    tierContext: { userId: 'u1', tier: 'free' },
                }
            );

            expect(result).toEqual({
                status: 'error',
                error: {
                    code: 'timeframe_not_allowed',
                    message: 'Timeframe 5Min is not available for free tier.',
                    tier: 'free',
                    timeframe: '5Min',
                    allowedTimeframes: getAllowedTimeframes(
                        'free',
                        restrictedTierConfig
                    ),
                },
            });
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });
    });

    describe('cache hit', () => {
        it('cache hit → callAnalysisAi NOT called, returns {status:"cached"}', async () => {
            mockCacheGet.mockResolvedValueOnce(mockRawResult);

            const result = await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe
            );

            expect(result.status).toBe('cached');
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
            expect(mockFetchBarsWithIndicators).not.toHaveBeenCalled();
        });

        it('cache hit → no `unfilteredResult` (persistence already happened)', async () => {
            // The field is deliberately absent on `cached`: the row it would
            // feed was written when the analysis was first generated, and
            // adding it here would invite callers to persist a duplicate on
            // every cache hit. Pinning the absence keeps that contract from
            // drifting silently.
            mockCacheGet.mockResolvedValueOnce(mockRawResult);

            const result = await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe
            );

            expect(result.status).toBe('cached');
            expect('unfilteredResult' in result).toBe(false);
        });
    });

    describe('options.cache 주입', () => {
        const injectedGet = vi.fn();
        const injectedSet = vi.fn();
        const injectedCache = {
            get: injectedGet,
            set: injectedSet,
            delete: vi.fn(),
        };

        beforeEach(() => {
            injectedGet.mockReset();
            injectedSet.mockReset();
            injectedGet.mockResolvedValue(null);
            injectedSet.mockResolvedValue(undefined);
        });

        it('주입한 캐시에서 읽고, env 캐시는 만들지도 읽지도 않는다', async () => {
            injectedGet.mockResolvedValueOnce(mockRawResult);

            const result = await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { cache: injectedCache }
            );

            expect(result.status).toBe('cached');
            expect(injectedGet).toHaveBeenCalledTimes(1);
            expect(mockCreateCacheProvider).not.toHaveBeenCalled();
            expect(mockCacheGet).not.toHaveBeenCalled();
        });

        it('캐시 미스 시 결과를 주입한 캐시에 기록하고 env 캐시에는 쓰지 않는다', async () => {
            const result = await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider, cache: injectedCache }
            );

            expect(result.status).toBe('done');
            expect(injectedSet).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ summary: '테스트 요약' }),
                3600
            );
            expect(mockCacheSet).not.toHaveBeenCalled();
            expect(mockCreateCacheProvider).not.toHaveBeenCalled();
        });

        it('cache: null 이면 env 캐시로 폴백하지 않고 캐시 없이 실행한다', async () => {
            const result = await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider, cache: null }
            );

            expect(result.status).toBe('done');
            expect(mockCreateCacheProvider).not.toHaveBeenCalled();
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockCacheSet).not.toHaveBeenCalled();
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
        });
    });

    describe('skipEnqueueIfMiss (bot path)', () => {
        it('cache miss + skipEnqueueIfMiss → returns {status:"miss_no_trigger"}, LLM not called', async () => {
            const result = await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    skipEnqueueIfMiss: true,
                }
            );

            expect(result).toEqual({ status: 'miss_no_trigger' });
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });
    });

    describe('cache miss → LLM call', () => {
        it('cache miss → callAnalysisAi called once, returns {status:"done"}', async () => {
            const result = await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(result.status).toBe('done');
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
        });

        it('free tier: `result` is filtered but `unfilteredResult` keeps riskLevel', async () => {
            // free의 infoDepth는 direction/summary/skill_detection뿐이라
            // `riskLevel`(partial_detail)이 렌더용 `result`에서는 null이 된다.
            // 그 모양을 그대로 저장하면 `PriorAnalysis`가 요구하는 riskLevel이
            // 없어 이후 모든 읽기가 그 행을 버린다 — 이력이 조용히 비는 경로다.
            const result = await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    tierContext: { userId: null, tier: 'free' },
                }
            );

            expect(result.status).toBe('done');
            if (result.status !== 'done') return;

            expect(result.result.riskLevel).toBeNull();
            expect(result.unfilteredResult.riskLevel).toBe('low');
            expect(result.unfilteredResult.trend).toBe(mockRawResult.trend);
        });

        it('feeds computeRiskLevel only data (bars, events, earningsDates) and ignores the LLM stop', async () => {
            const event = {
                publishedAt: new Date(),
                category: 'earnings' as const,
                sentiment: 'bearish' as const,
                impact: 'high' as const,
            };
            const rawStop = 50;
            const reconciledStop = 90;
            mockPostProcessAnalysisWithReconcile.mockReturnValueOnce({
                ...mockRawResult,
                actionRecommendation: {
                    ...mockRawResult.actionRecommendation,
                    stopLoss: rawStop,
                    reconciledLevels: { stopLoss: reconciledStop },
                },
            });
            const earningsDates = ['2026-10-15'];

            const result = await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    marketEvents: [event],
                    earningsDates,
                }
            );

            expect(result.status).toBe('done');
            const input = vi.mocked(computeRiskLevel).mock.lastCall![0];
            expect('stopLoss' in input).toBe(false);
            expect(input.events).toEqual([event]);
            expect(input.earningsDates).toBe(earningsDates);
            expect(input.timeframe).toBe(mockTimeframe);
            expect(input.bars).toBe(mockBarsData.bars);
        });

        it('overwrites the model riskLevel with the computed one (same for every locale)', async () => {
            const levels: string[] = [];
            for (const [locale, modelPick] of [
                ['ko', 'high'],
                ['en', 'medium'],
            ] as const) {
                mockCallAnalysisAi.mockResolvedValueOnce(
                    JSON.stringify({ ...mockRawResult, riskLevel: modelPick })
                );
                const result = await runAnalysis(
                    mockSymbol,
                    mockCompanyName,
                    mockTimeframe,
                    false,
                    undefined,
                    { marketDataProvider: fakeProvider, locale }
                );
                expect(result.status).toBe('done');
                if (result.status !== 'done') return;
                levels.push(result.unfilteredResult.riskLevel);
            }
            // Two bars: no volatility, trend or event points -> 'low'.
            expect(levels).toEqual(['low', 'low']);
        });

        it('result carries dataAsOf = start time and close of the last bar the prompt used', async () => {
            const result = await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(result.status).toBe('done');
            if (result.status !== 'done') return;
            expect(result.result.dataAsOf).toEqual({
                barTime: 1705312200,
                close: 103,
            });
            expect(result.unfilteredResult.dataAsOf).toEqual({
                barTime: 1705312200,
                close: 103,
            });
        });

        it('dataAsOf is also written to the cache entry (so cache hits can read it)', async () => {
            await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(mockCacheSet).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    dataAsOf: { barTime: 1705312200, close: 103 },
                }),
                3600
            );
        });

        it('with no usable bars dataAsOf is omitted rather than guessed', async () => {
            mockFetchBarsWithIndicators.mockResolvedValue({
                ...mockBarsData,
                bars: [],
            });
            const result = await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(result.status).toBe('done');
            if (result.status !== 'done') return;
            expect('dataAsOf' in result.result).toBe(false);
        });

        it('callAnalysisAi receives prompt, system, seed, and model', async () => {
            await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({
                    prompt: 'mock-dynamic',
                    system: `${AI_SYSTEM_PROMPT}\n\nmock-stable`,
                    seed: analysisSeed(
                        `${AI_SYSTEM_PROMPT}\n\nmock-stable\n\nmock-dynamic`
                    ),
                    // modelId 미지정 → UI 기본값(useSelectedModel의 DEFAULT_MODEL)과
                    // 같은 모델로 해석된다. 'analysis-worker'는 캐시 키 센티널일 뿐
                    // 호출 가능한 모델이 아니다 — runAnalysis.ts의
                    // DEFAULT_RUN_ANALYSIS_MODEL JSDoc 참조.
                    model: DEEPSEEK_V4_1_FLASH_MODEL,
                })
            );
        });

        it('explicit modelId is forwarded to callAnalysisAi', async () => {
            // claude-haiku-5-5 is in FREE_MODELS so no BYOK gate fires.
            await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    modelId: 'claude-haiku-5-5',
                }
            );

            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ model: 'claude-haiku-5-5' })
            );
        });

        it('signal is forwarded to callAnalysisAi', async () => {
            const signal = AbortSignal.timeout(5_000);

            await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    signal,
                }
            );

            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ signal })
            );
        });

        it('providerFallback is forwarded to callAnalysisAi as fallbackOnProviderFailure', async () => {
            await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    providerFallback: true,
                }
            );

            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ fallbackOnProviderFailure: true })
            );
        });
    });

    describe('onPromptAssembled', () => {
        it('cache miss → called once with the exact system/stable/dynamic the provider call receives', async () => {
            const onPromptAssembled = vi.fn();

            await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider, onPromptAssembled }
            );

            expect(onPromptAssembled).toHaveBeenCalledTimes(1);
            const providerArgs = mockCallAnalysisAi.mock.calls[0][0];
            expect(onPromptAssembled).toHaveBeenCalledWith({
                system: providerArgs.system,
                stable: 'mock-stable',
                dynamic: providerArgs.prompt,
                promptVersion: PROMPT_TEMPLATE_VERSION,
            });
        });

        it('cache hit → NOT called', async () => {
            mockCacheGet.mockResolvedValueOnce(mockRawResult);
            const onPromptAssembled = vi.fn();

            await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider, onPromptAssembled }
            );

            expect(onPromptAssembled).not.toHaveBeenCalled();
        });

        it('a throwing callback does not fail the analysis or change the result', async () => {
            const onPromptAssembled = vi.fn(() => {
                throw new Error('persistence boom');
            });
            const consoleErrorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});

            const withCallback = await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider, onPromptAssembled }
            );

            mockCacheGet.mockClear();
            const withoutCallback = await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(onPromptAssembled).toHaveBeenCalledTimes(1);
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('onPromptAssembled'),
                expect.any(Error)
            );
            // `analyzedAt` is stamped per call from the wall clock, so a
            // whole-object comparison flakes whenever the two awaited calls
            // straddle a millisecond. Compare everything else.
            const dropStamp = (r?: { analyzedAt?: string }) => {
                if (r === undefined) return undefined;
                const { analyzedAt: _dropped, ...rest } = r;
                return rest;
            };
            // `analyzedAt` is stamped per call from the wall clock — on both
            // `result` and `unfilteredResult`, which carry the same stamp.
            const stripStamp = (r: unknown) => {
                const { result, unfilteredResult, ...rest } = r as {
                    result?: { analyzedAt?: string };
                    unfilteredResult?: { analyzedAt?: string };
                };
                return {
                    ...rest,
                    ...(result !== undefined
                        ? { result: dropStamp(result) }
                        : {}),
                    ...(unfilteredResult !== undefined
                        ? { unfilteredResult: dropStamp(unfilteredResult) }
                        : {}),
                };
            };
            expect(stripStamp(withCallback)).toEqual(
                stripStamp(withoutCallback)
            );

            consoleErrorSpy.mockRestore();
        });

        it('omitting it leaves the result and the cache key unchanged', async () => {
            await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );
            const keyWithoutCallback = mockCacheGet.mock.calls[0]![0];

            mockCacheGet.mockClear();
            await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    onPromptAssembled: vi.fn(),
                }
            );
            const keyWithCallback = mockCacheGet.mock.calls[0]![0];

            expect(keyWithCallback).toEqual(keyWithoutCallback);
        });
    });

    describe('cache write', () => {
        it('result is written to cache with TTL from computeEffectiveTtl', async () => {
            await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(mockComputeEffectiveTtl).toHaveBeenCalled();
            expect(mockCacheSet).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ summary: mockRawResult.summary }),
                3600
            );
        });

        it('options.session is forwarded to computeEffectiveTtl', async () => {
            await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider, session: CRYPTO_SESSION }
            );

            expect(mockComputeEffectiveTtl).toHaveBeenCalledWith(
                mockTimeframe,
                expect.any(Date),
                CRYPTO_SESSION
            );
        });

        it('without options.session computeEffectiveTtl gets no session (previous behaviour)', async () => {
            await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(mockComputeEffectiveTtl).toHaveBeenCalledWith(
                mockTimeframe,
                expect.any(Date),
                undefined
            );
        });

        it('session does not change the cache key', async () => {
            for (const session of [undefined, US_EQUITY_SESSION]) {
                await runAnalysis(
                    mockSymbol,
                    mockCompanyName,
                    mockTimeframe,
                    false,
                    undefined,
                    { marketDataProvider: fakeProvider, session }
                );
            }

            const readKeys = new Set(
                mockCacheGet.mock.calls.map(call => call[0] as string)
            );
            expect(mockCacheGet).toHaveBeenCalledTimes(2);
            expect(readKeys.size).toBe(1);
        });

        it('a fresh generation also writes the peek pointer key (same value, same TTL)', async () => {
            await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            const pointerKey = buildAnalysisPeekCacheKey(
                mockSymbol,
                mockTimeframe,
                DEFAULT_ANALYSIS_MODEL_ID,
                DEFAULT_TIER
            );
            expect(mockCacheSet).toHaveBeenCalledTimes(2);
            expect(mockCacheSet).toHaveBeenCalledWith(
                pointerKey,
                expect.objectContaining({ summary: mockRawResult.summary }),
                3600
            );
        });

        it('fallback analysis → cache write skipped', async () => {
            // isFallbackAnalysis checks for the canonical fallback summary AND
            // all arrays empty. mockRawResult already has empty arrays; just
            // swap the summary to the fallback sentinel.
            const fallbackResult: AnalysisResponse = {
                ...mockRawResult,
                summary: EMPTY_ANALYSIS_FALLBACK_SUMMARY,
            };
            mockEnrichAnalysisWithConfidence.mockReturnValueOnce(
                fallbackResult
            );
            mockPostProcessAnalysisWithReconcile.mockReturnValueOnce(
                fallbackResult
            );
            const warnSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => undefined);

            const result = await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(result.status).toBe('done');
            expect(mockCacheSet).not.toHaveBeenCalled();
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('skipping cache write'),
                expect.any(Object)
            );
            warnSpy.mockRestore();
        });
    });

    describe('in-flight deduplication', () => {
        it('two concurrent calls with the same cache key → callAnalysisAi called once', async () => {
            let resolveAi!: (value: string) => void;
            const pendingAi = new Promise<string>(res => {
                resolveAi = res;
            });
            mockCallAnalysisAi.mockReturnValueOnce(pendingAi);

            const p1 = runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );
            const p2 = runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            resolveAi(JSON.stringify(mockRawResult));

            const [r1, r2] = await Promise.all([p1, p2]);

            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(r1.status).toBe('done');
            expect(r2.status).toBe('done');
        });

        it('동시 호출이어도 onPromptAssembled는 생성 1회당 한 번만 발화한다', async () => {
            // 회귀 가드. 콜백이 dedup 팩토리 **밖**에 있으면 호출자마다 한 번씩
            // 발화해, 실제 생성은 1회인데 기록은 N개가 되고 — 더 나쁘게 —
            // 진 호출자에게는 **전송된 적 없는** 프롬프트가 전달된다(그가 받는
            // 결과는 이긴 호출자의 것). 소비자가 "이 행을 만든 프롬프트"로
            // 저장하면 중복 + 오귀속이 된다.
            let resolveAi!: (value: string) => void;
            const pendingAi = new Promise<string>(res => {
                resolveAi = res;
            });
            mockCallAnalysisAi.mockReturnValueOnce(pendingAi);

            const onPromptAssembled = vi.fn();
            const call = () =>
                runAnalysis(
                    mockSymbol,
                    mockCompanyName,
                    mockTimeframe,
                    false,
                    undefined,
                    { marketDataProvider: fakeProvider, onPromptAssembled }
                );

            const p1 = call();
            const p2 = call();

            resolveAi(JSON.stringify(mockRawResult));
            await Promise.all([p1, p2]);

            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(onPromptAssembled).toHaveBeenCalledTimes(1);

            // 그리고 캡처된 프롬프트는 실제로 전송된 바로 그것이어야 한다.
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

        it('서로 다른 콜백을 넘긴 동시 호출에서는 승자의 것만 발화한다', async () => {
            // 멀티테넌트 실제 시나리오: 서로 다른 소비자가 같은 심볼·타임프레임을
            // 동시에 요청한다. dedup 팩토리가 승자 것만 실행하므로 패자의 콜백은
            // **아예 호출되지 않는다** — 패자는 승자의 결과를 받지만 그 결과에
            // 대응하는 프롬프트는 못 받는다.
            //
            // 대안(모든 호출자의 콜백 발화)이 더 나쁘다: 패자에게 전송된 적 없는
            // 프롬프트를 넘겨 결과에 잘못 귀속시키게 된다. 그래서 이 동작이
            // 의도된 트레이드오프이고, 소비자는 프롬프트 없는 결과 행을
            // 허용해야 한다. 이 테스트는 그 계약을 고정한다.
            let resolveAi!: (value: string) => void;
            mockCallAnalysisAi.mockReturnValueOnce(
                new Promise<string>(res => {
                    resolveAi = res;
                })
            );

            const winnerCb = vi.fn();
            const loserCb = vi.fn();
            const call = (onPromptAssembled: () => void) =>
                runAnalysis(
                    mockSymbol,
                    mockCompanyName,
                    mockTimeframe,
                    false,
                    undefined,
                    { marketDataProvider: fakeProvider, onPromptAssembled }
                );

            const p1 = call(winnerCb);
            const p2 = call(loserCb);

            resolveAi(JSON.stringify(mockRawResult));
            const [r1, r2] = await Promise.all([p1, p2]);

            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            // 정확히 하나만 발화한다. 어느 쪽이 승자인지는 스케줄링에 달렸으므로
            // 합계로 단언한다 — 그래야 순서에 기대지 않는다.
            expect(winnerCb.mock.calls.length + loserCb.mock.calls.length).toBe(
                1
            );
            // 그럼에도 두 호출자 모두 결과는 받는다.
            expect(r1.status).toBe('done');
            expect(r2.status).toBe('done');
        });
    });

    /**
     * `options.priorAnalyses`가 `narrowPriorAnalysesForCacheKey`(캐시 키
     * 단계)와 `buildAnalysisPrompt`의 11번째 인자(프롬프트 단계) 양쪽에
     * 올바르게 배선되는지, 그리고 생략했을 때 기존 캐시 키와 바이트가
     * 같은지 확인한다 (Task 6b).
     */
    describe('prior-analysis-context (Task 6b)', () => {
        it('priorAnalyses를 생략하면 캐시 키가 예전과 동일하다(:hist= 세그먼트 없음)', async () => {
            await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            const keyArg = mockCacheGet.mock.calls[0]![0] as string;
            expect(keyArg).not.toContain(':hist=');
        });

        it('현재 캐시 윈도우 안에서 생성된 priorAnalyses만 있으면(생존자 0명) 캐시 키가 생략 시와 동일하다', async () => {
            await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );
            const omittedKey = mockCacheGet.mock.calls[0]![0] as string;

            mockCacheGet.mockClear();
            await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    // Generated "now" — inside the current cache window for
                    // '1Day' (ANALYSIS_CACHE_TTL['1Day'] = 24h) — so stage 1
                    // excludes it and the fingerprint stays undefined.
                    priorAnalyses: [
                        {
                            generatedAt: new Date(),
                            trend: 'bullish',
                            riskLevel: 'low',
                        },
                    ],
                }
            );
            const withRecentHistoryKey = mockCacheGet.mock
                .calls[0]![0] as string;

            expect(withRecentHistoryKey).toBe(omittedKey);
        });

        it('윈도우 밖의 priorAnalyses가 있으면 캐시 키에 :hist= 세그먼트가 붙고, buildAnalysisPrompt의 11번째 인자로 narrowed candidates가 전달된다', async () => {
            const oldEntry = {
                generatedAt: new Date('2020-01-01T00:00:00.000Z'),
                trend: 'bullish' as const,
                riskLevel: 'low' as const,
            };

            await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    priorAnalyses: [oldEntry],
                }
            );

            const keyArg = mockCacheGet.mock.calls[0]![0] as string;
            expect(keyArg).toContain(':hist=');

            const promptArgs = mockBuildAnalysisPrompt.mock.calls[0]!;
            expect(promptArgs[10]).toEqual([oldEntry]);
        });

        // M2: KRX 마감 후(19:30 KST)에 쓴 행은 같은 마감 세션 동안 키에 들어오면 안
        // 된다. 세션 없이는 KST 05:00 앵커가 굴러가며 그 행이 들어와 키가 바뀐다.
        it('1Day + session이면 마감 후 쓴 행이 다음 날 아침에도 :hist=를 만들지 않는다', async () => {
            vi.useFakeTimers({ toFake: ['Date'] });
            try {
                vi.setSystemTime(new Date('2026-09-29T21:30:00.000Z'));
                const eveningRow = {
                    generatedAt: new Date('2026-09-29T10:30:00.000Z'),
                    trend: 'bullish' as const,
                    riskLevel: 'low' as const,
                };
                const run = (withSession: boolean) =>
                    runAnalysis(
                        mockSymbol,
                        mockCompanyName,
                        '1Day',
                        false,
                        undefined,
                        {
                            marketDataProvider: fakeProvider,
                            priorAnalyses: [eveningRow],
                            session: withSession ? makeKrSession() : undefined,
                        }
                    );

                await run(true);
                expect(mockCacheGet.mock.calls[0]![0]).not.toContain(':hist=');

                mockCacheGet.mockClear();
                await run(false);
                expect(mockCacheGet.mock.calls[0]![0]).toContain(':hist=');
            } finally {
                vi.useRealTimers();
            }
        });
    });

    /**
     * 로케일 분기는 세 곳을 동시에 건드린다 — 시스템 프롬프트 선택, 프롬프트
     * 말미 리마인더, 캐시 키. **기본 로케일은 셋 다 예전과 바이트가 같아야**
     * 이미 쌓인 한국어 캐시가 살아 있다.
     */
    describe('출력 로케일', () => {
        const run = (locale?: AnalysisLocale) =>
            runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    ...(locale === undefined ? {} : { locale }),
                }
            );

        const sentOf = () => {
            const call = mockCallAnalysisAi.mock.calls.at(-1)![0] as {
                system: string;
                prompt: string;
            };
            return { system: call.system, prompt: call.prompt };
        };

        it('로케일을 생략하면 ko와 같은 system·prompt를 보낸다', async () => {
            await run();
            const omitted = sentOf();
            mockCallAnalysisAi.mockClear();
            await run('ko');
            expect(sentOf()).toEqual(omitted);
        });

        it.each(['en', 'ja', 'zh'] as const)(
            '%s: 프롬프트 말미에 출력 언어 리마인더가 붙는다',
            async locale => {
                await run(locale);
                expect(sentOf().prompt).toContain(
                    'OUTPUT LANGUAGE (FINAL, OVERRIDES EVERYTHING ABOVE)'
                );
            }
        );
    });
});

describe('marketEvents 주입', () => {
    const BAR_START = 1_700_000_000;
    const BAR_IV = 900;
    const barProvider: MarketDataProvider = {
        getBars: vi.fn().mockResolvedValue(
            Array.from({ length: 20 }, (_, i) => ({
                time: BAR_START + i * BAR_IV,
                open: 100,
                high: 101,
                low: 99,
                close: 100,
                volume: 1000,
            }))
        ),
        getQuote: vi.fn().mockResolvedValue(null),
    };

    const event = {
        publishedAt: new Date((BAR_START + 10 * BAR_IV) * 1000),
        category: 'earnings' as const,
        sentiment: 'bullish' as const,
        impact: 'high' as const,
    };

    /**
     * `buildAnalysisPrompt`는 이 파일에서 모킹돼 있으므로 렌더 결과가 아니라
     * **전달된 인자**를 본다. 실제 섹션 문자열은
     * `marketEventsSection.test.ts`가 검증한다.
     */
    const eventsArg = () =>
        mockBuildAnalysisPrompt.mock.calls.at(-1)?.[11] as unknown;

    it('이벤트가 프롬프트 빌더의 12번째 인자로 전달된다', async () => {
        await runAnalysis(
            mockSymbol,
            mockCompanyName,
            mockTimeframe,
            false,
            undefined,
            { marketDataProvider: barProvider, marketEvents: [event] }
        );

        expect(eventsArg()).toEqual([event]);
    });

    it('이벤트를 안 넘기면 빈 배열이 전달된다 — 섹션이 렌더되지 않는 조건', async () => {
        await runAnalysis(
            mockSymbol,
            mockCompanyName,
            mockTimeframe,
            false,
            undefined,
            { marketDataProvider: barProvider }
        );

        expect(eventsArg()).toEqual([]);
    });

    it('고영향 이벤트가 있으면 캐시 키에 `:evt=` 가 붙는다', async () => {
        mockCacheGet.mockClear();

        await runAnalysis(
            mockSymbol,
            mockCompanyName,
            mockTimeframe,
            false,
            undefined,
            { marketDataProvider: barProvider, marketEvents: [event] }
        );

        const key = mockCacheGet.mock.calls.at(-1)?.[0] as string;
        expect(key).toContain(':evt=');
    });

    it('영향도가 낮은 이벤트만 있으면 캐시 키가 갈리지 않는다', async () => {
        mockCacheGet.mockClear();

        await runAnalysis(
            mockSymbol,
            mockCompanyName,
            mockTimeframe,
            false,
            undefined,
            {
                marketDataProvider: barProvider,
                marketEvents: [{ ...event, impact: 'low' as const }],
            }
        );

        const key = mockCacheGet.mock.calls.at(-1)?.[0] as string;
        expect(key).not.toContain(':evt=');
    });
});

describe('marketEvents 시간 상한', () => {
    // 2026-10-04 일요일 — 일봉은 금요일(10-02)에서 멈춰 있다. 상한은 토요일 00:00Z.
    const SUNDAY = new Date('2026-10-04T15:00:00Z');
    const fridayEvent = {
        publishedAt: new Date('2026-10-02T14:00:00Z'),
        category: 'earnings' as const,
        sentiment: 'bearish' as const,
        impact: 'high' as const,
    };
    const weekendEvent = {
        publishedAt: new Date('2026-10-04T09:00:00Z'),
        category: 'regulation' as const,
        sentiment: 'bearish' as const,
        impact: 'high' as const,
    };
    const lateFridayEvent = {
        ...fridayEvent,
        publishedAt: new Date('2026-10-02T23:59:59Z'),
        impact: 'medium' as const,
    };
    const barProvider: MarketDataProvider = {
        getBars: vi.fn().mockResolvedValue([]),
        getQuote: vi.fn().mockResolvedValue(null),
    };
    const store = new Map<string, unknown>();

    const run = (
        marketEvents: NonNullable<
            Parameters<typeof runAnalysis>[5]
        >['marketEvents'],
        withSession = true
    ) =>
        runAnalysis(mockSymbol, mockCompanyName, '1Day', false, undefined, {
            marketDataProvider: barProvider,
            marketEvents,
            session: withSession ? US_EQUITY_SESSION : undefined,
        });

    beforeEach(() => {
        vi.clearAllMocks();
        store.clear();
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(SUNDAY);
        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockLoadSkillsCached.mockResolvedValue({
            skills: [] as Skill[],
            skillsDegraded: false,
        });
        mockFetchBarsWithIndicators.mockResolvedValue(mockBarsData);
        mockComputeFearGreedIndex.mockReturnValue(null);
        mockEnrichAnalysisWithConfidence.mockReturnValue(mockRawResult);
        mockPostProcessAnalysisWithReconcile.mockReturnValue(mockRawResult);
        mockCallAnalysisAi.mockResolvedValue(JSON.stringify(mockRawResult));
        // 실제 캐시처럼 동작해야 "같은 키면 두 번째 호출이 적중한다"를 볼 수 있다.
        mockCacheGet.mockImplementation(
            async (key: string) => store.get(key) ?? null
        );
        mockCacheSet.mockImplementation(async (key: string, value: unknown) => {
            store.set(key, value);
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('주말 이벤트가 추가돼도 같은 입력이면 캐시 키가 같아 LLM을 한 번만 부른다', async () => {
        const first = await run([fridayEvent]);
        const second = await run([fridayEvent, weekendEvent]);

        expect(first.status).toBe('done');
        expect(second.status).toBe('cached');
        expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
        const keys = mockCacheGet.mock.calls.map(call => call[0] as string);
        expect(new Set(keys).size).toBe(1);
        expect(keys[0]).toContain(':evt=');
    });

    it('프롬프트에는 상한 안의 후보만 전달된다 — 키와 프롬프트가 같은 집합을 본다', async () => {
        await run([fridayEvent, weekendEvent]);

        expect(mockBuildAnalysisPrompt.mock.calls.at(-1)?.[11]).toEqual([
            fridayEvent,
        ]);
    });

    it('상한 직전(금요일 밤) 이벤트가 추가되면 키가 바뀌어 다시 분석한다', async () => {
        await run([fridayEvent]);
        const second = await run([fridayEvent, lateFridayEvent]);

        expect(second.status).toBe('done');
        expect(mockCallAnalysisAi).toHaveBeenCalledTimes(2);
    });

    it('세션이 없으면 상한이 없어 주말 이벤트도 키를 바꾼다(기존 동작)', async () => {
        await run([fridayEvent], false);
        const second = await run([fridayEvent, weekendEvent], false);

        expect(second.status).toBe('done');
        expect(mockCallAnalysisAi).toHaveBeenCalledTimes(2);
    });
});

describe('runAnalysis — 게이트·장애 내성·내부 변형', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockLoadSkillsCached.mockResolvedValue({
            skills: [] as Skill[],
            skillsDegraded: false,
        });
        mockFetchBarsWithIndicators.mockResolvedValue(mockBarsData);
        mockComputeFearGreedIndex.mockReturnValue(null);
        mockEnrichAnalysisWithConfidence.mockReturnValue(mockRawResult);
        mockPostProcessAnalysisWithReconcile.mockReturnValue(mockRawResult);
        mockCacheSet.mockResolvedValue(undefined);
        mockCacheGet.mockResolvedValue(null);
        mockCallAnalysisAi.mockResolvedValue(JSON.stringify(mockRawResult));
    });

    const makeUsageRepository = (analysisCountToday: number) => ({
        getUsageToday: vi
            .fn<UsageRepository['getUsageToday']>()
            .mockResolvedValue({ analysis: analysisCountToday, chatbot: 0 }),
        recordUsage: vi
            .fn<UsageRepository['recordUsage']>()
            .mockResolvedValue(
                {} as Awaited<ReturnType<UsageRepository['recordUsage']>>
            ),
    });

    describe('BYOK 게이트', () => {
        it('free 티어가 BYOK 모델을 키 없이 요청하면 key_error를 돌려주고 캐시·LLM을 건드리지 않는다', async () => {
            const result = await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    tierContext: { userId: 'u1', tier: 'free' },
                    modelId: 'claude-opus-5',
                }
            );

            expect(result).toEqual({
                status: 'key_error',
                code: 'user_api_key_required',
                error: USER_API_KEY_REQUIRED_MESSAGE,
                modelId: 'claude-opus-5',
                tier: 'free',
            });
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });

        it('BYOK 모델이라도 userApiKey가 있으면 게이트를 통과하고 그 키로 해당 모델을 호출한다', async () => {
            const result = await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    tierContext: { userId: 'u1', tier: 'free' },
                    modelId: 'claude-opus-5',
                    userApiKey: 'sk-user',
                }
            );

            expect(result.status).toBe('done');
            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({
                    model: 'claude-opus-5',
                    userApiKey: 'sk-user',
                })
            );
        });
    });

    describe('일일 사용량 게이트', () => {
        it('오늘 사용량이 한도에 도달하면 analysis_limit_exceeded를 돌려주고 기록하지 않는다', async () => {
            const usageRepository = makeUsageRepository(1);

            const result = await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    tierConfig: restrictedTierConfig,
                    tierContext: { userId: 'u1', tier: 'free' },
                    usage: { usageRepository, clientIp: '10.0.0.1' },
                }
            );

            expect(result).toEqual({
                status: 'error',
                error: {
                    code: 'analysis_limit_exceeded',
                    message: 'Daily analysis usage limit exceeded.',
                    feature: 'analysisPerDay',
                    tier: 'free',
                },
            });
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
            expect(usageRepository.recordUsage).not.toHaveBeenCalled();
        });

        it('한도 미만이면 분석을 수행하고 주입된 시각·모델로 사용량을 1회 기록한다', async () => {
            const usageRepository = makeUsageRepository(0);
            const occurredAt = new Date('2026-08-02T10:00:00.000Z');

            const result = await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    tierConfig: restrictedTierConfig,
                    tierContext: { userId: 'u1', tier: 'free' },
                    modelId: 'gemini-3.6-flash',
                    usage: {
                        usageRepository,
                        clientIp: '10.0.0.1',
                        userId: 'u1',
                        occurredAt,
                    },
                }
            );

            expect(result.status).toBe('done');
            expect(usageRepository.getUsageToday).toHaveBeenCalledWith(
                expect.any(String),
                occurredAt
            );
            expect(usageRepository.recordUsage).toHaveBeenCalledTimes(1);
            expect(usageRepository.recordUsage).toHaveBeenCalledWith({
                userId: 'u1',
                ipAddress: '10.0.0.1',
                actionType: 'analysis',
                modelUsed: 'gemini-3.6-flash',
                occurredAt,
            });
        });
    });

    describe('캐시 장애 내성', () => {
        it('캐시 조회가 실패하면 로그만 남기고 LLM 분석으로 진행한다', async () => {
            const errorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => undefined);
            mockCacheGet.mockRejectedValueOnce(new Error('redis down'));

            const result = await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(result.status).toBe('done');
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(errorSpy).toHaveBeenCalledWith(
                '[RunAnalysis] Cache read failed:',
                expect.any(Error)
            );
            errorSpy.mockRestore();
        });

        it('캐시 쓰기가 실패해도 done 결과는 그대로 반환되고 오류는 로그로만 남는다', async () => {
            const errorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => undefined);
            const writeError = new Error('redis write failed');
            mockCacheSet.mockRejectedValueOnce(writeError);

            const result = await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(result.status).toBe('done');
            await vi.waitFor(() =>
                expect(errorSpy).toHaveBeenCalledWith(
                    '[RunAnalysis] Cache write failed:',
                    writeError
                )
            );
            errorSpy.mockRestore();
        });

        it('캐시 프로바이더가 없으면 조회·기록 없이 LLM 결과를 반환한다', async () => {
            mockCreateCacheProvider.mockReturnValueOnce(null);

            const result = await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(result.status).toBe('done');
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockCacheSet).not.toHaveBeenCalled();
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
        });
    });

    describe('캐시 미스 시 marketDataProvider 필수', () => {
        it('provider 없이 캐시 미스가 나면 LLM 호출 전에 throw한다', async () => {
            await expect(
                runAnalysis(mockSymbol, mockCompanyName, mockTimeframe)
            ).rejects.toThrow('options.marketDataProvider is required');
            expect(mockFetchBarsWithIndicators).not.toHaveBeenCalled();
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });
    });

    describe('Fear & Greed 일봉 조회', () => {
        it('1Day가 아닌 타임프레임은 공포탐욕 계산용 일봉을 별도로 조회한다', async () => {
            await runAnalysis(
                mockSymbol,
                mockCompanyName,
                '1Hour',
                false,
                'AAPL.US',
                {
                    marketDataProvider: fakeProvider,
                    tierContext: { userId: 'u1', tier: 'member' },
                }
            );

            expect(mockFetchBarsWithIndicators).toHaveBeenCalledTimes(2);
            expect(mockFetchBarsWithIndicators).toHaveBeenNthCalledWith(
                1,
                fakeProvider,
                mockSymbol,
                '1Hour',
                'AAPL.US'
            );
            expect(mockFetchBarsWithIndicators).toHaveBeenNthCalledWith(
                2,
                fakeProvider,
                mockSymbol,
                '1Day',
                'AAPL.US'
            );
        });

        it('1Day 타임프레임은 이미 받은 봉을 재사용해 일봉을 다시 조회하지 않는다', async () => {
            await runAnalysis(
                mockSymbol,
                mockCompanyName,
                '1Day',
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(mockFetchBarsWithIndicators).toHaveBeenCalledTimes(1);
            expect(mockComputeFearGreedIndex).toHaveBeenCalledWith(
                mockBarsData.bars,
                mockBarsData.indicators.buySellVolume
            );
        });

        it('1Day 응답에 5년 일봉(fearGreedBars)이 있으면 공포탐욕을 그 봉으로 계산한다', async () => {
            const longBars = [...mockBarsData.bars, ...mockBarsData.bars];
            mockFetchBarsWithIndicators.mockResolvedValueOnce({
                ...mockBarsData,
                fearGreedBars: longBars,
            });

            await runAnalysis(
                mockSymbol,
                mockCompanyName,
                '1Day',
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(mockComputeFearGreedIndex).toHaveBeenCalledWith(
                longBars,
                expect.any(Array)
            );
            const [, bsv] = mockComputeFearGreedIndex.mock.calls.find(
                ([bars]) => bars === longBars
            )!;
            expect(bsv).toHaveLength(longBars.length);
        });

        it('일봉 조회가 실패해도 공포탐욕 없이(undefined) 분석을 계속한다', async () => {
            const errorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => undefined);
            mockFetchBarsWithIndicators
                .mockResolvedValueOnce(mockBarsData)
                .mockRejectedValueOnce(new Error('daily bars 503'));

            const result = await runAnalysis(
                mockSymbol,
                mockCompanyName,
                '1Hour',
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    tierContext: { userId: 'u1', tier: 'member' },
                }
            );

            expect(result.status).toBe('done');
            expect(mockComputeFearGreedIndex).not.toHaveBeenCalled();
            // 7번째 인자 = fearGreed 스냅샷
            expect(mockBuildAnalysisPrompt.mock.calls.at(-1)?.[6]).toBe(
                undefined
            );
            expect(errorSpy).toHaveBeenCalledWith(
                expect.stringContaining('FearGreed daily fetch/compute failed'),
                expect.any(Error)
            );
            errorSpy.mockRestore();
        });
    });

    describe('stable 스킬 다이제스트가 비어 있을 때', () => {
        it('system 프롬프트에 빈 구분자를 붙이지 않고 기본 시스템 프롬프트만 보낸다', async () => {
            mockBuildAnalysisPrompt.mockReturnValueOnce({
                stable: '',
                dynamic: 'mock-dynamic',
                overlayCandidates: [],
                overlayBuildFailures: [],
                patternScreenFailure: null,
                patternArbitration: { kept: [], dropped: [] },
                patternGeometries: new Map(),
            });

            await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ system: AI_SYSTEM_PROMPT })
            );
        });
    });

    describe('차트 오버레이 resolve (spec 2026-09-28)', () => {
        const overlayCandidate = {
            id: 'pattern:double_bottom:1705312200',
            kind: 'pattern' as const,
            skill: 'double_bottom',
            promptLine: 'p',
            segments: [
                {
                    from: { time: 1705312200, price: 100 },
                    to: { time: 1705312200, price: 105 },
                    role: 'pattern',
                    style: 'solid' as const,
                    pane: 'price' as const,
                },
            ],
            levels: [],
            labels: [],
        };

        it('patternSummaries[].candidateId가 offered 후보와 일치하면 chartOverlays에 1건 실린다', async () => {
            mockBuildAnalysisPrompt.mockReturnValueOnce({
                stable: 'mock-stable',
                dynamic: 'mock-dynamic',
                overlayCandidates: [overlayCandidate],
                overlayBuildFailures: [],
                patternScreenFailure: null,
                patternArbitration: { kept: [], dropped: [] },
                patternGeometries: new Map(),
            });
            const reconciledWithCandidate: AnalysisResponse = {
                ...mockRawResult,
                patternSummaries: [
                    {
                        id: 'pattern_0',
                        patternName: 'double_bottom',
                        skillName: 'Double Bottom',
                        detected: true,
                        trend: 'bullish',
                        summary: '패턴 요약',
                        confidenceWeight: 0.8,
                        candidateId: overlayCandidate.id,
                    },
                ],
            };
            mockEnrichAnalysisWithConfidence.mockReturnValueOnce(
                reconciledWithCandidate
            );
            mockPostProcessAnalysisWithReconcile.mockReturnValueOnce(
                reconciledWithCandidate
            );
            mockCallAnalysisAi.mockResolvedValueOnce(
                JSON.stringify(reconciledWithCandidate)
            );

            const result = await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(result.status).toBe('done');
            expect(
                result.status === 'done'
                    ? result.unfilteredResult.chartOverlays
                    : undefined
            ).toEqual([
                {
                    id: overlayCandidate.id,
                    kind: overlayCandidate.kind,
                    skill: overlayCandidate.skill,
                    segments: overlayCandidate.segments,
                    levels: overlayCandidate.levels,
                    labels: overlayCandidate.labels,
                    sourceRef: 'pattern_0',
                    variant: 'primary',
                },
            ]);
        });

        it('resolve된 패턴 카드는 목표가 계산(postProcess) 전에 그려지는 후보의 출력 geometry로 바뀐다', async () => {
            const printed = {
                breakoutLevel: 105,
                extremeLevel: 100,
                direction: 'up' as const,
                invalidationLevel: 99.5,
            };
            mockBuildAnalysisPrompt.mockReturnValueOnce({
                stable: 'mock-stable',
                dynamic: 'mock-dynamic',
                overlayCandidates: [overlayCandidate],
                overlayBuildFailures: [],
                patternScreenFailure: null,
                patternArbitration: { kept: [], dropped: [] },
                patternGeometries: new Map([[overlayCandidate.id, printed]]),
            });
            const enrichedWithMiscopy: AnalysisResponse = {
                ...mockRawResult,
                patternSummaries: [
                    {
                        id: 'pattern_0',
                        patternName: 'double_bottom',
                        skillName: 'Double Bottom',
                        detected: true,
                        trend: 'bullish',
                        summary: '패턴 요약',
                        confidenceWeight: 0.8,
                        candidateId: overlayCandidate.id,
                        // Model miscopied the breakout and invented the direction.
                        geometry: {
                            breakoutLevel: 95,
                            extremeLevel: 100,
                            direction: 'down',
                        },
                    },
                ],
            };
            mockEnrichAnalysisWithConfidence.mockReturnValueOnce(
                enrichedWithMiscopy
            );
            mockCallAnalysisAi.mockResolvedValueOnce(
                JSON.stringify(enrichedWithMiscopy)
            );

            await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            const postProcessed = mockPostProcessAnalysisWithReconcile.mock
                .lastCall![0] as AnalysisResponse;
            expect(postProcessed.patternSummaries[0]?.geometry).toEqual(
                printed
            );
        });

        it('offered 후보에 없는 id는 chartOverlays에서 빠지고 unknown id 경고를 남긴다', async () => {
            mockBuildAnalysisPrompt.mockReturnValueOnce({
                stable: 'mock-stable',
                dynamic: 'mock-dynamic',
                overlayCandidates: [overlayCandidate],
                overlayBuildFailures: [],
                patternScreenFailure: null,
                patternArbitration: { kept: [], dropped: [] },
                patternGeometries: new Map(),
            });
            const reconciledWithUnknownId: AnalysisResponse = {
                ...mockRawResult,
                patternSummaries: [
                    {
                        id: 'pattern_0',
                        patternName: 'double_bottom',
                        skillName: 'Double Bottom',
                        detected: true,
                        trend: 'bullish',
                        summary: '패턴 요약',
                        confidenceWeight: 0.8,
                        candidateId: 'pattern:made_up:0',
                    },
                ],
            };
            mockEnrichAnalysisWithConfidence.mockReturnValueOnce(
                reconciledWithUnknownId
            );
            mockPostProcessAnalysisWithReconcile.mockReturnValueOnce(
                reconciledWithUnknownId
            );
            mockCallAnalysisAi.mockResolvedValueOnce(
                JSON.stringify(reconciledWithUnknownId)
            );
            const warnSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => undefined);

            const result = await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(result.status).toBe('done');
            expect(
                result.status === 'done'
                    ? result.unfilteredResult.chartOverlays
                    : undefined
            ).toEqual([]);
            expect(warnSpy).toHaveBeenCalledWith(
                '[ChartOverlays] unknown candidate id',
                expect.objectContaining({
                    unknownIds: ['pattern:made_up:0'],
                })
            );
            // Offered 1, referenced 0 → the referral-rate anomaly fires too.
            expect(warnSpy).toHaveBeenCalledWith(
                '[ChartOverlays] no candidate referenced',
                expect.objectContaining({ offered: 1 })
            );
            warnSpy.mockRestore();
        });

        it('offered 후보를 받지 않는 슬롯이 인용한 id는 unknown 경고가 아니라 misplaced info 로그를 남긴다', async () => {
            mockBuildAnalysisPrompt.mockReturnValueOnce({
                stable: 'mock-stable',
                dynamic: 'mock-dynamic',
                overlayCandidates: [overlayCandidate],
                overlayBuildFailures: [],
                patternScreenFailure: null,
                patternArbitration: { kept: [], dropped: [] },
                patternGeometries: new Map(),
            });
            const citedByStrategy: AnalysisResponse = {
                ...mockRawResult,
                patternSummaries: [],
                strategyResults: [
                    {
                        id: 'mtf_0',
                        strategyName: 'multi-timeframe',
                        trend: 'neutral',
                        summary: '',
                        confidenceWeight: 1,
                        candidateIds: [overlayCandidate.id],
                    },
                ],
            };
            mockEnrichAnalysisWithConfidence.mockReturnValueOnce(
                citedByStrategy
            );
            mockPostProcessAnalysisWithReconcile.mockReturnValueOnce(
                citedByStrategy
            );
            mockCallAnalysisAi.mockResolvedValueOnce(
                JSON.stringify(citedByStrategy)
            );
            const warnSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => undefined);
            const infoSpy = vi
                .spyOn(console, 'info')
                .mockImplementation(() => undefined);

            await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(infoSpy).toHaveBeenCalledWith(
                '[ChartOverlays] candidate id cited from a slot that does not accept it',
                expect.objectContaining({
                    misplacedIds: [
                        { id: overlayCandidate.id, sourceRef: 'mtf_0' },
                    ],
                })
            );
            expect(warnSpy).not.toHaveBeenCalledWith(
                '[ChartOverlays] unknown candidate id',
                expect.anything()
            );
            warnSpy.mockRestore();
            infoSpy.mockRestore();
        });

        it('krxTickTable 옵션을 프롬프트와 후처리에 그대로 넘긴다', async () => {
            await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    currency: 'KRW',
                    krxTickTable: 'etp',
                }
            );

            expect(mockBuildAnalysisPrompt.mock.lastCall?.slice(-3)).toEqual([
                'KRW',
                'etp',
                undefined,
            ]);
            const postArgs =
                mockPostProcessAnalysisWithReconcile.mock.lastCall!;
            expect(postArgs[3]).toBe('KRW');
            expect(postArgs[5]).toBe('etp');
        });

        it('후보 빌더가 실패하면 candidate builder failed 경고에 kind를 남긴다', async () => {
            mockBuildAnalysisPrompt.mockReturnValueOnce({
                stable: 'mock-stable',
                dynamic: 'mock-dynamic',
                overlayCandidates: [],
                overlayBuildFailures: ['elliott'],
                patternScreenFailure: null,
                patternArbitration: { kept: [], dropped: [] },
                patternGeometries: new Map(),
            });
            const warnSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => undefined);

            await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(warnSpy).toHaveBeenCalledWith(
                '[ChartOverlays] candidate builder failed',
                expect.objectContaining({ kinds: ['elliott'] })
            );
            warnSpy.mockRestore();
        });

        describe('차트 패턴 선별이 던지면', () => {
            const failedScreen = {
                stable: 'mock-stable',
                dynamic: 'mock-dynamic',
                overlayCandidates: [],
                overlayBuildFailures: [],
                patternScreenFailure: 'Error: qualifier exploded',
                patternArbitration: { kept: [], dropped: [] },
                patternGeometries: new Map(),
            };

            it('pattern screening failed 경고에 symbol·timeframe·error를 남긴다', async () => {
                mockBuildAnalysisPrompt.mockReturnValueOnce(failedScreen);
                const warnSpy = vi
                    .spyOn(console, 'warn')
                    .mockImplementation(() => undefined);

                await runAnalysis(
                    mockSymbol,
                    mockCompanyName,
                    mockTimeframe,
                    false,
                    undefined,
                    { marketDataProvider: fakeProvider }
                );

                const calls = warnSpy.mock.calls.filter(
                    call =>
                        call[0] === '[ChartPatterns] pattern screening failed'
                );
                warnSpy.mockRestore();
                expect(calls).toEqual([
                    [
                        '[ChartPatterns] pattern screening failed',
                        {
                            symbol: mockSymbol,
                            timeframe: mockTimeframe,
                            error: 'Error: qualifier exploded',
                        },
                    ],
                ]);
            });

            it('모델 호출이 실패해도 그 전에 경고를 남긴다', async () => {
                mockBuildAnalysisPrompt.mockReturnValueOnce(failedScreen);
                mockCallAnalysisAi.mockRejectedValueOnce(new Error('ai down'));
                const warnSpy = vi
                    .spyOn(console, 'warn')
                    .mockImplementation(() => undefined);

                await expect(
                    runAnalysis(
                        mockSymbol,
                        mockCompanyName,
                        mockTimeframe,
                        false,
                        undefined,
                        { marketDataProvider: fakeProvider }
                    )
                ).rejects.toThrow('ai down');

                const messages = warnSpy.mock.calls.map(call => call[0]);
                warnSpy.mockRestore();
                expect(messages).toContain(
                    '[ChartPatterns] pattern screening failed'
                );
            });
        });

        describe('차트 패턴 겹침 중재가 패턴을 떨어뜨리면', () => {
            const dropped = {
                id: 'double_top' as const,
                startTime: 1_000,
                endTime: 2_000,
                lostTo: 'head_and_shoulders' as const,
            };

            it('arbitration dropped 로그에 symbol·timeframe·kept·dropped를 남긴다', async () => {
                mockBuildAnalysisPrompt.mockReturnValueOnce({
                    stable: 'mock-stable',
                    dynamic: 'mock-dynamic',
                    overlayCandidates: [],
                    overlayBuildFailures: [],
                    patternScreenFailure: null,
                    patternArbitration: {
                        kept: ['head_and_shoulders'],
                        dropped: [dropped],
                    },
                    patternGeometries: new Map(),
                });
                const infoSpy = vi
                    .spyOn(console, 'info')
                    .mockImplementation(() => undefined);

                await runAnalysis(
                    mockSymbol,
                    mockCompanyName,
                    mockTimeframe,
                    false,
                    undefined,
                    { marketDataProvider: fakeProvider }
                );

                const calls = infoSpy.mock.calls.filter(
                    call => call[0] === '[ChartPatterns] arbitration dropped'
                );
                infoSpy.mockRestore();
                expect(calls).toEqual([
                    [
                        '[ChartPatterns] arbitration dropped',
                        {
                            symbol: mockSymbol,
                            timeframe: mockTimeframe,
                            kept: ['head_and_shoulders'],
                            dropped: [dropped],
                        },
                    ],
                ]);
            });

            it('떨어뜨린 패턴이 없으면 남기지 않는다', async () => {
                const infoSpy = vi
                    .spyOn(console, 'info')
                    .mockImplementation(() => undefined);

                await runAnalysis(
                    mockSymbol,
                    mockCompanyName,
                    mockTimeframe,
                    false,
                    undefined,
                    { marketDataProvider: fakeProvider }
                );

                const messages = infoSpy.mock.calls.map(call => call[0]);
                infoSpy.mockRestore();
                expect(messages).not.toContain(
                    '[ChartPatterns] arbitration dropped'
                );
            });
        });

        it('차트 패턴 선별이 성공했으면 pattern screening failed 경고를 남기지 않는다', async () => {
            // Module-level mock returns `patternScreenFailure: null`.
            const warnSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => undefined);

            await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            const messages = warnSpy.mock.calls.map(call => call[0]);
            warnSpy.mockRestore();
            expect(messages).not.toContain(
                '[ChartPatterns] pattern screening failed'
            );
        });

        it('후보가 하나도 제시되지 않았으면 no candidate referenced 경고를 남기지 않는다', async () => {
            // Module-level mock returns `overlayCandidates: []`.
            const warnSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => undefined);

            await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            const messages = warnSpy.mock.calls.map(call => call[0]);
            expect(messages).not.toContain(
                '[ChartOverlays] no candidate referenced'
            );
            warnSpy.mockRestore();
        });
    });

    describe('runAnalysisForOverall (필터 미적용 내부 변형)', () => {
        it('캐시 히트 시 free 티어여도 필터되지 않은 원본(riskLevel 포함)을 result로 돌려준다', async () => {
            mockCacheGet.mockResolvedValueOnce(mockRawResult);

            const result = await runAnalysisForOverall(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { tierContext: { userId: null, tier: 'free' } }
            );

            expect(result.status).toBe('cached');
            if (result.status !== 'cached') return;
            expect(result.result.riskLevel).toBe('low');
            expect(result.result.keyLevels).toEqual(mockRawResult.keyLevels);
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });

        it('options를 생략해도 기본 티어로 캐시를 조회해 원본을 반환한다', async () => {
            mockCacheGet.mockResolvedValueOnce(mockRawResult);

            const result = await runAnalysisForOverall(
                mockSymbol,
                mockCompanyName,
                mockTimeframe
            );

            expect(result.status).toBe('cached');
            expect(mockCacheGet).toHaveBeenCalledTimes(1);
        });

        it('캐시 미스 시 free 티어여도 필터 없는 원본을 result로 반환하고 unfilteredResult는 없다', async () => {
            const result = await runAnalysisForOverall(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    tierContext: { userId: null, tier: 'free' },
                }
            );

            expect(result.status).toBe('done');
            if (result.status !== 'done') return;
            expect(result.result.riskLevel).toBe('low');
            expect(result.result.analyzedAt).toEqual(expect.any(String));
            expect('unfilteredResult' in result).toBe(false);
            // Exact key + peek pointer key — one fire-and-forget write each.
            expect(mockCacheSet).toHaveBeenCalledTimes(2);
        });
    });

    describe('최신 생성물 재사용 (reuseLatestGeneration — overall 전용)', () => {
        const peekKey = buildAnalysisPeekCacheKey(
            mockSymbol,
            mockTimeframe,
            DEFAULT_ANALYSIS_MODEL_ID,
            DEFAULT_TIER,
            undefined,
            undefined,
            undefined
        );
        const peekedResult: AnalysisResponse = {
            ...mockRawResult,
            summary: '몇 분 전에 생성된 기술적 분석',
            analyzedAt: '2026-10-04T00:00:00.000Z',
        };

        /** Exact key misses; only the peek pointer holds a value. */
        function seedPeekOnly(value: unknown): void {
            mockCacheGet.mockImplementation(async (key: string) =>
                key === peekKey ? value : null
            );
        }

        /** Keys passed to `cache.get`, split into peek-pointer vs exact reads. */
        function readKeys(): { peek: string[]; exact: string[] } {
            const keys = mockCacheGet.mock.calls.map(call => call[0] as string);
            return {
                peek: keys.filter(key => key.startsWith('analysis:peek:')),
                exact: keys.filter(key => !key.startsWith('analysis:peek:')),
            };
        }

        const overallCall = (
            force: boolean,
            extra: Record<string, unknown> = {}
        ) =>
            runAnalysisForOverall(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                force,
                undefined,
                { marketDataProvider: fakeProvider, ...extra }
            );

        it('정확 키 미스 + peek 히트 → LLM·봉 조회·캐시 쓰기 없이 peek 값을 cached로 돌려준다', async () => {
            seedPeekOnly(peekedResult);

            const result = await overallCall(false);

            expect(result.status).toBe('cached');
            if (result.status !== 'cached') return;
            expect(result.result.summary).toBe('몇 분 전에 생성된 기술적 분석');
            expect(result.result.analyzedAt).toBe('2026-10-04T00:00:00.000Z');
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
            expect(mockFetchBarsWithIndicators).not.toHaveBeenCalled();
            expect(mockCacheSet).not.toHaveBeenCalled();
            const keys = readKeys();
            expect(keys.exact).toHaveLength(1);
            expect(keys.peek).toEqual([peekKey]);
        });

        it('peek 히트도 정확 키 히트처럼 사용량을 한 번 기록한다', async () => {
            seedPeekOnly(peekedResult);
            const usageRepository = {
                recordUsage: vi
                    .fn<UsageRepository['recordUsage']>()
                    .mockResolvedValue(
                        {} as Awaited<
                            ReturnType<UsageRepository['recordUsage']>
                        >
                    ),
                getUsageToday: vi
                    .fn<UsageRepository['getUsageToday']>()
                    .mockResolvedValue({ analysis: 0, chatbot: 0 }),
            };

            const result = await overallCall(false, {
                usage: {
                    usageRepository,
                    clientIp: '203.0.113.10',
                    userId: 'u1',
                    occurredAt: new Date(),
                },
            });

            expect(result.status).toBe('cached');
            expect(usageRepository.recordUsage).toHaveBeenCalledTimes(1);
        });

        it('peek 미스 → 기존대로 생성하고 정확 키·peek 키를 모두 쓴다', async () => {
            const result = await overallCall(false);

            expect(result.status).toBe('done');
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(readKeys().peek).toEqual([peekKey]);
            expect(mockCacheSet).toHaveBeenCalledTimes(2);
        });

        it('force → 정확 키도 peek 키도 읽지 않고 생성한다', async () => {
            seedPeekOnly(peekedResult);

            const result = await overallCall(true);

            expect(result.status).toBe('done');
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(mockCacheGet).not.toHaveBeenCalled();
        });

        it('skipEnqueueIfMiss + peek 히트 → miss_no_trigger가 아니라 cached', async () => {
            seedPeekOnly(peekedResult);

            const result = await overallCall(false, {
                skipEnqueueIfMiss: true,
            });

            expect(result.status).toBe('cached');
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });

        it('skipEnqueueIfMiss + peek 미스 → miss_no_trigger', async () => {
            const result = await overallCall(false, {
                skipEnqueueIfMiss: true,
            });

            expect(result).toEqual({ status: 'miss_no_trigger' });
            expect(readKeys().peek).toEqual([peekKey]);
        });

        it('peek 읽기가 실패하면 미스로 보고 로그를 남긴 뒤 생성한다', async () => {
            const errorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => undefined);
            mockCacheGet.mockImplementation(async (key: string) => {
                if (key === peekKey) throw new Error('redis peek read failed');
                return null;
            });

            const result = await overallCall(false);

            expect(result.status).toBe('done');
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(errorSpy).toHaveBeenCalledWith(
                '[RunAnalysis] Peek cache read failed:',
                expect.objectContaining({ message: 'redis peek read failed' })
            );
            errorSpy.mockRestore();
        });

        it('peek 키는 reasoning·locale 접미사까지 맞는 항목만 히트한다', async () => {
            const variantPeekKey = buildAnalysisPeekCacheKey(
                mockSymbol,
                mockTimeframe,
                DEFAULT_ANALYSIS_MODEL_ID,
                DEFAULT_TIER,
                true,
                undefined,
                'en'
            );
            expect(variantPeekKey).not.toBe(peekKey);
            mockCacheGet.mockImplementation(async (key: string) =>
                key === variantPeekKey ? peekedResult : null
            );

            const hit = await overallCall(false, {
                reasoning: true,
                locale: 'en',
            });
            const miss = await overallCall(false);

            expect(hit.status).toBe('cached');
            expect(miss.status).toBe('done');
        });

        it('peek 키는 tier·보유 구간까지 맞는 항목만 히트한다', async () => {
            const memberPeekKey = buildAnalysisPeekCacheKey(
                mockSymbol,
                mockTimeframe,
                DEFAULT_ANALYSIS_MODEL_ID,
                'member',
                undefined,
                'profit',
                undefined
            );
            expect(memberPeekKey).not.toBe(peekKey);
            mockCacheGet.mockImplementation(async (key: string) =>
                key === memberPeekKey ? peekedResult : null
            );

            const hit = await overallCall(false, {
                tierContext: { userId: null, tier: 'member' },
                positionBucket: 'profit',
            });
            const sameTierNoPosition = await overallCall(false, {
                tierContext: { userId: null, tier: 'member' },
            });
            const defaultTierSamePosition = await overallCall(false, {
                positionBucket: 'profit',
            });

            expect(hit.status).toBe('cached');
            expect(sameTierNoPosition.status).toBe('done');
            expect(defaultTierSamePosition.status).toBe('done');
        });

        it('스킬 로드가 degraded였던 peek 항목은 재사용하지 않고 생성한다', async () => {
            seedPeekOnly({ ...peekedResult, skillsDegraded: true });

            const result = await overallCall(false);

            expect(result.status).toBe('done');
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
        });

        it('정규화 후 내용이 빈 peek 항목(오염된 페이로드)은 미스로 보고 생성한다', async () => {
            seedPeekOnly({ summary: '' });

            const result = await overallCall(false);

            expect(result.status).toBe('done');
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
        });

        it('공개 runAnalysis는 peek 키를 읽지 않는다 — 정확 키만 읽고 생성한다', async () => {
            seedPeekOnly(peekedResult);

            const result = await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(result.status).toBe('done');
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            const keys = readKeys();
            expect(keys.peek).toEqual([]);
            expect(keys.exact).toHaveLength(1);
        });

        it('공개 runAnalysis + skipEnqueueIfMiss는 peek 값이 있어도 miss_no_trigger', async () => {
            seedPeekOnly(peekedResult);

            const result = await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider, skipEnqueueIfMiss: true }
            );

            expect(result).toEqual({ status: 'miss_no_trigger' });
            expect(readKeys().peek).toEqual([]);
        });
    });
});
