import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import type { Skill, TierModel } from '@/domain/types';

vi.mock('@/application/analysis/callAnalysisAi');
vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/skills/loader');
vi.mock('@/domain/analysis/financialsPrompt', () => ({
    buildFinancialsAnalysisPrompt: vi.fn(() => ({
        stable: 'mock-stable',
        dynamic: 'mock-dynamic',
    })),
}));

import { runFinancialsAnalysis } from '@/application/financials/runFinancialsAnalysis';
import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { FINANCIALS_CACHE_TTL_SECONDS } from '@/infrastructure/cache/config';
import { loadSkillsCached } from '@/infrastructure/skills/loader';

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
const mockModelId: TierModel = 'gemini-2.5-flash';

const mockRawResult = {
    overallConclusionKo: '재무 상태 양호.',
    axisAssessments: [],
    riskFactorsKo: [],
    overallSentiment: 'positive' as const,
};

const mockDataProvider = {
    getIncomeStatements: vi.fn().mockResolvedValue([]),
    getBalanceSheets: vi.fn().mockResolvedValue([]),
    getCashFlowStatements: vi.fn().mockResolvedValue([]),
    getIncomeStatementGrowths: vi.fn().mockResolvedValue([]),
    getFinancialGrowths: vi.fn().mockResolvedValue([]),
    getCashFlowGrowths: vi.fn().mockResolvedValue([]),
};

describe('runFinancialsAnalysis', () => {
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

        mockDataProvider.getIncomeStatements.mockResolvedValue([]);
        mockDataProvider.getBalanceSheets.mockResolvedValue([]);
        mockDataProvider.getCashFlowStatements.mockResolvedValue([]);
        mockDataProvider.getIncomeStatementGrowths.mockResolvedValue([]);
        mockDataProvider.getFinancialGrowths.mockResolvedValue([]);
        mockDataProvider.getCashFlowGrowths.mockResolvedValue([]);
    });

    describe('cache hit', () => {
        it('cache hit → callAnalysisAi NOT called, returns {status:"cached"}', async () => {
            mockCacheGet.mockResolvedValueOnce(mockRawResult);

            const result = await runFinancialsAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
            });

            expect(result.status).toBe('cached');
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
            // 캐시 히트면 provider도 타지 않는다.
            Object.values(mockDataProvider).forEach(method =>
                expect(method as Mock).not.toHaveBeenCalled()
            );
        });

        it('빈 결론이 캐시에 있으면 미스로 취급해 LLM을 태운다', async () => {
            mockCacheGet.mockResolvedValueOnce({
                overallConclusionKo: '',
                axisAssessments: [],
                riskFactorsKo: [],
                overallSentiment: 'neutral',
            });

            const result = await runFinancialsAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
            });

            expect(result.status).toBe('done');
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
        });
    });

    describe('cache miss → LLM', () => {
        it('callAnalysisAi를 1회 호출하고 done을 반환한다', async () => {
            const result = await runFinancialsAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
            });

            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(result.status).toBe('done');
        });

        it('signal을 callAnalysisAi에 그대로 전달한다', async () => {
            const controller = new AbortController();

            await runFinancialsAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
                signal: controller.signal,
            });

            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ signal: controller.signal })
            );
        });

        it('결과를 FINANCIALS_CACHE_TTL_SECONDS로 캐시에 기록한다', async () => {
            await runFinancialsAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
            });

            expect(mockCacheSet).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    overallConclusionKo: mockRawResult.overallConclusionKo,
                }),
                FINANCIALS_CACHE_TTL_SECONDS
            );
        });
    });

    describe('skipEnqueueIfMiss (봇 경로)', () => {
        it('캐시 미스 + skipEnqueueIfMiss → LLM을 태우지 않는다', async () => {
            const result = await runFinancialsAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
                skipEnqueueIfMiss: true,
            });

            expect(result.status).toBe('miss_no_trigger');
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
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

            const args = {
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
            };
            const both = Promise.all([
                runFinancialsAnalysis(args),
                runFinancialsAnalysis(args),
            ]);

            resolveAi(JSON.stringify(mockRawResult));
            const [a, b] = await both;

            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(a.status).toBe('done');
            expect(b.status).toBe('done');
        });
    });
});
