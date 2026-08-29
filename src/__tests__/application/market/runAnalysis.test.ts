import type { AnalysisLocale } from '@/domain/analysis/outputLocale';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { DEEPSEEK_V4_FLASH_MODEL } from '@/application/chat/constants';
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

import { runAnalysis } from '@/application/market/runAnalysis';
import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { computeEffectiveTtl } from '@/infrastructure/cache/config';
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
void buildAnalysisPrompt; // imported for the vi.mock side-effect; not directly asserted
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
        free: ['gemini-2.5-flash'],
        member: ['gemini-2.5-flash'],
        pro: ['gemini-2.5-flash'],
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
                    model: DEEPSEEK_V4_FLASH_MODEL,
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
