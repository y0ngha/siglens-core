import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/jobs/queue');
vi.mock('@/application/background');

import { submitOptionsAnalysis } from '@/application/options/submitOptionsAnalysis';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { fireAndForget } from '@/application/background';
import { DEFAULT_TIER } from '@/domain/tier';
import type { OptionsSnapshot, TierConfig } from '@/domain/types';
import { TEST_TIER_CONFIG } from '@/__tests__/helpers/testTierConfig';

const mockCreateCacheProvider = createCacheProvider as Mock;
const mockSetJobMeta = setJobMeta as Mock;
const mockFireAndForget = fireAndForget as Mock;

const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheProvider = {
    get: mockCacheGet,
    set: mockCacheSet,
    delete: vi.fn(),
};

const mockFetch = vi.fn();

/** Minimal valid OptionsSnapshot with 1 chain and 2 strikes each side. */
function makeSnapshot(overrides?: Partial<OptionsSnapshot>): OptionsSnapshot {
    return {
        symbol: 'AAPL',
        underlyingPrice: 200,
        capturedAt: '2026-05-14T10:00:00Z',
        chains: [
            {
                expirationDate: '2026-06-20',
                daysToExpiration: 37,
                calls: [
                    {
                        contractSymbol: 'AAPL260620C00195000',
                        strike: 195,
                        lastPrice: 8.5,
                        bid: 8.3,
                        ask: 8.7,
                        volume: 100,
                        openInterest: 500,
                        impliedVolatility: 0.28,
                        inTheMoney: true,
                    },
                    {
                        contractSymbol: 'AAPL260620C00205000',
                        strike: 205,
                        lastPrice: 3.2,
                        bid: 3.0,
                        ask: 3.4,
                        volume: 80,
                        openInterest: 300,
                        impliedVolatility: 0.3,
                        inTheMoney: false,
                    },
                ],
                puts: [
                    {
                        contractSymbol: 'AAPL260620P00195000',
                        strike: 195,
                        lastPrice: 4.0,
                        bid: 3.8,
                        ask: 4.2,
                        volume: 60,
                        openInterest: 400,
                        impliedVolatility: 0.29,
                        inTheMoney: false,
                    },
                    {
                        contractSymbol: 'AAPL260620P00205000',
                        strike: 205,
                        lastPrice: 9.1,
                        bid: 8.9,
                        ask: 9.3,
                        volume: 50,
                        openInterest: 350,
                        impliedVolatility: 0.31,
                        inTheMoney: true,
                    },
                ],
            },
        ],
        ...overrides,
    };
}

/** A snapshot with a second chain added. */
function makeSnapshotWithTwoChains(): OptionsSnapshot {
    const base = makeSnapshot();
    return {
        ...base,
        chains: [
            ...base.chains,
            {
                expirationDate: '2026-07-18',
                daysToExpiration: 65,
                calls: [
                    {
                        contractSymbol: 'AAPL260718C00200000',
                        strike: 200,
                        lastPrice: 7.0,
                        bid: 6.8,
                        ask: 7.2,
                        volume: 120,
                        openInterest: 600,
                        impliedVolatility: 0.27,
                        inTheMoney: true,
                    },
                ],
                puts: [
                    {
                        contractSymbol: 'AAPL260718P00200000',
                        strike: 200,
                        lastPrice: 6.5,
                        bid: 6.3,
                        ask: 6.7,
                        volume: 90,
                        openInterest: 450,
                        impliedVolatility: 0.28,
                        inTheMoney: false,
                    },
                ],
            },
        ],
    };
}

const mockCachedResult = {
    summary: '캐시된 옵션 분석 요약입니다.',
    perExpiration: [
        {
            expirationDate: '2026-06-20',
            commentary: '콜 우세 포지션.',
            tone: 'bullish' as const,
        },
    ],
    signals: [{ kind: 'bullish' as const, message: '콜 OI 우세' }],
    analyzedAt: '2026-05-14T10:00:00Z',
};

describe('submitOptionsAnalysis 함수는', () => {
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
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        process.env = originalEnv;
    });

    // ── 1. Cache hit ──
    describe('캐시 히트일 때', () => {
        it('cached 상태와 함께 re-normalize된 결과를 반환한다', async () => {
            mockCacheGet.mockResolvedValueOnce(mockCachedResult);

            const result = await submitOptionsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                expirationDate: '2026-06-20',
                snapshot: makeSnapshot(),
            });

            expect(result.status).toBe('cached');
            if (result.status === 'cached') {
                expect(result.result.summary).toBe(
                    '캐시된 옵션 분석 요약입니다.'
                );
                expect(result.result.perExpiration).toHaveLength(1);
                expect(result.result.signals).toHaveLength(1);
                // analyzedAt is preserved from cached payload
                expect(result.result.analyzedAt).toBeDefined();
            }
            expect(mockSetJobMeta).not.toHaveBeenCalled();
            expect(mockFireAndForget).not.toHaveBeenCalled();
        });

        it('캐시에 부분 형태가 들어 있어도 정규화된 cached 결과를 반환한다', async () => {
            const poisonedCache = {
                summary: '오래된 형태',
                someOldField: true,
            };
            mockCacheGet.mockResolvedValueOnce(poisonedCache);

            const result = await submitOptionsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                expirationDate: '2026-06-20',
                snapshot: makeSnapshot(),
            });

            expect(result.status).toBe('cached');
            if (result.status === 'cached') {
                expect(result.result.summary).toBe('오래된 형태');
                expect(result.result.perExpiration).toEqual([]);
                expect(result.result.signals).toEqual([]);
            }
            expect(mockSetJobMeta).not.toHaveBeenCalled();
        });
    });

    // ── 2. Cache miss + enqueues ──
    describe('캐시 미스일 때', () => {
        beforeEach(() => {
            mockCacheGet.mockResolvedValueOnce(null);
        });

        it('submitted 상태와 jobId를 반환하고 워커에 POST를 보낸다', async () => {
            const result = await submitOptionsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                expirationDate: '2026-06-20',
                snapshot: makeSnapshot(),
            });

            expect(result.status).toBe('submitted');
            if (result.status === 'submitted') {
                expect(typeof result.jobId).toBe('string');
                expect(result.jobId.length).toBeGreaterThan(0);
            }
            expect(mockSetJobMeta).toHaveBeenCalled();
            expect(mockFireAndForget).toHaveBeenCalled();
        });

        it('워커에 jobId, prompt, model, tier가 포함된 body를 전송한다', async () => {
            const result = await submitOptionsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                expirationDate: '2026-06-20',
                snapshot: makeSnapshot(),
                tier: 'free',
                tierConfig: TEST_TIER_CONFIG,
            });

            expect(result.status).toBe('submitted');
            expect(mockFetch).toHaveBeenCalledWith(
                'https://worker.test/analyze',
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        'Content-Type': 'application/json',
                        'X-Worker-Secret': 'test-secret',
                    }),
                })
            );
            const body = JSON.parse(
                mockFetch.mock.calls[0][1].body as string
            ) as Record<string, unknown>;
            expect(typeof body.jobId).toBe('string');
            expect(typeof body.prompt).toBe('string');
            expect(body.model).toBe('gemini-2.5-flash');
            expect(body.tier).toBe('free');
        });

        it('setJobMeta에 symbol, modelId, cacheKey를 전달한다', async () => {
            const result = await submitOptionsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                expirationDate: '2026-06-20',
                snapshot: makeSnapshot(),
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
            // options analysis does NOT propagate skillsDegraded
            expect(mockSetJobMeta).toHaveBeenCalledWith(
                expect.any(String),
                expect.not.objectContaining({
                    skillsDegraded: expect.anything(),
                })
            );
        });
    });

    // ── 3. BYOK required ──
    describe('BYOK가 필요한 경우', () => {
        it('tier가 member이고 premium 모델인데 userApiKey 없으면 key_error를 반환한다', async () => {
            mockCacheGet.mockResolvedValueOnce(null);

            const result = await submitOptionsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-pro',
                expirationDate: '2026-06-20',
                snapshot: makeSnapshot(),
                tier: 'member',
                tierConfig: TEST_TIER_CONFIG,
            });

            expect(result.status).toBe('key_error');
            if (result.status === 'key_error') {
                expect(result.code).toBe('user_api_key_required');
                expect(result.modelId).toBe('gemini-2.5-pro');
                expect(result.tier).toBe('member');
            }
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('userApiKey가 제공되면 X-AI-API-KEY 헤더를 포함해서 진행한다', async () => {
            mockCacheGet.mockResolvedValueOnce(null);

            const result = await submitOptionsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-pro',
                expirationDate: '2026-06-20',
                snapshot: makeSnapshot(),
                tier: 'member',
                tierConfig: TEST_TIER_CONFIG,
                userApiKey: 'usr-key-123',
            });

            expect(result.status).toBe('submitted');
            expect(mockFetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'X-AI-API-KEY': 'usr-key-123',
                    }),
                })
            );
        });
    });

    // ── 4. Usage limit exceeded ──
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

            const result = await submitOptionsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                expirationDate: '2026-06-20',
                snapshot: makeSnapshot(),
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

            expect(result.status).toBe('limit_error');
            if (result.status === 'limit_error') {
                expect(result.code).toBe('usage_limit_exceeded');
            }
            expect(mockSetJobMeta).not.toHaveBeenCalled();
            expect(mockFireAndForget).not.toHaveBeenCalled();
        });

        it('tier/usage가 제공되지 않으면 사용량 체크를 건너뛴다', async () => {
            mockCacheGet.mockResolvedValueOnce(null);

            const result = await submitOptionsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                expirationDate: '2026-06-20',
                snapshot: makeSnapshot(),
                // No tier or usage provided
            });

            expect(result.status).toBe('submitted');
        });
    });

    // ── 5. No chains ──
    describe('체인이 없을 때', () => {
        it('체인이 빈 스냅샷이면 no_options_chains 에러를 반환한다', async () => {
            const emptySnapshot = makeSnapshot({ chains: [] });

            const result = await submitOptionsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                expirationDate: '2026-06-20',
                snapshot: emptySnapshot,
            });

            expect(result.status).toBe('no_chains_error');
            if (result.status === 'no_chains_error') {
                expect(result.code).toBe('no_options_chains');
                expect(result.error).toBe(
                    'snapshot has no usable options chains'
                );
            }
            expect(mockSetJobMeta).not.toHaveBeenCalled();
            expect(mockFireAndForget).not.toHaveBeenCalled();
        });

        it('모든 체인이 sanitize에서 제거되면 no_options_chains 에러를 반환한다', async () => {
            // All contracts have negative OI to force chain rejection
            const corruptSnapshot = makeSnapshot({
                chains: [
                    {
                        expirationDate: '2026-06-20',
                        daysToExpiration: 37,
                        calls: [
                            {
                                contractSymbol: 'BAD1',
                                strike: 195,
                                lastPrice: null,
                                bid: null,
                                ask: null,
                                volume: -1,
                                openInterest: -1,
                                impliedVolatility: null,
                                inTheMoney: false,
                            },
                            {
                                contractSymbol: 'BAD2',
                                strike: 200,
                                lastPrice: null,
                                bid: null,
                                ask: null,
                                volume: -1,
                                openInterest: -1,
                                impliedVolatility: null,
                                inTheMoney: false,
                            },
                        ],
                        puts: [
                            {
                                contractSymbol: 'BAD3',
                                strike: 195,
                                lastPrice: null,
                                bid: null,
                                ask: null,
                                volume: -1,
                                openInterest: -1,
                                impliedVolatility: null,
                                inTheMoney: false,
                            },
                            {
                                contractSymbol: 'BAD4',
                                strike: 200,
                                lastPrice: null,
                                bid: null,
                                ask: null,
                                volume: -1,
                                openInterest: -1,
                                impliedVolatility: null,
                                inTheMoney: false,
                            },
                        ],
                    },
                ],
            });

            const result = await submitOptionsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                expirationDate: '2026-06-20',
                snapshot: corruptSnapshot,
            });

            expect(result.status).toBe('no_chains_error');
            if (result.status === 'no_chains_error') {
                expect(result.code).toBe('no_options_chains');
            }
        });
    });

    // ── 6. Specific expiration not in snapshot ──
    describe('특정 만기가 스냅샷에 없을 때', () => {
        it('해당 만기가 없으면 no_options_chains 에러를 반환한다', async () => {
            const result = await submitOptionsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                expirationDate: '2026-09-19', // not in makeSnapshot()
                snapshot: makeSnapshot(),
            });

            expect(result.status).toBe('no_chains_error');
            if (result.status === 'no_chains_error') {
                expect(result.code).toBe('no_options_chains');
                expect(result.error).toContain('2026-09-19');
            }
            expect(mockSetJobMeta).not.toHaveBeenCalled();
        });

        it("expirationDate가 'all'이면 특정 만기 체크를 건너뛴다", async () => {
            mockCacheGet.mockResolvedValueOnce(null);

            const result = await submitOptionsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                expirationDate: 'all',
                snapshot: makeSnapshotWithTwoChains(),
            });

            expect(result.status).toBe('submitted');
        });
    });

    // ── 7. skipEnqueueIfMiss = true + cache miss ──
    describe('skipEnqueueIfMiss 옵션이 true일 때', () => {
        beforeEach(() => {
            mockCacheGet.mockReset();
        });

        it('캐시 미스이면 워커를 트리거하지 않고 miss_no_trigger를 반환한다', async () => {
            mockCacheGet.mockResolvedValue(null);

            const result = await submitOptionsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                expirationDate: '2026-06-20',
                snapshot: makeSnapshot(),
                skipEnqueueIfMiss: true,
            });

            expect(result).toEqual({ status: 'miss_no_trigger' });
            expect(mockSetJobMeta).not.toHaveBeenCalled();
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('캐시 히트면 평소처럼 cached 결과를 반환한다', async () => {
            mockCacheGet.mockResolvedValue(mockCachedResult);

            const result = await submitOptionsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                expirationDate: '2026-06-20',
                snapshot: makeSnapshot(),
                skipEnqueueIfMiss: true,
            });

            expect(result.status).toBe('cached');
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('옵션이 생략되면 캐시 미스 시 submitted를 반환한다', async () => {
            mockCacheGet.mockResolvedValue(null);

            const result = await submitOptionsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                expirationDate: '2026-06-20',
                snapshot: makeSnapshot(),
            });

            expect(result.status).toBe('submitted');
            expect(mockFetch).toHaveBeenCalled();
        });
    });

    // ── Additional: tier forwarding ──
    describe('tier 전달', () => {
        beforeEach(() => {
            mockCacheGet.mockResolvedValueOnce(null);
        });

        it('tier가 없으면 DEFAULT_TIER를 워커 body에 포함한다', async () => {
            const result = await submitOptionsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                expirationDate: '2026-06-20',
                snapshot: makeSnapshot(),
                tierConfig: TEST_TIER_CONFIG,
                // no tier provided
            });

            expect(result.status).toBe('submitted');
            const body = JSON.parse(
                mockFetch.mock.calls[0][1].body as string
            ) as Record<string, unknown>;
            expect(body.tier).toBe(DEFAULT_TIER);
        });

        it('pro tier는 premium 모델이어도 BYOK 없이 진행한다', async () => {
            const result = await submitOptionsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-pro',
                expirationDate: '2026-06-20',
                snapshot: makeSnapshot(),
                tier: 'pro',
                tierConfig: TEST_TIER_CONFIG,
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
    });
});
