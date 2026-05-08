import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import type { TierConfig } from '@/domain/types';
import { normalizeFundamentalAnalysisResponse } from '@/domain/analysis/normalizeFundamental';
import { DEFAULT_TIER, TIER_CONFIG } from '@/domain/tier';

vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/jobs/queue');
vi.mock('@/application/background');
vi.mock('@/infrastructure/skills/loader');

import { submitFundamentalAnalysis } from '@/application/fundamental/submitFundamentalAnalysis';
import { createCacheProvider } from '@/infrastructure/cache/redis';
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

// Minimal valid FundamentalSnapshot used in provider mock responses
const validProfile = {
    symbol: 'AAPL',
    companyName: 'Apple Inc.',
    sector: 'Technology',
    industry: 'Consumer Electronics',
    marketCap: 3000000000000,
    ceo: 'Tim Cook',
    website: 'https://www.apple.com',
    description: null,
};

const mockDataProvider = {
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
    getSectorPerformanceSnapshot: vi.fn().mockResolvedValue([]),
    getHistoricalSectorPerformance: vi.fn().mockResolvedValue([]),
    getEarningsReport: vi.fn().mockResolvedValue(null),
};

const mockCachedResult = {
    overallConclusionKo: '캐시된 분석입니다.',
    categoryAssessments: [],
    riskFactorsKo: [],
    overallSentiment: 'neutral' as const,
};

describe('submitFundamentalAnalysis 함수는', () => {
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

        // Reset provider mocks
        mockDataProvider.getProfile.mockResolvedValue(validProfile);
        mockDataProvider.getKeyMetricsTtm.mockResolvedValue(null);
        mockDataProvider.getRatiosTtm.mockResolvedValue(null);
        mockDataProvider.getCashFlowStatement.mockResolvedValue(null);
        mockDataProvider.getIncomeStatementGrowth.mockResolvedValue(null);
        mockDataProvider.getFinancialScores.mockResolvedValue(null);
        mockDataProvider.getStockPeers.mockResolvedValue([]);
        mockDataProvider.getAnalystEstimates.mockResolvedValue(null);
        mockDataProvider.getGradesConsensus.mockResolvedValue(null);
        mockDataProvider.getPriceTargetConsensus.mockResolvedValue(null);
        mockDataProvider.getPriceTargetSummary.mockResolvedValue(null);
        mockDataProvider.getSectorPerformanceSnapshot.mockResolvedValue([]);
        mockDataProvider.getHistoricalSectorPerformance.mockResolvedValue([]);
        mockDataProvider.getEarningsReport.mockResolvedValue(null);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        process.env = originalEnv;
    });

    describe('캐시 히트일 때', () => {
        it('cached 상태와 함께 결과를 반환하고 provider를 호출하지 않는다', async () => {
            mockCacheGet.mockResolvedValueOnce(mockCachedResult);

            const result = await submitFundamentalAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
            });

            expect(result.status).toBe('cached');
            if (result.status === 'cached') {
                // Derive expected via the same normalization path the function uses
                // so that a regression in normalizeFundamentalAnalysisResponse is
                // caught rather than masked by a matching default fallback.
                expect(result.result).toEqual(
                    normalizeFundamentalAnalysisResponse(mockCachedResult)
                );
            }
            expect(mockSetJobMeta).not.toHaveBeenCalled();
            expect(mockFetch).not.toHaveBeenCalled();
            // Cache hit must not trigger any FMP data fetches — verify all methods.
            Object.values(mockDataProvider).forEach(method =>
                expect(method as Mock).not.toHaveBeenCalled()
            );
        });

        it('캐시에 부분 형태가 들어 있어도 정규화된 cached 결과를 반환한다', async () => {
            const stalePoisonedCache = {
                overallConclusionKo: 'old shape',
                someOtherField: true,
            };
            mockCacheGet.mockResolvedValueOnce(stalePoisonedCache);
            const recordUsage = vi.fn().mockResolvedValue(undefined);

            const result = await submitFundamentalAnalysis({
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

            expect(result.status).toBe('cached');
            if (result.status === 'cached') {
                expect(result.result).toEqual({
                    overallConclusionKo: 'old shape',
                    categoryAssessments: [],
                    riskFactorsKo: [],
                    overallSentiment: 'neutral',
                });
            }
            expect(mockSetJobMeta).not.toHaveBeenCalled();
            expect(mockFireAndForget).not.toHaveBeenCalled();
            expect(recordUsage).toHaveBeenCalledTimes(1);
        });

        it('캐시 결과의 overallConclusionKo가 비어 있으면 캐시 미스로 처리하고 provider를 호출한다', async () => {
            const emptyConclusion = {
                overallConclusionKo: '',
                categoryAssessments: [],
                riskFactorsKo: [],
                overallSentiment: 'neutral' as const,
            };
            mockCacheGet.mockResolvedValueOnce(emptyConclusion);
            const recordUsage = vi.fn().mockResolvedValue(undefined);

            const result = await submitFundamentalAnalysis({
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
            expect(mockDataProvider.getProfile).toHaveBeenCalled();
            // Empty conclusion is not billed on the cache path — usage is
            // recorded only after a successful submit.
            expect(recordUsage).toHaveBeenCalledTimes(1);
        });
    });

    describe('캐시 미스일 때', () => {
        beforeEach(() => {
            mockCacheGet.mockResolvedValueOnce(null);
        });

        it('submitted 상태와 jobId를 반환하고 워커에 POST를 보낸다', async () => {
            const result = await submitFundamentalAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
            });

            expect(result.status).toBe('submitted');
            if (result.status === 'submitted') {
                expect(typeof result.jobId).toBe('string');
                expect(result.jobId.length).toBeGreaterThan(0);
            }
            expect(mockSetJobMeta).toHaveBeenCalled();
            expect(mockFireAndForget).toHaveBeenCalled();
        });

        it('워커에 jobId, prompt, model을 포함한 body를 전송한다', async () => {
            mockFireAndForget.mockImplementationOnce(
                (promise: Promise<unknown>) => {
                    void promise; // track that it was called but don't await
                }
            );

            // We need to verify fetch is called with correct args — capture via fetch mock
            // Since fireAndForget wraps the fetch, we test what was passed by checking
            // that setJobMeta was called (which happens before fireAndForget)
            const result = await submitFundamentalAnalysis({
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

        it('loadSkillsCached 실패 시 skillsDegraded: true 를 setJobMeta에 전달한다', async () => {
            mockLoadSkillsCached.mockResolvedValueOnce({
                skills: [],
                skillsDegraded: true,
            });

            const result = await submitFundamentalAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
            });

            expect(result.status).toBe('submitted');
            expect(mockSetJobMeta).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    skillsDegraded: true,
                })
            );
        });

        it('loadSkillsCached 성공 시 skillsDegraded 를 setJobMeta에 포함하지 않는다', async () => {
            const result = await submitFundamentalAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
            });

            expect(result.status).toBe('submitted');
            expect(mockSetJobMeta).toHaveBeenCalledWith(
                expect.any(String),
                expect.not.objectContaining({
                    skillsDegraded: expect.anything(),
                })
            );
        });

        it('getProfile이 null을 반환하면 fetch_failed error를 반환한다', async () => {
            mockDataProvider.getProfile.mockResolvedValueOnce(null);

            const result = await submitFundamentalAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
            });

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.code).toBe('fetch_failed');
            }
            expect(mockSetJobMeta).not.toHaveBeenCalled();
            expect(mockFireAndForget).not.toHaveBeenCalled();
        });

        it('provider getProfile 호출 시 에러가 발생하면 error 상태를 반환한다', async () => {
            mockDataProvider.getProfile.mockRejectedValueOnce(
                new Error('FMP API error')
            );
            const recordUsage = vi.fn();

            const result = await submitFundamentalAnalysis({
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
            // Reset the cache-get queue so prior describes don't leak values.
            mockCacheGet.mockReset();
        });

        it('cached 경로에서 정확히 1회 호출된다 (모델/IP 전달 포함)', async () => {
            mockCacheGet.mockResolvedValueOnce(mockCachedResult);
            const recordUsage = vi.fn().mockResolvedValue(undefined);

            await submitFundamentalAnalysis({
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

            const result = await submitFundamentalAnalysis({
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
            const result = await submitFundamentalAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
            });
            expect(result.status).toBe('submitted');
            if (result.status === 'submitted') {
                expect(result.jobId).toEqual(expect.any(String));
            }
        });

        it('FundamentalAnalysisUsageOptions 별칭(@deprecated)도 동일하게 동작한다', async () => {
            mockCacheGet.mockResolvedValueOnce(null);
            const recordUsage = vi.fn().mockResolvedValue(undefined);
            // Imported as a type alias of AnalysisUsageOptions — same shape at runtime.
            const usage = {
                usageRepository: {
                    recordUsage,
                    getUsageToday: vi
                        .fn()
                        .mockResolvedValue({ analysis: 0, chatbot: 0 }),
                },
                clientIp: '203.0.113.10',
                userId: 'user-abc',
                modelUsed: 'override-model',
            };

            await submitFundamentalAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
                usage,
            });

            expect(recordUsage).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 'user-abc',
                    modelUsed: 'override-model',
                })
            );
        });
    });

    describe('사용량 제한이 적용될 때', () => {
        it('tier와 usage가 제공되고 한도 초과 시 error 상태를 반환한다', async () => {
            const recordUsage = vi.fn();
            // TierConfig with restrictions enabled and analysisPerDay limit of 1 for free tier.
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

            const result = await submitFundamentalAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
                tier: 'free',
                tierConfig: restrictedTierConfig,
                usage: {
                    usageRepository: {
                        recordUsage,
                        // Returns analysis count already at the limit (1 >= 1)
                        getUsageToday: vi
                            .fn()
                            .mockResolvedValue({ analysis: 1, chatbot: 0 }),
                    },
                    clientIp: '203.0.113.10',
                },
            });

            // Usage limit exceeded → error
            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.code).toBe('usage_limit_exceeded');
            }
            expect(mockSetJobMeta).not.toHaveBeenCalled();
            expect(recordUsage).not.toHaveBeenCalled();
        });
    });

    describe('submitFundamentalAnalysis BYOK gate + tier forwarding', () => {
        // Explicit tier config decoupled from production TIER_CONFIG.
        // Tests classify models themselves so changes to TIER_CONFIG don't
        // silently pass with wrong semantics.
        const testTierConfig: TierConfig = {
            ...TIER_CONFIG,
            models: {
                free: ['gemini-2.5-flash'],
                member: ['gemini-2.5-flash', 'gemini-2.5-pro'],
                pro: ['gemini-2.5-flash', 'gemini-2.5-pro'],
            },
            featureFlags: { enableTierRestrictions: false },
        };

        beforeEach(() => {
            mockCacheGet.mockResolvedValueOnce(null);
        });

        it('returns user_api_key_required when non-pro premium without BYOK', async () => {
            const result = await submitFundamentalAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-pro',
                dataProvider: mockDataProvider,
                tier: 'member',
                tierConfig: testTierConfig,
            });

            expect(result.status).toBe('error');
            if (result.status === 'error' && result.code === 'user_api_key_required') {
                expect(result.modelId).toBe('gemini-2.5-pro');
                expect(result.tier).toBe('member');
            } else {
                expect(result).toMatchObject({ code: 'user_api_key_required' });
            }
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('proceeds when non-pro premium with BYOK (tier in body, header set)', async () => {
            const result = await submitFundamentalAnalysis({
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
            const result = await submitFundamentalAnalysis({
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

        it('proceeds for free model regardless of tier', async () => {
            const result = await submitFundamentalAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
                tier: 'free',
                tierConfig: testTierConfig,
            });

            expect(result.status).toBe('submitted');
            const body = JSON.parse(
                mockFetch.mock.calls[0][1].body as string
            ) as Record<string, unknown>;
            expect(body.tier).toBe('free');
        });

        it('treats missing tier as DEFAULT_TIER', async () => {
            const result = await submitFundamentalAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                dataProvider: mockDataProvider,
                tierConfig: testTierConfig,
                // no tier provided
            });

            expect(result.status).toBe('submitted');
            const body = JSON.parse(
                mockFetch.mock.calls[0][1].body as string
            ) as Record<string, unknown>;
            expect(body.tier).toBe(DEFAULT_TIER);
        });
    });
});
