import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import type { Skill } from '@/domain/types';
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
import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { FUNDAMENTAL_CACHE_TTL_SECONDS } from '@/infrastructure/cache/config';
import { loadSkillsCached } from '@/infrastructure/skills/loader';
import { FUNDAMENTAL_SYSTEM_PROMPT } from '@/domain/analysis/systemPrompt';
import { analysisSeed } from '@/infrastructure/hash/analysisInput';
import type { FundamentalDataProvider } from '@/domain/ports/fundamentalDataProvider';

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
const mockModelId = 'gemini-2.5-flash';

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
                modelId: 'gemini-2.5-pro',
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
                modelId: 'gemini-2.5-pro',
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
});
