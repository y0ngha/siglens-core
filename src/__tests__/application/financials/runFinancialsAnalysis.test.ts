import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import type { Skill, TierConfig, TierModel } from '@/domain/types';
import { TEST_TIER_CONFIG } from '@/__tests__/helpers/testTierConfig';

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
import { buildFinancialsAnalysisPrompt } from '@/domain/analysis/financialsPrompt';
import { financialsSystemPrompt } from '@/domain/analysis/systemPrompt';

const mockCallAnalysisAi = callAnalysisAi as Mock;
const mockCreateCacheProvider = createCacheProvider as Mock;
const mockLoadSkillsCached = loadSkillsCached as Mock;
const mockBuildFinancialsAnalysisPrompt = buildFinancialsAnalysisPrompt as Mock;

const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheProvider = {
    get: mockCacheGet,
    set: mockCacheSet,
    delete: vi.fn(),
};

const mockSymbol = 'AAPL';
const mockModelId: TierModel = 'gemini-3.6-flash';

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

        it('providerFallback is forwarded to callAnalysisAi as fallbackOnProviderFailure', async () => {
            await runFinancialsAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
                providerFallback: true,
            });

            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ fallbackOnProviderFailure: true })
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
            await runFinancialsAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
            });
            const omitted = sentOf();
            mockCallAnalysisAi.mockClear();
            await runFinancialsAnalysis({
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
                await runFinancialsAnalysis({
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

    describe('provider 조회', () => {
        it('period·limit 미지정 시 annual·5로 6개 명세를 모두 조회한다', async () => {
            await runFinancialsAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
            });

            Object.values(mockDataProvider).forEach(method =>
                expect(method as Mock).toHaveBeenCalledWith(
                    mockSymbol,
                    'annual',
                    5
                )
            );
        });

        it('provider 중 하나라도 실패하면 fetch_failed 에러를 반환하고 LLM·캐시 쓰기를 건너뛴다', async () => {
            const errorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            mockDataProvider.getBalanceSheets.mockRejectedValueOnce(
                new Error('FMP 503')
            );

            const result = await runFinancialsAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
            });

            expect(result).toEqual({
                status: 'error',
                code: 'fetch_failed',
                error: 'Error: FMP 503',
            });
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
            expect(mockCacheSet).not.toHaveBeenCalled();
            errorSpy.mockRestore();
        });
    });

    describe('캐시 경로 세부', () => {
        it('force: true면 캐시를 조회하지 않고 LLM을 태운 뒤 결과를 다시 기록한다', async () => {
            mockCacheGet.mockResolvedValue(mockRawResult);

            const result = await runFinancialsAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
                force: true,
            });

            expect(result.status).toBe('done');
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(mockCacheSet).toHaveBeenCalledTimes(1);
        });

        it('캐시 provider가 없으면(null) 캐시 없이 LLM 결과를 반환한다', async () => {
            mockCreateCacheProvider.mockReturnValue(null);

            const result = await runFinancialsAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
            });

            expect(result.status).toBe('done');
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockCacheSet).not.toHaveBeenCalled();
        });

        it('캐시 읽기가 실패하면 로그만 남기고 LLM으로 진행한다', async () => {
            const errorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            mockCacheGet.mockRejectedValueOnce(new Error('redis down'));

            const result = await runFinancialsAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
            });

            expect(result.status).toBe('done');
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(errorSpy).toHaveBeenCalledWith(
                '[RunFinancials] Cache read failed:',
                expect.any(Error)
            );
            errorSpy.mockRestore();
        });

        it('캐시 쓰기가 실패해도 done을 반환하고 에러를 로그로 남긴다', async () => {
            const errorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            mockCacheSet.mockRejectedValueOnce(new Error('write failed'));

            const result = await runFinancialsAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
            });

            expect(result.status).toBe('done');
            await vi.waitFor(() =>
                expect(errorSpy).toHaveBeenCalledWith(
                    '[RunFinancials] Cache write failed:',
                    expect.any(Error)
                )
            );
            errorSpy.mockRestore();
        });

        it('캐시 히트면 usage를 기록하고, 빈 결론 캐시(미스 취급)는 LLM 이후 1회만 기록한다', async () => {
            const makeUsage = () => ({
                usageRepository: {
                    recordUsage: vi.fn().mockResolvedValue(undefined),
                    getUsageToday: vi.fn(),
                },
                clientIp: '10.0.0.1',
            });

            const hitUsage = makeUsage();
            mockCacheGet.mockResolvedValueOnce(mockRawResult);
            const hit = await runFinancialsAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
                usage: hitUsage,
            });

            const emptyUsage = makeUsage();
            mockCacheGet.mockResolvedValueOnce({
                ...mockRawResult,
                overallConclusionKo: '',
            });
            const miss = await runFinancialsAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
                usage: emptyUsage,
            });

            expect(hit.status).toBe('cached');
            expect(hitUsage.usageRepository.recordUsage).toHaveBeenCalledTimes(
                1
            );
            expect(miss.status).toBe('done');
            expect(
                emptyUsage.usageRepository.recordUsage
            ).toHaveBeenCalledTimes(1);
        });
    });

    describe('BYOK gate', () => {
        it('비-pro 티어 + BYOK 모델 + userApiKey 없음 → key_error, 캐시·provider·LLM 모두 건너뛴다', async () => {
            const result = await runFinancialsAnalysis({
                symbol: mockSymbol,
                modelId: 'gemini-3.1-pro-preview',
                dataProvider: mockDataProvider,
                tier: 'member',
                tierConfig: TEST_TIER_CONFIG,
            });

            expect(result).toMatchObject({
                status: 'key_error',
                code: 'user_api_key_required',
                modelId: 'gemini-3.1-pro-preview',
                tier: 'member',
            });
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockDataProvider.getIncomeStatements).not.toHaveBeenCalled();
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });

        it('userApiKey가 있으면 통과하고 키를 callAnalysisAi에 전달한다', async () => {
            const result = await runFinancialsAnalysis({
                symbol: mockSymbol,
                modelId: 'gemini-3.1-pro-preview',
                dataProvider: mockDataProvider,
                tier: 'member',
                tierConfig: TEST_TIER_CONFIG,
                userApiKey: 'usr-key',
            });

            expect(result.status).toBe('done');
            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({
                    userApiKey: 'usr-key',
                    model: 'gemini-3.1-pro-preview',
                    tier: 'member',
                })
            );
        });
    });

    describe('usage limit', () => {
        const LIMITED_TIER_CONFIG: TierConfig = {
            ...TEST_TIER_CONFIG,
            limits: {
                ...TEST_TIER_CONFIG.limits,
                analysisPerDay: { free: 1, member: 1, pro: 1 },
            },
            featureFlags: { enableTierRestrictions: true },
        };

        function makeUsage(analysisToday: number) {
            return {
                usageRepository: {
                    recordUsage: vi.fn().mockResolvedValue(undefined),
                    getUsageToday: vi.fn().mockResolvedValue({
                        analysis: analysisToday,
                        chatbot: 0,
                    }),
                },
                clientIp: '10.0.0.1',
            };
        }

        it('일일 한도에 도달하면 usage_limit_exceeded를 반환하고 캐시·provider·LLM을 건너뛴다', async () => {
            const usage = makeUsage(1);

            const result = await runFinancialsAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
                tier: 'free',
                tierConfig: LIMITED_TIER_CONFIG,
                usage,
            });

            expect(result).toMatchObject({
                status: 'error',
                code: 'usage_limit_exceeded',
                error: { code: 'analysis_limit_exceeded', tier: 'free' },
            });
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockDataProvider.getIncomeStatements).not.toHaveBeenCalled();
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
            expect(usage.usageRepository.recordUsage).not.toHaveBeenCalled();
        });

        it('한도 미만이면 LLM을 태우고 usage를 기록한다', async () => {
            const usage = makeUsage(0);

            const result = await runFinancialsAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
                tier: 'free',
                tierConfig: LIMITED_TIER_CONFIG,
                usage,
            });

            expect(result.status).toBe('done');
            expect(usage.usageRepository.getUsageToday).toHaveBeenCalledTimes(
                1
            );
            expect(usage.usageRepository.recordUsage).toHaveBeenCalledTimes(1);
        });

        it('tier를 명시하지 않으면 한도 조회 없이 진행한다', async () => {
            const usage = makeUsage(99);

            const result = await runFinancialsAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
                tierConfig: LIMITED_TIER_CONFIG,
                usage,
            });

            expect(result.status).toBe('done');
            expect(usage.usageRepository.getUsageToday).not.toHaveBeenCalled();
        });
    });

    describe('프롬프트·모델 해석', () => {
        it('stable 스킬 digest가 비면 system은 base persona만 보낸다', async () => {
            mockBuildFinancialsAnalysisPrompt.mockReturnValueOnce({
                stable: '',
                dynamic: 'mock-dynamic',
            });

            await runFinancialsAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
            });

            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({
                    system: financialsSystemPrompt('ko'),
                })
            );
        });

        it('stable 스킬 digest가 있으면 system 뒤에 덧붙인다', async () => {
            await runFinancialsAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
            });

            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({
                    system: `${financialsSystemPrompt('ko')}\n\nmock-stable`,
                })
            );
        });

        it('MODEL_SPECS에 없는 (폐기된) 모델 ID는 deepseek-v4.1-flash로 호출한다', async () => {
            const legacyModel = 'legacy-retired-model' as TierModel;

            const result = await runFinancialsAnalysis({
                symbol: mockSymbol,
                modelId: legacyModel,
                dataProvider: mockDataProvider,
                tierConfig: {
                    ...TEST_TIER_CONFIG,
                    models: {
                        free: [legacyModel],
                        member: [legacyModel],
                        pro: [legacyModel],
                    },
                },
            });

            expect(result.status).toBe('done');
            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ model: 'deepseek-v4.1-flash' })
            );
        });
    });

    describe('빈 응답', () => {
        it('결론·축 평가가 모두 비면 경고를 남기되 결과는 캐시에 기록한다', async () => {
            const warnSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => {});
            mockCallAnalysisAi.mockResolvedValueOnce(JSON.stringify({}));

            const result = await runFinancialsAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
            });

            expect(result.status).toBe('done');
            expect(warnSpy).toHaveBeenCalledWith(
                '[RunFinancials] Empty financials analysis',
                { symbol: mockSymbol }
            );
            expect(mockCacheSet).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    overallConclusionKo: '',
                    axisAssessments: [],
                }),
                FINANCIALS_CACHE_TTL_SECONDS
            );
            warnSpy.mockRestore();
        });

        it('결론이 비어도 축 평가가 있으면 빈 응답 경고를 남기지 않는다', async () => {
            const warnSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => {});
            mockCallAnalysisAi.mockResolvedValueOnce(
                JSON.stringify({
                    overallConclusionKo: '',
                    axisAssessments: [
                        {
                            axis: 'quality',
                            sentiment: 'positive',
                            rationaleKo: '마진 개선',
                        },
                    ],
                })
            );

            const result = await runFinancialsAnalysis({
                symbol: mockSymbol,
                modelId: mockModelId,
                dataProvider: mockDataProvider,
            });

            expect(result.status).toBe('done');
            expect(warnSpy).not.toHaveBeenCalled();
            warnSpy.mockRestore();
        });
    });
});
