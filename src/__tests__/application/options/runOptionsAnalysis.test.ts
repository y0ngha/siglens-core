import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/application/analysis/callAnalysisAi');
vi.mock('@/infrastructure/cache/redis');

import { runOptionsAnalysis } from '@/application/options/runOptionsAnalysis';
import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { OPTIONS_CACHE_TTL_SECONDS } from '@/infrastructure/cache/config';
import { TEST_TIER_CONFIG } from '@/__tests__/helpers/testTierConfig';
import type { OptionsSnapshot, TierConfig, TierModel } from '@/domain/types';

const mockCallAnalysisAi = callAnalysisAi as Mock;
const mockCreateCacheProvider = createCacheProvider as Mock;

const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheProvider = {
    get: mockCacheGet,
    set: mockCacheSet,
    delete: vi.fn(),
};

const mockModelId: TierModel = 'gemini-3.6-flash';

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

const mockRawResult = {
    summaryKo: '옵션 시장 중립.',
    sentiment: 'neutral' as const,
    keyObservationsKo: [],
    strategySuggestionsKo: [],
};

function baseArgs() {
    return {
        symbol: 'AAPL',
        modelId: mockModelId,
        snapshot: makeSnapshot(),
        expirationDate: 'all' as const,
    };
}

describe('runOptionsAnalysis', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockCacheGet.mockResolvedValue(null);
        mockCacheSet.mockResolvedValue(undefined);
        mockCallAnalysisAi.mockResolvedValue(JSON.stringify(mockRawResult));
    });

    describe('no-chains guard', () => {
        it('사용 가능한 체인이 없으면 LLM 전에 거른다', async () => {
            const result = await runOptionsAnalysis({
                ...baseArgs(),
                snapshot: makeSnapshot({ chains: [] }),
            });

            expect(result.status).toBe('no_chains_error');
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });

        it('요청한 만기가 스냅샷에 없으면 거른다', async () => {
            const result = await runOptionsAnalysis({
                ...baseArgs(),
                expirationDate: '2099-01-01',
            });

            expect(result.status).toBe('no_chains_error');
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });
    });

    describe('options.cache 주입', () => {
        const injectedGet = vi.fn();
        const injectedSet = vi.fn();
        const injectedCache = {
            get: injectedGet,
            set: injectedSet,
            delete: vi.fn(),
        };

        beforeEach(() => {
            injectedGet.mockReset();
            injectedSet.mockReset();
            injectedGet.mockResolvedValue(null);
            injectedSet.mockResolvedValue(undefined);
        });

        it('주입한 캐시에서 읽고, env 캐시는 만들지도 읽지도 않는다', async () => {
            injectedGet.mockResolvedValueOnce(mockRawResult);

            const result = await runOptionsAnalysis({
                ...baseArgs(),
                cache: injectedCache,
            });

            expect(result.status).toBe('cached');
            expect(injectedGet).toHaveBeenCalledTimes(1);
            expect(mockCreateCacheProvider).not.toHaveBeenCalled();
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });

        it('cache: null 이면 env 캐시로 폴백하지 않고 캐시 없이 실행한다', async () => {
            const result = await runOptionsAnalysis({
                ...baseArgs(),
                cache: null,
            });

            expect(result.status).toBe('done');
            expect(mockCreateCacheProvider).not.toHaveBeenCalled();
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockCacheSet).not.toHaveBeenCalled();
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
        });
    });

    describe('cache hit', () => {
        it('cache hit → callAnalysisAi NOT called, returns {status:"cached"}', async () => {
            mockCacheGet.mockResolvedValueOnce(mockRawResult);

            const result = await runOptionsAnalysis(baseArgs());

            expect(result.status).toBe('cached');
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });
    });

    describe('cache miss → LLM', () => {
        it('callAnalysisAi를 1회 호출하고 done을 반환한다', async () => {
            const result = await runOptionsAnalysis(baseArgs());

            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(result.status).toBe('done');
        });

        it('signal을 callAnalysisAi에 그대로 전달한다', async () => {
            const controller = new AbortController();

            await runOptionsAnalysis({
                ...baseArgs(),
                signal: controller.signal,
            });

            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ signal: controller.signal })
            );
        });

        it('providerFallback is forwarded to callAnalysisAi as fallbackOnProviderFailure', async () => {
            await runOptionsAnalysis({
                ...baseArgs(),
                providerFallback: true,
            });

            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ fallbackOnProviderFailure: true })
            );
        });

        it('결과를 OPTIONS_CACHE_TTL_SECONDS로 캐시에 기록한다', async () => {
            await runOptionsAnalysis(baseArgs());

            expect(mockCacheSet).toHaveBeenCalledWith(
                expect.any(String),
                expect.anything(),
                OPTIONS_CACHE_TTL_SECONDS
            );
        });
    });

    describe('skipEnqueueIfMiss (봇 경로)', () => {
        it('캐시 미스 + skipEnqueueIfMiss → LLM을 태우지 않는다', async () => {
            const result = await runOptionsAnalysis({
                ...baseArgs(),
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

            const both = Promise.all([
                runOptionsAnalysis(baseArgs()),
                runOptionsAnalysis(baseArgs()),
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
            await runOptionsAnalysis(baseArgs());
            const omitted = sentOf();
            mockCallAnalysisAi.mockClear();
            await runOptionsAnalysis({ ...baseArgs(), locale: 'ko' });
            expect(sentOf()).toEqual(omitted);
        });

        it.each(['en', 'ja', 'zh'] as const)(
            '%s: 프롬프트 말미에 출력 언어 리마인더가 붙는다',
            async locale => {
                await runOptionsAnalysis({ ...baseArgs(), locale });
                expect(sentOf().prompt).toContain(
                    'OUTPUT LANGUAGE (FINAL, OVERRIDES EVERYTHING ABOVE)'
                );
            }
        );
    });

    describe('만기 필터 (특정 expirationDate)', () => {
        function twoChainSnapshot(secondChainCalls = 1): OptionsSnapshot {
            const base = makeSnapshot();
            const [first] = base.chains;
            return {
                ...base,
                chains: [
                    first,
                    {
                        ...first,
                        expirationDate: '2026-07-18',
                        daysToExpiration: 65,
                        calls: first.calls.slice(0, secondChainCalls),
                    },
                ],
            };
        }

        it('특정 만기를 요청하면 done을 반환하고 캐시 키에 해당 만기를 담는다', async () => {
            const result = await runOptionsAnalysis({
                ...baseArgs(),
                snapshot: twoChainSnapshot(),
                expirationDate: '2026-06-20',
            });

            expect(result.status).toBe('done');
            const [cacheKey] = mockCacheSet.mock.calls[0] as [string];
            expect(cacheKey).toContain(':options:AAPL:2026-06-20:');
        });

        it('대상 외 만기의 체인 구성이 바뀌어도 캐시 키는 같다 (대상 만기만 해시)', async () => {
            await runOptionsAnalysis({
                ...baseArgs(),
                snapshot: twoChainSnapshot(1),
                expirationDate: '2026-06-20',
            });
            await runOptionsAnalysis({
                ...baseArgs(),
                snapshot: twoChainSnapshot(2),
                expirationDate: '2026-06-20',
            });

            const [keyA] = mockCacheGet.mock.calls[0] as [string];
            const [keyB] = mockCacheGet.mock.calls[1] as [string];
            expect(keyA).toBe(keyB);
        });

        it("'all'이면 모든 체인 구성이 해시에 반영되어 캐시 키가 달라진다", async () => {
            await runOptionsAnalysis({
                ...baseArgs(),
                snapshot: twoChainSnapshot(1),
            });
            await runOptionsAnalysis({
                ...baseArgs(),
                snapshot: twoChainSnapshot(2),
            });

            const [keyA] = mockCacheGet.mock.calls[0] as [string];
            const [keyB] = mockCacheGet.mock.calls[1] as [string];
            expect(keyA).not.toBe(keyB);
        });
    });

    describe('체인 sanitize', () => {
        /** 음수 OI 계약 2건 이상 → sanitizeOptionsChain이 체인 전체를 거부한다. */
        function corruptedSnapshot(): OptionsSnapshot {
            const base = makeSnapshot();
            const [chain] = base.chains;
            return {
                ...base,
                chains: [
                    {
                        ...chain,
                        calls: chain.calls.map(c => ({
                            ...c,
                            openInterest: -1,
                        })),
                    },
                ],
            };
        }

        it('모든 체인이 불량 데이터로 거부되면 no_chains_error를 반환하고 캐시도 조회하지 않는다', async () => {
            const result = await runOptionsAnalysis({
                ...baseArgs(),
                snapshot: corruptedSnapshot(),
            });

            expect(result).toEqual({
                status: 'no_chains_error',
                code: 'no_options_chains',
                error: 'snapshot has no usable options chains',
            });
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });

        it('요청 만기 누락 에러 메시지에 해당 만기를 담는다', async () => {
            const result = await runOptionsAnalysis({
                ...baseArgs(),
                expirationDate: '2099-01-01',
            });

            expect(result).toEqual({
                status: 'no_chains_error',
                code: 'no_options_chains',
                error: 'expiration 2099-01-01 not present in snapshot',
            });
            expect(mockCacheGet).not.toHaveBeenCalled();
        });
    });

    describe('캐시 경로 세부', () => {
        it('force: true면 캐시를 조회하지 않고 LLM을 태운 뒤 결과를 다시 기록한다', async () => {
            mockCacheGet.mockResolvedValue(mockRawResult);

            const result = await runOptionsAnalysis({
                ...baseArgs(),
                force: true,
            });

            expect(result.status).toBe('done');
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(mockCacheSet).toHaveBeenCalledTimes(1);
        });

        it('캐시 provider가 없으면(null) 캐시 없이 LLM 결과를 반환한다', async () => {
            mockCreateCacheProvider.mockReturnValue(null);

            const result = await runOptionsAnalysis(baseArgs());

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

            const result = await runOptionsAnalysis(baseArgs());

            expect(result.status).toBe('done');
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(errorSpy).toHaveBeenCalledWith(
                '[RunOptions] Cache read failed:',
                expect.any(Error)
            );
            errorSpy.mockRestore();
        });

        it('캐시 쓰기가 실패해도 done을 반환하고 에러를 로그로 남긴다', async () => {
            const errorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            mockCacheSet.mockRejectedValueOnce(new Error('write failed'));

            const result = await runOptionsAnalysis(baseArgs());

            expect(result.status).toBe('done');
            await vi.waitFor(() =>
                expect(errorSpy).toHaveBeenCalledWith(
                    '[RunOptions] Cache write failed:',
                    expect.any(Error)
                )
            );
            errorSpy.mockRestore();
        });

        it('캐시 히트여도 usage를 1회 기록한다', async () => {
            mockCacheGet.mockResolvedValueOnce(mockRawResult);
            const recordUsage = vi.fn().mockResolvedValue(undefined);

            const result = await runOptionsAnalysis({
                ...baseArgs(),
                usage: {
                    usageRepository: {
                        recordUsage,
                        getUsageToday: vi.fn(),
                    },
                    clientIp: '10.0.0.1',
                },
            });

            expect(result.status).toBe('cached');
            expect(recordUsage).toHaveBeenCalledTimes(1);
            expect(recordUsage).toHaveBeenCalledWith(
                expect.objectContaining({
                    actionType: 'analysis',
                    modelUsed: mockModelId,
                })
            );
        });
    });

    describe('BYOK gate', () => {
        it('비-pro 티어 + BYOK 모델 + userApiKey 없음 → key_error, LLM 미호출', async () => {
            const result = await runOptionsAnalysis({
                ...baseArgs(),
                modelId: 'gemini-3.1-pro-preview',
                tier: 'member',
                tierConfig: TEST_TIER_CONFIG,
            });

            expect(result).toMatchObject({
                status: 'key_error',
                code: 'user_api_key_required',
                modelId: 'gemini-3.1-pro-preview',
                tier: 'member',
            });
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });

        it('BYOK 게이트는 캐시 히트를 막지 않는다', async () => {
            mockCacheGet.mockResolvedValueOnce(mockRawResult);

            const result = await runOptionsAnalysis({
                ...baseArgs(),
                modelId: 'gemini-3.1-pro-preview',
                tier: 'member',
                tierConfig: TEST_TIER_CONFIG,
            });

            expect(result.status).toBe('cached');
        });

        it('userApiKey가 있으면 통과하고 키를 callAnalysisAi에 전달한다', async () => {
            const result = await runOptionsAnalysis({
                ...baseArgs(),
                modelId: 'gemini-3.1-pro-preview',
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

        it('일일 한도에 도달하면 limit_error를 반환하고 LLM·usage 기록을 건너뛴다', async () => {
            const usage = makeUsage(1);

            const result = await runOptionsAnalysis({
                ...baseArgs(),
                tier: 'free',
                tierConfig: LIMITED_TIER_CONFIG,
                usage,
            });

            expect(result).toMatchObject({
                status: 'limit_error',
                code: 'usage_limit_exceeded',
                error: { code: 'analysis_limit_exceeded', tier: 'free' },
            });
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
            expect(usage.usageRepository.recordUsage).not.toHaveBeenCalled();
        });

        it('한도 미만이면 LLM을 태우고 usage를 기록한다', async () => {
            const usage = makeUsage(0);

            const result = await runOptionsAnalysis({
                ...baseArgs(),
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

            const result = await runOptionsAnalysis({
                ...baseArgs(),
                tierConfig: LIMITED_TIER_CONFIG,
                usage,
            });

            expect(result.status).toBe('done');
            expect(usage.usageRepository.getUsageToday).not.toHaveBeenCalled();
        });

        it('usage 없이 tier만 주면 한도 조회 없이 진행한다', async () => {
            const result = await runOptionsAnalysis({
                ...baseArgs(),
                tier: 'free',
                tierConfig: LIMITED_TIER_CONFIG,
            });

            expect(result.status).toBe('done');
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
        });
    });

    describe('모델 해석', () => {
        it('MODEL_SPECS에 없는 (폐기된) 모델 ID는 deepseek-v4.1-flash로 호출한다', async () => {
            const legacyModel = 'legacy-retired-model' as TierModel;

            const result = await runOptionsAnalysis({
                ...baseArgs(),
                modelId: legacyModel,
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
        it('summary·perExpiration·signals가 모두 비면 경고를 남기되 결과는 캐시에 기록한다', async () => {
            const warnSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => {});
            mockCallAnalysisAi.mockResolvedValueOnce(
                JSON.stringify({ summary: '', perExpiration: [], signals: [] })
            );

            const result = await runOptionsAnalysis(baseArgs());

            expect(result.status).toBe('done');
            expect(warnSpy).toHaveBeenCalledWith(
                '[RunOptions] Empty options analysis',
                { symbol: 'AAPL' }
            );
            expect(mockCacheSet).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ summary: '' }),
                OPTIONS_CACHE_TTL_SECONDS
            );
            warnSpy.mockRestore();
        });

        it.each([
            [
                'perExpiration만 있음',
                {
                    summary: '',
                    perExpiration: [
                        {
                            expirationDate: '2026-06-20',
                            commentary: '중립',
                            tone: 'neutral',
                        },
                    ],
                    signals: [],
                },
            ],
            [
                'signals만 있음',
                {
                    summary: '',
                    perExpiration: [],
                    signals: [{ kind: 'bullish', message: '콜 OI 증가' }],
                },
            ],
        ])(
            'summary가 비어도 %s이면 빈 응답 경고를 남기지 않는다',
            async (_label, raw) => {
                const warnSpy = vi
                    .spyOn(console, 'warn')
                    .mockImplementation(() => {});
                mockCallAnalysisAi.mockResolvedValueOnce(JSON.stringify(raw));

                const result = await runOptionsAnalysis(baseArgs());

                expect(result.status).toBe('done');
                expect(warnSpy).not.toHaveBeenCalled();
                warnSpy.mockRestore();
            }
        );
    });
});
