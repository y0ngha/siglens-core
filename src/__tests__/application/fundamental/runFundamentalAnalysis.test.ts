import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import type { Skill, TierConfig, TierModel } from '@/domain/types';
import { TEST_TIER_CONFIG } from '@/__tests__/helpers/testTierConfig';

vi.mock('@/application/analysis/callAnalysisAi');
vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/skills/loader');
vi.mock('@/domain/analysis/fundamentalPrompt', () => ({
    buildFundamentalAnalysisPrompt: vi.fn(() => ({
        stable: 'mock-stable',
        dynamic: 'mock-dynamic',
    })),
}));

import { runFundamentalAnalysis } from '@/application/fundamental/runFundamentalAnalysis';
import { buildFundamentalAnalysisPrompt } from '@/domain/analysis/fundamentalPrompt';
import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { DEEPSEEK_V4_1_FLASH_MODEL } from '@/application/chat/constants';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { FUNDAMENTAL_CACHE_TTL_SECONDS } from '@/infrastructure/cache/config';
import { loadSkillsCached } from '@/infrastructure/skills/loader';
import { FUNDAMENTAL_SYSTEM_PROMPT } from '@/domain/analysis/systemPrompt';
import { analysisSeed } from '@/infrastructure/hash/analysisInput';
import type { FundamentalDataProvider } from '@/domain/ports/fundamentalDataProvider';

const mockBuildFundamentalAnalysisPrompt =
    buildFundamentalAnalysisPrompt as Mock;
const mockCallAnalysisAi = callAnalysisAi as Mock;
const mockCreateCacheProvider = createCacheProvider as Mock;
const mockLoadSkillsCached = loadSkillsCached as Mock;

const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheProvider = {
    get: mockCacheGet,
    set: mockCacheSet,
    delete: vi.fn(),
};

const mockSymbol = 'AAPL';
const mockModelId = 'gemini-3.6-flash';

const mockRawResult = {
    overallConclusionKo: '테스트 분석입니다.',
    categoryAssessments: [
        { category: 'profitability', sentiment: 'positive', summaryKo: '양호' },
    ],
    riskFactorsKo: [],
    overallSentiment: 'positive' as const,
};

const validProfile = {
    symbol: mockSymbol,
    companyName: 'Apple Inc.',
    sector: 'Technology',
    industry: 'Consumer Electronics',
    marketCap: 3_000_000_000_000,
    ceo: 'Tim Cook',
    website: 'https://www.apple.com',
    description: null,
};

const mockDataProvider: FundamentalDataProvider = {
    getProfile: vi.fn().mockResolvedValue(validProfile),
    getKeyMetricsTtm: vi.fn().mockResolvedValue(null),
    getRatiosTtm: vi.fn().mockResolvedValue(null),
    getCashFlowStatement: vi.fn().mockResolvedValue(null),
    getIncomeStatementGrowth: vi.fn().mockResolvedValue(null),
    getFinancialScores: vi.fn().mockResolvedValue(null),
    getStockPeers: vi.fn().mockResolvedValue([]),
    getAnalystEstimates: vi.fn().mockResolvedValue(null),
    getGradesConsensus: vi.fn().mockResolvedValue(null),
    getPriceTargetConsensus: vi.fn().mockResolvedValue(null),
    getPriceTargetSummary: vi.fn().mockResolvedValue(null),
    getEarningsReport: vi.fn().mockResolvedValue(null),
    getSectorPerformanceSnapshot: vi.fn().mockResolvedValue([]),
    getHistoricalSectorPerformance: vi.fn().mockResolvedValue([]),
};

describe('runFundamentalAnalysis', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockLoadSkillsCached.mockResolvedValue({
            skills: [] as Skill[],
            skillsDegraded: false,
        });
        mockCacheGet.mockResolvedValue(null);
        mockCacheSet.mockResolvedValue(undefined);
        mockCallAnalysisAi.mockResolvedValue(JSON.stringify(mockRawResult));

        // Reset all provider methods
        (mockDataProvider.getProfile as Mock).mockResolvedValue(validProfile);
        (mockDataProvider.getKeyMetricsTtm as Mock).mockResolvedValue(null);
        (mockDataProvider.getRatiosTtm as Mock).mockResolvedValue(null);
        (mockDataProvider.getCashFlowStatement as Mock).mockResolvedValue(null);
        (mockDataProvider.getIncomeStatementGrowth as Mock).mockResolvedValue(
            null
        );
        (mockDataProvider.getFinancialScores as Mock).mockResolvedValue(null);
        (mockDataProvider.getStockPeers as Mock).mockResolvedValue([]);
        (mockDataProvider.getAnalystEstimates as Mock).mockResolvedValue(null);
        (mockDataProvider.getGradesConsensus as Mock).mockResolvedValue(null);
        (mockDataProvider.getPriceTargetConsensus as Mock).mockResolvedValue(
            null
        );
        (mockDataProvider.getPriceTargetSummary as Mock).mockResolvedValue(
            null
        );
        (mockDataProvider.getEarningsReport as Mock).mockResolvedValue(null);
        (
            mockDataProvider.getSectorPerformanceSnapshot as Mock
        ).mockResolvedValue([]);
        (
            mockDataProvider.getHistoricalSectorPerformance as Mock
        ).mockResolvedValue([]);
    });

    describe('cache hit', () => {
        it('cache hit → callAnalysisAi NOT called, returns {status:"cached"}', async () => {
            mockCacheGet.mockResolvedValueOnce(mockRawResult);

            const result = await runFundamentalAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
            });

            expect(result.status).toBe('cached');
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
            // Provider must not be called on a cache hit
            expect(mockDataProvider.getProfile).not.toHaveBeenCalled();
        });

        it('empty overallConclusionKo in cache → falls through to LLM, returns {status:"done"}', async () => {
            mockCacheGet.mockResolvedValueOnce({
                overallConclusionKo: '',
                categoryAssessments: [],
                riskFactorsKo: [],
                overallSentiment: 'neutral',
            });

            const result = await runFundamentalAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
            });

            expect(result.status).toBe('done');
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
        });
    });

    describe('cache miss → LLM call', () => {
        it('cache miss → callAnalysisAi called once, returns {status:"done"}', async () => {
            const result = await runFundamentalAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
            });

            expect(result.status).toBe('done');
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
        });

        it('callAnalysisAi receives prompt, system, seed, and correlationId', async () => {
            await runFundamentalAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
            });

            const expectedSystem = `${FUNDAMENTAL_SYSTEM_PROMPT}\n\nmock-stable`;
            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({
                    prompt: 'mock-dynamic',
                    system: expectedSystem,
                    seed: analysisSeed(`${expectedSystem}\n\nmock-dynamic`),
                    correlationId: `${mockSymbol}:fundamental`,
                })
            );
        });

        it('signal is forwarded to callAnalysisAi', async () => {
            const signal = AbortSignal.timeout(5_000);

            await runFundamentalAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
                signal,
            });

            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ signal })
            );
        });

        it('providerFallback is forwarded to callAnalysisAi as fallbackOnProviderFailure', async () => {
            await runFundamentalAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
                providerFallback: true,
            });

            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ fallbackOnProviderFailure: true })
            );
        });
    });

    describe('currentPrice wiring (fix — was never populated)', () => {
        it('threads a valid options.currentPrice onto the snapshot passed to buildFundamentalAnalysisPrompt', async () => {
            await runFundamentalAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
                currentPrice: 190.5,
            });

            const snapshotArg =
                mockBuildFundamentalAnalysisPrompt.mock.calls.find(
                    call => call[0] === mockSymbol
                )?.[1];
            expect(snapshotArg?.currentPrice).toBe(190.5);
        });

        it('omits currentPrice from the snapshot when options.currentPrice is not supplied', async () => {
            await runFundamentalAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
            });

            const snapshotArg =
                mockBuildFundamentalAnalysisPrompt.mock.calls.find(
                    call => call[0] === mockSymbol
                )?.[1];
            expect(snapshotArg?.currentPrice).toBeUndefined();
        });

        it.each([
            ['zero', 0],
            ['negative', -50],
            ['NaN', Number.NaN],
            ['null', null],
        ])(
            'treats an invalid currentPrice (%s) as absent, not as a real price',
            async (_label, badPrice) => {
                await runFundamentalAnalysis({
                    symbol: mockSymbol,
                    modelId: mockModelId,
                    dataProvider: mockDataProvider,
                    currentPrice: badPrice,
                });

                const snapshotArg =
                    mockBuildFundamentalAnalysisPrompt.mock.calls.find(
                        call => call[0] === mockSymbol
                    )?.[1];
                expect(snapshotArg?.currentPrice).toBeUndefined();
            }
        );

        it('does not affect the cache key', async () => {
            await runFundamentalAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
                currentPrice: 190.5,
            });
            const withPriceKey = mockCacheSet.mock.calls[0]?.[0];

            vi.clearAllMocks();
            mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
            mockLoadSkillsCached.mockResolvedValue({
                skills: [] as Skill[],
                skillsDegraded: false,
            });
            mockCacheGet.mockResolvedValue(null);
            mockCacheSet.mockResolvedValue(undefined);
            mockCallAnalysisAi.mockResolvedValue(JSON.stringify(mockRawResult));
            (mockDataProvider.getProfile as Mock).mockResolvedValue(
                validProfile
            );
            await runFundamentalAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
            });
            const withoutPriceKey = mockCacheSet.mock.calls[0]?.[0];

            expect(withPriceKey).toBe(withoutPriceKey);
        });
    });

    describe('currentPrice as a lazy getter', () => {
        it('calls the getter and threads its resolved value onto the snapshot on a cache MISS', async () => {
            mockCacheGet.mockResolvedValue(null);
            const getter = vi.fn().mockResolvedValue(190.5);

            await runFundamentalAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
                currentPrice: getter,
            });

            expect(getter).toHaveBeenCalledTimes(1);
            const snapshotArg =
                mockBuildFundamentalAnalysisPrompt.mock.calls.find(
                    call => call[0] === mockSymbol
                )?.[1];
            expect(snapshotArg?.currentPrice).toBe(190.5);
        });

        it('never calls the getter on a cache HIT — the whole point of C3', async () => {
            mockCacheGet.mockResolvedValueOnce(mockRawResult);
            const getter = vi.fn().mockResolvedValue(190.5);

            const result = await runFundamentalAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
                currentPrice: getter,
            });

            expect(result.status).toBe('cached');
            expect(getter).not.toHaveBeenCalled();
        });

        it('a getter that REJECTS (quote outage) degrades to no price — the analysis still completes', async () => {
            mockCacheGet.mockResolvedValue(null);
            const getter = vi.fn().mockRejectedValue(new Error('quote down'));
            const errorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});

            const result = await runFundamentalAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
                currentPrice: getter,
            });

            expect(result.status).not.toBe('error');
            const snapshotArg =
                mockBuildFundamentalAnalysisPrompt.mock.calls.find(
                    call => call[0] === mockSymbol
                )?.[1];
            expect(snapshotArg).toBeDefined();
            expect(snapshotArg?.currentPrice).toBeUndefined();
            errorSpy.mockRestore();
        });

        it('treats a getter that resolves to an invalid price as absent, same as a plain number', async () => {
            mockCacheGet.mockResolvedValue(null);
            const getter = vi.fn().mockResolvedValue(null);

            await runFundamentalAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
                currentPrice: getter,
            });

            const snapshotArg =
                mockBuildFundamentalAnalysisPrompt.mock.calls.find(
                    call => call[0] === mockSymbol
                )?.[1];
            expect(snapshotArg?.currentPrice).toBeUndefined();
        });
    });

    describe('cache write', () => {
        it('result is written to cache with FUNDAMENTAL_CACHE_TTL_SECONDS', async () => {
            await runFundamentalAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
            });

            expect(mockCacheSet).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    overallConclusionKo: mockRawResult.overallConclusionKo,
                }),
                FUNDAMENTAL_CACHE_TTL_SECONDS
            );
        });

        it('empty conclusion → warn emitted but cache still written', async () => {
            const emptyResult = {
                overallConclusionKo: '',
                categoryAssessments: [],
                riskFactorsKo: [],
                overallSentiment: 'neutral' as const,
            };
            mockCallAnalysisAi.mockResolvedValueOnce(
                JSON.stringify(emptyResult)
            );
            const warnSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => undefined);

            const result = await runFundamentalAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
            });

            expect(result.status).toBe('done');
            // Cache write still happens even for empty analysis
            expect(mockCacheSet).toHaveBeenCalled();
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('Empty fundamental analysis'),
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

            const p1 = runFundamentalAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
            });
            const p2 = runFundamentalAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
            });

            resolveAi(JSON.stringify(mockRawResult));

            const [r1, r2] = await Promise.all([p1, p2]);

            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(r1.status).toBe('done');
            expect(r2.status).toBe('done');
        });
    });

    describe('BYOK gate', () => {
        it('non-pro premium model without userApiKey → returns key_error', async () => {
            const result = await runFundamentalAnalysis({
                symbol: mockSymbol,
                modelId: 'gemini-3.1-pro-preview',
                dataProvider: mockDataProvider,
                tier: 'member',
                tierConfig: TEST_TIER_CONFIG,
            });

            expect(result.status).toBe('key_error');
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });

        it('non-pro premium model with userApiKey → proceeds', async () => {
            const result = await runFundamentalAnalysis({
                symbol: mockSymbol,
                modelId: 'gemini-3.1-pro-preview',
                dataProvider: mockDataProvider,
                tier: 'member',
                tierConfig: TEST_TIER_CONFIG,
                userApiKey: 'usr-key',
            });

            expect(result.status).toBe('done');
            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ userApiKey: 'usr-key' })
            );
        });
    });

    describe('skipEnqueueIfMiss (bot path)', () => {
        it('cache miss + skipEnqueueIfMiss → returns {status:"miss_no_trigger"}, LLM not called', async () => {
            const result = await runFundamentalAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
                skipEnqueueIfMiss: true,
            });

            expect(result).toEqual({ status: 'miss_no_trigger' });
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });
    });

    describe('provider fetch error', () => {
        it('getProfile returns null → returns {status:"error", code:"fetch_failed"}', async () => {
            (mockDataProvider.getProfile as Mock).mockResolvedValueOnce(null);

            const result = await runFundamentalAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
            });

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.code).toBe('fetch_failed');
            }
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });

        it('provider throws → returns {status:"error", code:"fetch_failed"}', async () => {
            (mockDataProvider.getProfile as Mock).mockRejectedValueOnce(
                new Error('FMP error')
            );

            const result = await runFundamentalAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
            });

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.code).toBe('fetch_failed');
            }
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });
    });

    describe('usage recording', () => {
        it('usage recorded AFTER LLM returns, not before', async () => {
            const callOrder: string[] = [];

            mockCallAnalysisAi.mockImplementationOnce(async () => {
                callOrder.push('llm');
                return JSON.stringify(mockRawResult);
            });

            const recordUsage = vi.fn().mockImplementationOnce(async () => {
                callOrder.push('record');
            });

            await runFundamentalAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
                tier: 'free',
                usage: {
                    usageRepository: {
                        recordUsage,
                        getUsageToday: vi
                            .fn()
                            .mockResolvedValue({ analysis: 0, chatbot: 0 }),
                    },
                    clientIp: '10.0.0.1',
                },
            });

            // LLM must complete before usage is recorded
            expect(callOrder).toEqual(['llm', 'record']);
        });
    });

    /**
     * 로케일 분기는 세 곳을 동시에 건드린다 — 시스템 프롬프트 선택, 프롬프트
     * 말미 리마인더, 캐시 키. **기본 로케일은 셋 다 예전과 바이트가 같아야**
     * 이미 쌓인 한국어 캐시가 살아 있다.
     */
    describe('출력 로케일', () => {
        const sentOf = () => {
            const call = mockCallAnalysisAi.mock.calls.at(-1)![0] as {
                system: string;
                prompt: string;
            };
            return { system: call.system, prompt: call.prompt };
        };

        it('로케일을 생략하면 ko와 같은 system·prompt를 보낸다', async () => {
            await runFundamentalAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
            });
            const omitted = sentOf();
            mockCallAnalysisAi.mockClear();
            await runFundamentalAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
                locale: 'ko',
            });
            expect(sentOf()).toEqual(omitted);
        });

        it.each(['en', 'ja', 'zh'] as const)(
            '%s: 프롬프트 말미에 출력 언어 리마인더가 붙는다',
            async locale => {
                await runFundamentalAnalysis({
                    symbol: mockSymbol,
                    modelId: mockModelId,
                    dataProvider: mockDataProvider,
                    locale,
                });
                expect(sentOf().prompt).toContain(
                    'OUTPUT LANGUAGE (FINAL, OVERRIDES EVERYTHING ABOVE)'
                );
            }
        );
    });

    describe('섹터 방향성 enrichment', () => {
        const snapshotArg = () =>
            mockBuildFundamentalAnalysisPrompt.mock.calls.find(
                call => call[0] === mockSymbol
            )?.[1];

        it('프로필 섹터의 당일 등락률과 과거 추이를 snapshot에 매핑하고 섹터 스냅샷은 now 날짜로 조회한다', async () => {
            (
                mockDataProvider.getSectorPerformanceSnapshot as Mock
            ).mockResolvedValue([
                { sector: 'Energy', changesPercentage: -2.1 },
                { sector: 'Technology', changesPercentage: 1.25 },
            ]);
            (
                mockDataProvider.getHistoricalSectorPerformance as Mock
            ).mockResolvedValue([
                {
                    date: '2026-05-01',
                    sector: 'Technology',
                    changesPercentage: 0.8,
                },
                {
                    date: '2026-04-30',
                    sector: 'Technology',
                    changesPercentage: -0.3,
                },
            ]);

            await runFundamentalAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
                now: new Date('2026-05-02T15:00:00Z'),
            });

            expect(
                mockDataProvider.getSectorPerformanceSnapshot
            ).toHaveBeenCalledWith('2026-05-02');
            expect(
                mockDataProvider.getHistoricalSectorPerformance
            ).toHaveBeenCalledWith('Technology');
            expect(snapshotArg()?.sectorDirection).toEqual({
                todayChangePct: 1.25,
                historical: [
                    { date: '2026-05-01', changePct: 0.8 },
                    { date: '2026-04-30', changePct: -0.3 },
                ],
            });
        });

        it('섹터 스냅샷에 해당 섹터가 없으면 당일 등락률은 null이다', async () => {
            (
                mockDataProvider.getSectorPerformanceSnapshot as Mock
            ).mockResolvedValue([
                { sector: 'Energy', changesPercentage: -2.1 },
            ]);

            await runFundamentalAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
            });

            expect(snapshotArg()?.sectorDirection.todayChangePct).toBeNull();
        });

        it('프로필에 섹터가 없으면 과거 섹터 추이를 조회하지 않고 빈 배열로 둔다', async () => {
            (mockDataProvider.getProfile as Mock).mockResolvedValue({
                ...validProfile,
                sector: null,
            });

            const result = await runFundamentalAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
            });

            expect(result.status).toBe('done');
            expect(
                mockDataProvider.getHistoricalSectorPerformance
            ).not.toHaveBeenCalled();
            expect(snapshotArg()?.sectorDirection.historical).toEqual([]);
        });
    });

    describe('일일 사용량 한도', () => {
        const LIMITED_TIER_CONFIG: TierConfig = {
            ...TEST_TIER_CONFIG,
            limits: {
                ...TEST_TIER_CONFIG.limits,
                analysisPerDay: { free: 1, member: 1, pro: Infinity },
            },
            featureFlags: { enableTierRestrictions: true },
        };

        function makeUsage(analysisCountToday: number) {
            return {
                usageRepository: {
                    getUsageToday: vi.fn().mockResolvedValue({
                        analysis: analysisCountToday,
                        chatbot: 0,
                    }),
                    recordUsage: vi.fn().mockResolvedValue(undefined),
                },
                clientIp: '10.0.0.1',
            };
        }

        it('한도를 초과하면 usage_limit_exceeded를 반환하고 provider·LLM·사용량 기록을 모두 건너뛴다', async () => {
            const usage = makeUsage(1);

            const result = await runFundamentalAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
                tier: 'free',
                tierConfig: LIMITED_TIER_CONFIG,
                usage,
            });

            expect(result).toEqual({
                status: 'error',
                code: 'usage_limit_exceeded',
                error: expect.objectContaining({
                    code: 'analysis_limit_exceeded',
                    feature: 'analysisPerDay',
                    tier: 'free',
                }),
            });
            expect(mockLoadSkillsCached).not.toHaveBeenCalled();
            expect(mockDataProvider.getProfile).not.toHaveBeenCalled();
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
            expect(usage.usageRepository.recordUsage).not.toHaveBeenCalled();
        });

        it('캐시 히트도 사용량 1회로 기록한다', async () => {
            mockCacheGet.mockResolvedValueOnce(mockRawResult);
            const usage = makeUsage(0);
            const now = new Date('2026-05-02T03:00:00Z');

            const result = await runFundamentalAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
                tier: 'free',
                tierConfig: LIMITED_TIER_CONFIG,
                usage,
                now,
            });

            expect(result.status).toBe('cached');
            expect(usage.usageRepository.recordUsage).toHaveBeenCalledWith({
                userId: null,
                ipAddress: '10.0.0.1',
                actionType: 'analysis',
                modelUsed: mockModelId,
                occurredAt: now,
            });
        });
    });

    describe('캐시 우회·장애 내성', () => {
        it('force=true이면 캐시를 읽지 않고 provider·LLM을 태운다', async () => {
            mockCacheGet.mockResolvedValue(mockRawResult);

            const result = await runFundamentalAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
                force: true,
            });

            expect(result.status).toBe('done');
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockDataProvider.getProfile).toHaveBeenCalledTimes(1);
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
        });

        it('캐시 프로바이더가 없으면(null) 캐시 없이 LLM 결과를 반환한다', async () => {
            mockCreateCacheProvider.mockReturnValue(null);

            const result = await runFundamentalAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
            });

            expect(result.status).toBe('done');
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockCacheSet).not.toHaveBeenCalled();
        });

        it('캐시 읽기가 실패하면 로그를 남기고 provider·LLM 경로로 진행한다', async () => {
            const errorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            mockCacheGet.mockRejectedValueOnce(new Error('redis down'));

            const result = await runFundamentalAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
            });

            expect(result.status).toBe('done');
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(errorSpy).toHaveBeenCalledWith(
                '[RunFundamental] Cache read failed:',
                expect.any(Error)
            );
            errorSpy.mockRestore();
        });

        it('캐시 쓰기가 실패해도 응답은 done이고 오류는 로그로만 남는다', async () => {
            const errorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            mockCacheSet.mockRejectedValueOnce(new Error('redis write down'));

            const result = await runFundamentalAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
            });

            expect(result.status).toBe('done');
            await vi.waitFor(() =>
                expect(errorSpy).toHaveBeenCalledWith(
                    '[RunFundamental] Cache write failed:',
                    expect.any(Error)
                )
            );
            errorSpy.mockRestore();
        });
    });

    describe('모델 해석', () => {
        it('tierConfig에는 있지만 MODEL_SPECS에 없는 폐기 모델은 DeepSeek 기본 모델로 호출한다', async () => {
            // BYOK 게이트는 tierConfig 목록에 없는 모델에서 throw하므로, 폐기
            // 모델이 이 폴백까지 오려면 호출자 tierConfig에 남아 있어야 한다.
            const legacyModel = 'gemini-2.5-flash' as unknown as TierModel;
            const legacyTierConfig: TierConfig = {
                ...TEST_TIER_CONFIG,
                models: {
                    ...TEST_TIER_CONFIG.models,
                    free: [...TEST_TIER_CONFIG.models.free, legacyModel],
                },
            };

            const result = await runFundamentalAnalysis({
                symbol: mockSymbol,
                modelId: legacyModel,
                dataProvider: mockDataProvider,
                tierConfig: legacyTierConfig,
            });

            expect(result.status).toBe('done');
            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ model: DEEPSEEK_V4_1_FLASH_MODEL })
            );
        });
    });
});
