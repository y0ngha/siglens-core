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
    })),
}));
vi.mock('@/domain/indicators/fearGreed', () => ({
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
            // claude-haiku-4-5 is in FREE_MODELS so no BYOK gate fires.
            await runAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    modelId: 'claude-haiku-4-5',
                }
            );

            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ model: 'claude-haiku-4-5' })
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

        it('offered 후보에 없는 id는 chartOverlays에서 빠지고 unknown id 경고를 남긴다', async () => {
            mockBuildAnalysisPrompt.mockReturnValueOnce({
                stable: 'mock-stable',
                dynamic: 'mock-dynamic',
                overlayCandidates: [overlayCandidate],
                overlayBuildFailures: [],
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

        it('후보 빌더가 실패하면 candidate builder failed 경고에 kind를 남긴다', async () => {
            mockBuildAnalysisPrompt.mockReturnValueOnce({
                stable: 'mock-stable',
                dynamic: 'mock-dynamic',
                overlayCandidates: [],
                overlayBuildFailures: ['elliott'],
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
});
