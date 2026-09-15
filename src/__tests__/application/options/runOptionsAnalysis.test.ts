import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/application/analysis/callAnalysisAi');
vi.mock('@/infrastructure/cache/redis');

import { runOptionsAnalysis } from '@/application/options/runOptionsAnalysis';
import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { OPTIONS_CACHE_TTL_SECONDS } from '@/infrastructure/cache/config';
import type { OptionsSnapshot, TierModel } from '@/domain/types';

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
});
