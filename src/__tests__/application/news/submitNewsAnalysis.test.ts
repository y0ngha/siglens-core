import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/jobs/queue');
vi.mock('@/application/background');
vi.mock('@/infrastructure/skills/loader');

import { submitNewsAnalysis } from '@/application/news/submitNewsAnalysis';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { fireAndForget } from '@/application/background';
import { loadSkillsCached } from '@/infrastructure/skills/loader';
import { DEFAULT_TIER, TIER_CONFIG } from '@/domain/tier';
import type {
    EnrichedNewsItem,
    EarningsCalendarItem,
    TierConfig,
} from '@/domain/types';

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

/** Minimal valid EnrichedNewsItem for use in tests. */
function makeEnrichedNewsItem(id: string): EnrichedNewsItem {
    return {
        id,
        symbol: 'AAPL',
        source: 'Reuters',
        url: `https://reuters.com/${id}`,
        publishedAt: '2026-05-01T10:00:00Z',
        titleEn: `Apple announces new product ${id}`,
        bodyEn: `Apple has announced new product ${id} today.`,
        card: {
            titleKo: `애플 신제품 발표 ${id}`,
            bodyKo: `애플이 오늘 신제품 ${id}을 발표했습니다.`,
            summaryKo: `애플 신제품 ${id} 발표`,
            sentiment: 'bullish',
            category: 'product',
            priceImpact: 'medium',
        },
    };
}

/** Minimal valid EarningsCalendarItem for use in tests. */
function makeEarningsCalendarItem(earningsDate: string): EarningsCalendarItem {
    return {
        symbol: 'AAPL',
        earningsDate,
        epsActual: null,
        epsEstimated: 1.5,
        revenueActual: null,
        revenueEstimated: 90_000_000_000,
        lastUpdated: '2026-05-01',
    };
}

const mockCachedResult = {
    currentDriverKo: '캐시된 뉴스 분석입니다.',
    keyEventsKo: [],
    upcomingEventsKo: [],
    overallSentiment: 'neutral' as const,
};

const singleNewsItem = makeEnrichedNewsItem('news-001');
const singleCalendarItem = makeEarningsCalendarItem('2026-07-25');

describe('submitNewsAnalysis 함수는', () => {
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
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        process.env = originalEnv;
    });

    describe('뉴스가 비어있을 때', () => {
        it('no_news 에러를 반환한다', async () => {
            const result = await submitNewsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                news: [],
                upcomingCalendar: [],
            });

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.code).toBe('no_news');
                expect(result.error).toBe('No news to analyze');
            }
            expect(mockSetJobMeta).not.toHaveBeenCalled();
            expect(mockFireAndForget).not.toHaveBeenCalled();
        });

        it('no_news 에러는 tier/cache 체크보다 먼저 반환된다', async () => {
            const result = await submitNewsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                news: [],
                upcomingCalendar: [singleCalendarItem],
                tier: 'free',
                usage: {
                    usageRepository: {
                        recordUsage: vi.fn(),
                        getUsageToday: vi
                            .fn()
                            .mockResolvedValue({ analysis: 0, chatbot: 0 }),
                    },
                    clientIp: '203.0.113.10',
                },
            });

            expect(result.status).toBe('error');
            if (result.status === 'error') {
                expect(result.code).toBe('no_news');
            }
            // Cache should never be checked
            expect(mockCacheGet).not.toHaveBeenCalled();
        });
    });

    describe('캐시 미스일 때', () => {
        beforeEach(() => {
            mockCacheGet.mockResolvedValueOnce(null);
        });

        it('submitted 상태와 jobId를 반환하고 워커에 POST를 보낸다', async () => {
            const result = await submitNewsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                news: [singleNewsItem],
                upcomingCalendar: [singleCalendarItem],
            });

            expect(result.status).toBe('submitted');
            if (result.status === 'submitted') {
                expect(typeof result.jobId).toBe('string');
                expect(result.jobId.length).toBeGreaterThan(0);
            }
            expect(mockSetJobMeta).toHaveBeenCalled();
            expect(mockFireAndForget).toHaveBeenCalled();
        });

        it('setJobMeta에 symbol, modelId, cacheKey를 전달한다', async () => {
            const result = await submitNewsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                news: [singleNewsItem],
                upcomingCalendar: [],
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

            const result = await submitNewsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                news: [singleNewsItem],
                upcomingCalendar: [],
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
            const result = await submitNewsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                news: [singleNewsItem],
                upcomingCalendar: [],
            });

            expect(result.status).toBe('submitted');
            expect(mockSetJobMeta).toHaveBeenCalledWith(
                expect.any(String),
                expect.not.objectContaining({
                    skillsDegraded: expect.anything(),
                })
            );
        });
    });

    describe('캐시 히트일 때', () => {
        it('cached 상태와 함께 결과를 반환한다', async () => {
            mockCacheGet.mockResolvedValueOnce(mockCachedResult);

            const result = await submitNewsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                news: [singleNewsItem],
                upcomingCalendar: [singleCalendarItem],
            });

            expect(result.status).toBe('cached');
            if (result.status === 'cached') {
                expect(result.result).toEqual(mockCachedResult);
            }
            expect(mockSetJobMeta).not.toHaveBeenCalled();
            expect(mockFireAndForget).not.toHaveBeenCalled();
        });

        it('캐시에 부분 형태가 들어 있어도 정규화된 cached 결과를 반환한다', async () => {
            const stalePoisonedCache = {
                currentDriverKo: '오래된 형태',
                someOldField: true,
            };
            mockCacheGet.mockResolvedValueOnce(stalePoisonedCache);

            const result = await submitNewsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                news: [singleNewsItem],
                upcomingCalendar: [singleCalendarItem],
            });

            expect(result.status).toBe('cached');
            if (result.status === 'cached') {
                expect(result.result).toEqual({
                    currentDriverKo: '오래된 형태',
                    keyEventsKo: [],
                    upcomingEventsKo: [],
                    overallSentiment: 'neutral',
                });
            }
            expect(mockSetJobMeta).not.toHaveBeenCalled();
            expect(mockFireAndForget).not.toHaveBeenCalled();
        });
    });

    describe('사용량 제한이 적용될 때', () => {
        it('tier와 usage가 제공되고 한도 초과 시 usage_limit_exceeded 에러를 반환한다', async () => {
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

            const result = await submitNewsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                news: [singleNewsItem],
                upcomingCalendar: [],
                tier: 'free',
                tierConfig: restrictedTierConfig,
                usage: {
                    usageRepository: {
                        recordUsage: vi.fn(),
                        // Count already at the limit (1 >= 1)
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
            expect(mockFireAndForget).not.toHaveBeenCalled();
        });

        it('tier/usage가 제공되지 않으면 사용량 체크를 건너뛴다', async () => {
            mockCacheGet.mockResolvedValueOnce(null);

            const result = await submitNewsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                news: [singleNewsItem],
                upcomingCalendar: [],
                // No tier or usage provided
            });

            expect(result.status).toBe('submitted');
        });
    });

    describe('usage 기록(recordUsage)이', () => {
        beforeEach(() => {
            // Reset the cache-get queue so prior describes don't leak values.
            mockCacheGet.mockReset();
        });

        it('cached 경로에서 정확히 1회 호출된다', async () => {
            mockCacheGet.mockResolvedValueOnce(mockCachedResult);
            const recordUsage = vi.fn().mockResolvedValue(undefined);

            await submitNewsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                news: [singleNewsItem],
                upcomingCalendar: [singleCalendarItem],
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

            const result = await submitNewsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                news: [singleNewsItem],
                upcomingCalendar: [singleCalendarItem],
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

        it('no_news 경로에서는 호출되지 않는다', async () => {
            const recordUsage = vi.fn().mockResolvedValue(undefined);

            await submitNewsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                news: [],
                upcomingCalendar: [],
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

            expect(recordUsage).not.toHaveBeenCalled();
        });
    });

    describe('입력 해시 결정성', () => {
        it('동일한 뉴스 셋은 순서가 달라도 동일한 캐시 키를 생성한다', async () => {
            const news1 = makeEnrichedNewsItem('news-aaa');
            const news2 = makeEnrichedNewsItem('news-bbb');

            // First call: [news1, news2] order
            mockCacheGet.mockResolvedValue(null);
            await submitNewsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                news: [news1, news2],
                upcomingCalendar: [singleCalendarItem],
            });
            const firstCallMeta = mockSetJobMeta.mock.calls[0]?.[1] as
                | { cacheKey: string }
                | undefined;

            vi.clearAllMocks();
            mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
            mockSetJobMeta.mockResolvedValue(undefined);
            mockFireAndForget.mockImplementation(() => undefined);
            mockLoadSkillsCached.mockResolvedValue({
                skills: [],
                skillsDegraded: false,
            });
            mockCacheGet.mockResolvedValue(null);

            // Second call: [news2, news1] reversed order
            await submitNewsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                news: [news2, news1],
                upcomingCalendar: [singleCalendarItem],
            });
            const secondCallMeta = mockSetJobMeta.mock.calls[0]?.[1] as
                | { cacheKey: string }
                | undefined;

            expect(firstCallMeta?.cacheKey).toBeDefined();
            expect(firstCallMeta?.cacheKey).toBe(secondCallMeta?.cacheKey);
        });
    });

    describe('submitNewsAnalysis BYOK gate + tier forwarding', () => {
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
            const result = await submitNewsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-pro',
                news: [singleNewsItem],
                upcomingCalendar: [],
                tier: 'member',
                tierConfig: testTierConfig,
            });

            expect(result.status).toBe('error');
            if (
                result.status === 'error' &&
                result.code === 'user_api_key_required'
            ) {
                expect(result.modelId).toBe('gemini-2.5-pro');
                expect(result.tier).toBe('member');
            } else {
                expect(result).toMatchObject({ code: 'user_api_key_required' });
            }
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('proceeds when non-pro premium with BYOK (tier in body, header set)', async () => {
            const result = await submitNewsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-pro',
                news: [singleNewsItem],
                upcomingCalendar: [],
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
            const result = await submitNewsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-pro',
                news: [singleNewsItem],
                upcomingCalendar: [],
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
            const result = await submitNewsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                news: [singleNewsItem],
                upcomingCalendar: [],
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
            const result = await submitNewsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                news: [singleNewsItem],
                upcomingCalendar: [],
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
