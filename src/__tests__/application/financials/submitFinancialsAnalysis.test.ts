import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import type { TierConfig } from '@/domain/types';
import { normalizeFinancialsAnalysisResponse } from '@/domain/analysis/normalizeFinancials';
import { FINANCIALS_SYSTEM_PROMPT } from '@/domain/analysis/systemPrompt';
import { DEFAULT_TIER } from '@/domain/tier';
import { TEST_TIER_CONFIG } from '@/__tests__/helpers/testTierConfig';

vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/jobs/queue');
vi.mock('@/application/background');
vi.mock('@/infrastructure/skills/loader');

import { submitFinancialsAnalysis } from '@/application/financials/submitFinancialsAnalysis';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { analysisSeed } from '@/infrastructure/hash/analysisInput';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { fireAndForget } from '@/application/background';
import { loadSkillsCached } from '@/infrastructure/skills/loader';

const mockCreateCacheProvider = createCacheProvider as Mock;
const mockSetJobMeta = setJobMeta as Mock;
const mockFireAndForget = fireAndForget as Mock;
const mockLoadSkillsCached = loadSkillsCached as Mock;

const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheProvider = {
    get: mockCacheGet,
    set: mockCacheSet,
    delete: vi.fn(),
};

const mockFetch = vi.fn();

const mockDataProvider = {
    getIncomeStatements: vi.fn().mockResolvedValue([]),
    getBalanceSheets: vi.fn().mockResolvedValue([]),
    getCashFlowStatements: vi.fn().mockResolvedValue([]),
    getIncomeStatementGrowths: vi.fn().mockResolvedValue([]),
    getFinancialGrowths: vi.fn().mockResolvedValue([]),
    getCashFlowGrowths: vi.fn().mockResolvedValue([]),
};

const mockCachedResult = {
    overallConclusionKo: '캐시된 재무 분석입니다.',
    axisAssessments: [],
    riskFactorsKo: [],
    overallSentiment: 'neutral' as const,
};

describe('submitFinancialsAnalysis 함수는', () => {
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
        mockLoadSkillsCached.mockResolvedValue({
            skills: [],
            skillsDegraded: false,
        });

        // Reset provider mocks to defaults
        mockDataProvider.getIncomeStatements.mockResolvedValue([]);
        mockDataProvider.getBalanceSheets.mockResolvedValue([]);
        mockDataProvider.getCashFlowStatements.mockResolvedValue([]);
        mockDataProvider.getIncomeStatementGrowths.mockResolvedValue([]);
        mockDataProvider.getFinancialGrowths.mockResolvedValue([]);
        mockDataProvider.getCashFlowGrowths.mockResolvedValue([]);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        process.env = originalEnv;
    });

    describe('캐시 히트일 때', () => {
        it('cached 상태와 함께 결과를 반환하고 provider를 호출하지 않는다', async () => {
            mockCacheGet.mockResolvedValueOnce(mockCachedResult);

            const result = await submitFinancialsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
            });

            expect(result.status).toBe('cached');
            if (result.status === 'cached') {
                // Derive expected via the same normalization path so a regression
                // in normalizeFinancialsAnalysisResponse is caught, not masked.
                expect(result.result).toEqual(
                    normalizeFinancialsAnalysisResponse(mockCachedResult)
                );
            }
            expect(mockSetJobMeta).not.toHaveBeenCalled();
            expect(mockFetch).not.toHaveBeenCalled();
            // Cache hit must not trigger any provider fetches — verify all methods.
            Object.values(mockDataProvider).forEach(method =>
                expect(method as Mock).not.toHaveBeenCalled()
            );
        });

        it('bypasses cache when force=true', async () => {
            mockCacheGet.mockReset();
            mockCacheGet.mockResolvedValue(mockCachedResult);

            const result = await submitFinancialsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
                force: true,
            });

            expect(result.status).toBe('submitted');
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockDataProvider.getIncomeStatements).toHaveBeenCalled();
            expect(mockSetJobMeta).toHaveBeenCalled();
        });

        it('overallConclusionKo가 비어 있으면 캐시 미스로 처리하고 provider를 호출한다', async () => {
            const emptyConclusion = {
                overallConclusionKo: '',
                axisAssessments: [],
                riskFactorsKo: [],
                overallSentiment: 'neutral' as const,
            };
            mockCacheGet.mockResolvedValueOnce(emptyConclusion);
            const recordUsage = vi.fn().mockResolvedValue(undefined);

            const result = await submitFinancialsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
                usage: {
                    usageRepository: {
                        recordUsage,
                        getUsageToday: vi
                            .fn()
                            .mockResolvedValue({ analysis: 0, chatbot: 0 }),
                    },
                    clientIp: '203.0.113.10',
                },
            });

            expect(result.status).toBe('submitted');
            expect(mockDataProvider.getIncomeStatements).toHaveBeenCalled();
            expect(recordUsage).toHaveBeenCalledTimes(1);
        });

        it('캐시 읽기가 실패하면 catch에서 흡수하고 submit 경로로 진행한다', async () => {
            mockCacheGet.mockRejectedValueOnce(new Error('redis down'));

            const result = await submitFinancialsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
            });

            expect(result.status).toBe('submitted');
            expect(mockDataProvider.getIncomeStatements).toHaveBeenCalled();
            expect(mockSetJobMeta).toHaveBeenCalled();
        });
    });

    describe('캐시 미스일 때', () => {
        beforeEach(() => {
            mockCacheGet.mockResolvedValueOnce(null);
        });

        it('6개 provider 메서드를 모두 호출하고 submitted 상태와 jobId를 반환하며 워커에 POST를 1회 보낸다', async () => {
            const result = await submitFinancialsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
            });

            expect(result.status).toBe('submitted');
            if (result.status === 'submitted') {
                expect(typeof result.jobId).toBe('string');
                expect(result.jobId.length).toBeGreaterThan(0);
            }
            expect(mockDataProvider.getIncomeStatements).toHaveBeenCalledWith(
                'AAPL',
                'annual',
                5
            );
            expect(mockDataProvider.getBalanceSheets).toHaveBeenCalledWith(
                'AAPL',
                'annual',
                5
            );
            expect(mockDataProvider.getCashFlowStatements).toHaveBeenCalledWith(
                'AAPL',
                'annual',
                5
            );
            expect(
                mockDataProvider.getIncomeStatementGrowths
            ).toHaveBeenCalledWith('AAPL', 'annual', 5);
            expect(mockDataProvider.getFinancialGrowths).toHaveBeenCalledWith(
                'AAPL',
                'annual',
                5
            );
            expect(mockDataProvider.getCashFlowGrowths).toHaveBeenCalledWith(
                'AAPL',
                'annual',
                5
            );
            expect(mockSetJobMeta).toHaveBeenCalled();
            expect(mockFireAndForget).toHaveBeenCalledTimes(1);
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it('워커에 jobId, modelId, cacheKey를 포함한 메타를 등록한다', async () => {
            const result = await submitFinancialsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
            });

            expect(result.status).toBe('submitted');
            expect(mockSetJobMeta).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    symbol: 'AAPL',
                    modelId: 'gemini-2.5-flash',
                    cacheKey: expect.any(String),
                })
            );
        });

        it('워커 body에 analysisType=financials, system, responseSchema, seed를 포함한다', async () => {
            const result = await submitFinancialsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
            });

            expect(result.status).toBe('submitted');
            const body = JSON.parse(
                mockFetch.mock.calls[0][1].body as string
            ) as Record<string, unknown>;
            expect(body.analysisType).toBe('financials');
            expect(body.system).toBe(FINANCIALS_SYSTEM_PROMPT);
            expect(body.seed).toBe(analysisSeed(body.prompt as string));
            expect(body.responseSchema).toBeDefined();
        });

        it('period/limit을 명시하면 provider에 그대로 전달한다', async () => {
            const result = await submitFinancialsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
                period: 'annual',
                limit: 10,
            });

            expect(result.status).toBe('submitted');
            expect(mockDataProvider.getIncomeStatements).toHaveBeenCalledWith(
                'AAPL',
                'annual',
                10
            );
        });

        it('워커 fetch가 거부되어도 catch에서 흡수하고 submitted를 반환한다', async () => {
            mockFireAndForget.mockImplementationOnce(
                (promise: Promise<unknown>) => promise
            );
            mockFetch.mockRejectedValueOnce(new Error('worker unreachable'));

            const result = await submitFinancialsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
            });

            expect(result.status).toBe('submitted');
            expect(mockSetJobMeta).toHaveBeenCalled();
            expect(mockFetch).toHaveBeenCalled();
        });

        it('provider가 throw하면 fetch_failed error를 반환한다', async () => {
            mockDataProvider.getIncomeStatements.mockRejectedValueOnce(
                new Error('FMP API error')
            );
            const recordUsage = vi.fn();

            const result = await submitFinancialsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
                usage: {
                    usageRepository: {
                        recordUsage,
                        getUsageToday: vi
                            .fn()
                            .mockResolvedValue({ analysis: 0, chatbot: 0 }),
                    },
                    clientIp: '203.0.113.10',
                },
            });

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.code).toBe('fetch_failed');
            }
            expect(mockSetJobMeta).not.toHaveBeenCalled();
            expect(mockFireAndForget).not.toHaveBeenCalled();
            expect(recordUsage).not.toHaveBeenCalled();
        });
    });

    describe('usage 기록(recordUsage)이', () => {
        beforeEach(() => {
            mockCacheGet.mockReset();
        });

        it('cached 경로에서 정확히 1회 호출된다 (모델/IP 전달 포함)', async () => {
            mockCacheGet.mockResolvedValueOnce(mockCachedResult);
            const recordUsage = vi.fn().mockResolvedValue(undefined);

            await submitFinancialsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
                usage: {
                    usageRepository: {
                        recordUsage,
                        getUsageToday: vi
                            .fn()
                            .mockResolvedValue({ analysis: 0, chatbot: 0 }),
                    },
                    clientIp: '203.0.113.10',
                },
            });

            expect(recordUsage).toHaveBeenCalledTimes(1);
            expect(recordUsage).toHaveBeenCalledWith(
                expect.objectContaining({
                    actionType: 'analysis',
                    ipAddress: '203.0.113.10',
                    modelUsed: 'gemini-2.5-flash',
                })
            );
        });

        it('submitted 경로에서 정확히 1회 호출된다', async () => {
            mockCacheGet.mockResolvedValueOnce(null);
            const recordUsage = vi.fn().mockResolvedValue(undefined);

            const result = await submitFinancialsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
                usage: {
                    usageRepository: {
                        recordUsage,
                        getUsageToday: vi
                            .fn()
                            .mockResolvedValue({ analysis: 0, chatbot: 0 }),
                    },
                    clientIp: '203.0.113.10',
                },
            });

            expect(result.status).toBe('submitted');
            expect(recordUsage).toHaveBeenCalledTimes(1);
        });

        it('usage 미제공 시 한도 검사 없이 정상 제출된다', async () => {
            mockCacheGet.mockResolvedValueOnce(null);
            const result = await submitFinancialsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
            });
            expect(result.status).toBe('submitted');
        });
    });

    describe('사용량 제한이 적용될 때', () => {
        it('tier와 usage가 제공되고 한도 초과 시 error 상태를 반환한다', async () => {
            const recordUsage = vi.fn();
            const restrictedTierConfig = {
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
            } as TierConfig;

            const result = await submitFinancialsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
                tier: 'free',
                tierConfig: restrictedTierConfig,
                usage: {
                    usageRepository: {
                        recordUsage,
                        getUsageToday: vi
                            .fn()
                            .mockResolvedValue({ analysis: 1, chatbot: 0 }),
                    },
                    clientIp: '203.0.113.10',
                },
            });

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.code).toBe('usage_limit_exceeded');
            }
            expect(mockSetJobMeta).not.toHaveBeenCalled();
            expect(recordUsage).not.toHaveBeenCalled();
        });
    });

    describe('BYOK gate + tier forwarding', () => {
        const testTierConfig = TEST_TIER_CONFIG;

        beforeEach(() => {
            mockCacheGet.mockResolvedValueOnce(null);
        });

        it('returns user_api_key_required when non-pro premium without BYOK', async () => {
            const result = await submitFinancialsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-pro',
                dataProvider: mockDataProvider,
                tier: 'member',
                tierConfig: testTierConfig,
            });

            expect(result.status).toBe('key_error');
            if (result.status === 'key_error') {
                expect(result.code).toBe('user_api_key_required');
                expect(result.modelId).toBe('gemini-2.5-pro');
                expect(result.tier).toBe('member');
            }
            expect(mockFetch).not.toHaveBeenCalled();
            // Provider must not be fetched when the BYOK gate blocks early.
            expect(mockDataProvider.getIncomeStatements).not.toHaveBeenCalled();
        });

        it('proceeds when non-pro premium with BYOK (tier in body, header set)', async () => {
            const result = await submitFinancialsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-pro',
                dataProvider: mockDataProvider,
                tier: 'member',
                tierConfig: testTierConfig,
                userApiKey: 'usr-key',
            });

            expect(result.status).toBe('submitted');
            expect(mockFetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'X-AI-API-KEY': 'usr-key',
                    }),
                })
            );
            const body = JSON.parse(
                mockFetch.mock.calls[0][1].body as string
            ) as Record<string, unknown>;
            expect(body.tier).toBe('member');
        });

        it('proceeds when pro premium without BYOK (tier in body, no header)', async () => {
            const result = await submitFinancialsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-pro',
                dataProvider: mockDataProvider,
                tier: 'pro',
                tierConfig: testTierConfig,
            });

            expect(result.status).toBe('submitted');
            const fetchCall = mockFetch.mock.calls[0][1] as {
                headers: Record<string, string>;
                body: string;
            };
            expect(fetchCall.headers['X-AI-API-KEY']).toBeUndefined();
            const body = JSON.parse(fetchCall.body) as Record<string, unknown>;
            expect(body.tier).toBe('pro');
        });

        it('treats missing tier as DEFAULT_TIER', async () => {
            const result = await submitFinancialsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
                tierConfig: testTierConfig,
            });

            expect(result.status).toBe('submitted');
            const body = JSON.parse(
                mockFetch.mock.calls[0][1].body as string
            ) as Record<string, unknown>;
            expect(body.tier).toBe(DEFAULT_TIER);
        });
    });

    describe('skipEnqueueIfMiss 옵션이 true일 때', () => {
        beforeEach(() => {
            mockCacheGet.mockReset();
        });

        it('캐시 미스이면 워커를 트리거하지 않고 miss_no_trigger를 반환한다', async () => {
            mockCacheGet.mockResolvedValue(null);

            const result = await submitFinancialsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
                skipEnqueueIfMiss: true,
            });

            expect(result).toEqual({ status: 'miss_no_trigger' });
            expect(mockDataProvider.getIncomeStatements).not.toHaveBeenCalled();
            expect(mockSetJobMeta).not.toHaveBeenCalled();
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('캐시 히트면 평소처럼 cached 결과를 반환한다', async () => {
            mockCacheGet.mockResolvedValue(mockCachedResult);

            const result = await submitFinancialsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
                skipEnqueueIfMiss: true,
            });

            expect(result.status).toBe('cached');
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('옵션이 생략되면 기존대로 캐시 미스 시 submitted를 반환한다', async () => {
            mockCacheGet.mockResolvedValue(null);

            const result = await submitFinancialsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
            });

            expect(result.status).toBe('submitted');
            expect(mockFetch).toHaveBeenCalled();
        });
    });
});
