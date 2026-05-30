import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/jobs/queue');
vi.mock('@/application/background');

import { submitOptionsAnalysis } from '@/application/options/submitOptionsAnalysis';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { analysisSeed } from '@/infrastructure/hash/analysisInput';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { fireAndForget } from '@/application/background';
import { OPTIONS_SYSTEM_PROMPT } from '@/domain/analysis/systemPrompt';
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

/**
 * Shared tier config for usage-limit tests — free tier capped at 1 analysis/day,
 * member/pro unlimited. Used by both the cache-hit bypass test and the
 * exhausted-quota error test to exercise the same gating logic.
 */
const RESTRICTED_TIER_CONFIG: TierConfig = {
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

        it('캐시 히트이면 BYOK 없이도 cached 결과를 반환한다', async () => {
            mockCacheGet.mockResolvedValueOnce(mockCachedResult);

            const result = await submitOptionsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-pro', // premium model
                expirationDate: '2026-06-20',
                snapshot: makeSnapshot(),
                tier: 'member',
                tierConfig: TEST_TIER_CONFIG,
                // userApiKey 미제공 — 캐시 히트이므로 BYOK 게이트를 통과하면 안 된다
            });

            expect(result.status).toBe('cached');
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('캐시 히트이면 사용량 한도 초과여도 cached 결과를 반환한다', async () => {
            mockCacheGet.mockResolvedValueOnce(mockCachedResult);

            const result = await submitOptionsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                expirationDate: '2026-06-20',
                snapshot: makeSnapshot(),
                tier: 'free',
                tierConfig: RESTRICTED_TIER_CONFIG,
                usage: {
                    usageRepository: {
                        recordUsage: vi.fn(),
                        // 한도 초과 상태이지만 캐시 히트로 우회되어야 한다
                        getUsageToday: vi
                            .fn()
                            .mockResolvedValue({ analysis: 1, chatbot: 0 }),
                    },
                    clientIp: '203.0.113.10',
                },
            });

            expect(result.status).toBe('cached');
            expect(mockFetch).not.toHaveBeenCalled();
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

        it('bypasses cache when force=true', async () => {
            // mockReset because vitest's clearAllMocks resets call history but
            // not pending resolutions — re-queuing here cannot leak forward.
            mockCacheGet.mockReset();
            mockCacheGet.mockResolvedValue(mockCachedResult);

            const result = await submitOptionsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                expirationDate: '2026-06-20',
                snapshot: makeSnapshot(),
                force: true,
            });

            expect(result.status).toBe('submitted');
            // Cache read must not have been attempted at all.
            expect(mockCacheGet).not.toHaveBeenCalled();
            // The job was enqueued via the normal submit path.
            expect(mockSetJobMeta).toHaveBeenCalled();
            expect(mockFireAndForget).toHaveBeenCalled();
        });

        it('underlyingPrice / capturedAt / OI 합계가 변경되어도 동일 캐시 키로 조회된다', async () => {
            // hashOptionsInput은 구조적 식별자만 hash하므로, provider 폴링마다
            // 흔들리는 fast-moving 필드(가격·시간·OI)는 cache miss를 일으키지
            // 말아야 한다. 두 호출이 같은 cacheKey로 cache.get을 호출하는지
            // 직접 검증해 24h TTL 안에서 cache hit이 유지됨을 보장한다.
            mockCacheGet.mockResolvedValue(mockCachedResult);

            const snapshotA = makeSnapshot({
                underlyingPrice: 200,
                capturedAt: '2026-05-14T10:00:00Z',
            });
            const baseChain = snapshotA.chains[0]!;
            const snapshotB = makeSnapshot({
                underlyingPrice: 215, // 가격 흔들림
                capturedAt: '2026-05-14T10:05:30Z', // 폴링 직후
                chains: [
                    {
                        ...baseChain,
                        calls: baseChain.calls.map(c => ({
                            ...c,
                            openInterest: c.openInterest + 250, // OI 변동
                        })),
                        puts: baseChain.puts.map(p => ({
                            ...p,
                            openInterest: p.openInterest + 250,
                        })),
                    },
                ],
            });

            await submitOptionsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                expirationDate: '2026-06-20',
                snapshot: snapshotA,
            });
            await submitOptionsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                expirationDate: '2026-06-20',
                snapshot: snapshotB,
            });

            expect(mockCacheGet).toHaveBeenCalledTimes(2);
            const firstKey = mockCacheGet.mock.calls[0]?.[0];
            const secondKey = mockCacheGet.mock.calls[1]?.[0];
            expect(firstKey).toBe(secondKey);
        });

        it("expirationDate가 'all'일 때 fast-moving 필드 변경은 같은 키, 만기 구조 변경은 다른 키로 가야 한다", async () => {
            // 'all' 분기는 모든 chain을 hash에 포함한다. 두 가지 시맨틱을 함께 검증:
            //   (1) underlyingPrice/capturedAt/OI 같은 fast-moving 변동은 hit
            //       유지 (구체 만기 분기와 동일한 cache-stability 시맨틱).
            //   (2) 새 만기 추가/제거 같은 구조적 변경은 cache miss로 빠져
            //       새 LLM 호출을 트리거 (시장 풍경이 달라졌으므로 재분석 필요).
            mockCacheGet.mockResolvedValue(mockCachedResult);

            const snapshotBaseline = makeSnapshot();
            const snapshotFastMoving = makeSnapshot({
                underlyingPrice: 215,
                capturedAt: '2026-05-14T10:05:30Z',
            });
            const baselineChain = snapshotBaseline.chains[0]!;
            const snapshotWithExtraChain = makeSnapshot({
                chains: [
                    baselineChain,
                    {
                        expirationDate: '2026-07-18',
                        daysToExpiration: 65,
                        calls: [],
                        puts: [],
                    },
                ],
            });

            await submitOptionsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                expirationDate: 'all',
                snapshot: snapshotBaseline,
            });
            await submitOptionsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                expirationDate: 'all',
                snapshot: snapshotFastMoving,
            });
            await submitOptionsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                expirationDate: 'all',
                snapshot: snapshotWithExtraChain,
            });

            expect(mockCacheGet).toHaveBeenCalledTimes(3);
            const keyBaseline = mockCacheGet.mock.calls[0]?.[0];
            const keyFastMoving = mockCacheGet.mock.calls[1]?.[0];
            const keyExtraChain = mockCacheGet.mock.calls[2]?.[0];
            expect(keyBaseline).toBe(keyFastMoving);
            expect(keyBaseline).not.toBe(keyExtraChain);
        });
    });

    // ── 2. Cache miss + enqueues ──
    describe('캐시 미스일 때', () => {
        // Production code logs to console.error on cache-read failure and
        // setJobMeta failure (fail-open paths). Silence these spy
        // implementations so the error-path tests below do not flood stderr.
        let errorSpy: ReturnType<typeof vi.spyOn>;
        beforeEach(() => {
            mockCacheGet.mockResolvedValueOnce(null);
            errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        });
        afterEach(() => {
            errorSpy.mockRestore();
        });

        it('캐시 읽기 중 에러가 발생해도 submitted로 진행한다', async () => {
            mockCacheGet.mockReset();
            mockCacheGet.mockRejectedValueOnce(new Error('Redis down'));

            const result = await submitOptionsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                expirationDate: '2026-06-20',
                snapshot: makeSnapshot(),
            });

            expect(result.status).toBe('submitted');
            if (result.status === 'submitted') {
                expect(typeof result.jobId).toBe('string');
            }
            expect(mockFireAndForget).toHaveBeenCalled();
        });

        it('cache 프로바이더가 null이면 캐시 체크를 건너뛰고 submitted로 진행한다', async () => {
            mockCreateCacheProvider.mockReturnValueOnce(null);
            // 이 경로에서는 mockCacheGet이 호출되지 않는다.
            mockCacheGet.mockReset();

            const result = await submitOptionsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                expirationDate: '2026-06-20',
                snapshot: makeSnapshot(),
            });

            expect(result.status).toBe('submitted');
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockFireAndForget).toHaveBeenCalled();
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
            expect(body.analysisType).toBe('options');
            expect(body.system).toBe(OPTIONS_SYSTEM_PROMPT);
            expect(body.seed).toBe(analysisSeed(body.prompt as string));
        });

        it('setJobMeta가 실패해도 submitted를 반환한다 (fail-open)', async () => {
            mockSetJobMeta.mockRejectedValueOnce(new Error('redis down'));

            const result = await submitOptionsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                expirationDate: '2026-06-20',
                snapshot: makeSnapshot(),
            });

            expect(result.status).toBe('submitted');
            if (result.status === 'submitted') {
                expect(typeof result.jobId).toBe('string');
            }
            expect(mockFireAndForget).toHaveBeenCalled();
        });

        it('워커 dispatch가 reject되어도 submitted를 반환한다 (fail-open)', async () => {
            // Covers the `fetch(...).catch(error => console.error(...))`
            // branch on line ~258 — worker dispatch is fire-and-forget so a
            // rejected fetch must not surface to the caller.
            mockFetch.mockRejectedValueOnce(new Error('network unreachable'));

            const result = await submitOptionsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                expirationDate: '2026-06-20',
                snapshot: makeSnapshot(),
            });

            expect(result.status).toBe('submitted');
            if (result.status === 'submitted') {
                expect(typeof result.jobId).toBe('string');
            }
            expect(mockFireAndForget).toHaveBeenCalled();
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
            mockCacheGet.mockResolvedValueOnce(null);

            const result = await submitOptionsAnalysis({
                symbol: 'AAPL',
                modelId: 'gemini-2.5-flash',
                expirationDate: '2026-06-20',
                snapshot: makeSnapshot(),
                tier: 'free',
                tierConfig: RESTRICTED_TIER_CONFIG,
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
