import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/application/analysis/callBriefingAi');
vi.mock('@/infrastructure/cache/redis');

import { runBriefing } from '@/application/market/runBriefing';
import { callBriefingAi } from '@/application/analysis/callBriefingAi';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { MARKET_BRIEFING_CACHE_TTL } from '@/infrastructure/cache/config';
import type { MarketSummaryData } from '@/domain/types';

const mockCallBriefingAi = callBriefingAi as Mock;
const mockCreateCacheProvider = createCacheProvider as Mock;

const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheProvider = {
    get: mockCacheGet,
    set: mockCacheSet,
    delete: vi.fn(),
};

const mockBriefingRaw = {
    summary: '시장 전반 상승세.',
    highlights: ['나스닥 강세'],
    regime: 'risk_on',
};

const mockCachedBriefing = {
    summary: '캐시된 브리핑.',
    highlights: [],
    regime: 'neutral',
};

/** Minimal MarketSummaryData — hash is stable across identical inputs. */
const MARKET_DATA: MarketSummaryData = {
    indices: [
        {
            symbol: 'SPY',
            fmpSymbol: '^GSPC',
            displayName: 'S&P 500',
            koreanName: 'S&P 500',
            price: 500,
            changesPercentage: 0.5,
        } as MarketSummaryData['indices'][number],
    ],
    sectors: [],
};

const US_CONTEXT = {
    marketLabel: '미국 증시',
    volatility: { label: 'VIX', level: 18.3 },
} as const;

describe('runBriefing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-02T10:00:00.000Z'));
        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockCacheGet.mockResolvedValue(null);
        mockCacheSet.mockResolvedValue(undefined);
        mockCallBriefingAi.mockResolvedValue(JSON.stringify(mockBriefingRaw));
    });

    afterEach(() => {
        vi.useRealTimers();
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
            injectedGet.mockResolvedValueOnce({
                briefing: mockCachedBriefing,
                generatedAt: '2026-08-02T10:00:00.000Z',
            });

            const result = await runBriefing(MARKET_DATA, US_CONTEXT, {
                cache: injectedCache,
            });

            expect(result.status).toBe('cached');
            expect(injectedGet).toHaveBeenCalledTimes(1);
            expect(mockCreateCacheProvider).not.toHaveBeenCalled();
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockCallBriefingAi).not.toHaveBeenCalled();
        });

        it('cache: null 이면 env 캐시로 폴백하지 않고 캐시 없이 실행한다', async () => {
            const result = await runBriefing(MARKET_DATA, US_CONTEXT, {
                cache: null,
            });

            expect(result.status).toBe('done');
            expect(mockCreateCacheProvider).not.toHaveBeenCalled();
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockCacheSet).not.toHaveBeenCalled();
            expect(mockCallBriefingAi).toHaveBeenCalledTimes(1);
        });
    });

    describe('cache hit', () => {
        it('cache hit → callBriefingAi NOT called, returns {status:"cached"}', async () => {
            mockCacheGet.mockResolvedValueOnce({
                briefing: mockCachedBriefing,
                generatedAt: '2026-08-02T10:00:00.000Z',
            });

            const result = await runBriefing(MARKET_DATA, US_CONTEXT);

            expect(result.status).toBe('cached');
            expect(mockCallBriefingAi).not.toHaveBeenCalled();
        });

        it('캐시 히트 시 generatedAt을 그대로 반환한다', async () => {
            const generatedAt = '2026-08-02T10:00:00.000Z';
            mockCacheGet.mockResolvedValueOnce({
                briefing: mockCachedBriefing,
                generatedAt,
            });

            const result = await runBriefing(MARKET_DATA, US_CONTEXT);

            if (result.status === 'cached') {
                expect(result.generatedAt).toBe(generatedAt);
            }
        });
    });

    describe('cache miss → LLM', () => {
        it('callBriefingAi를 1회 호출하고 done을 반환한다', async () => {
            const result = await runBriefing(MARKET_DATA, US_CONTEXT);

            expect(mockCallBriefingAi).toHaveBeenCalledTimes(1);
            expect(result.status).toBe('done');
        });

        it('signal을 callBriefingAi에 그대로 전달한다', async () => {
            const controller = new AbortController();

            await runBriefing(MARKET_DATA, US_CONTEXT, {
                signal: controller.signal,
            });

            expect(mockCallBriefingAi).toHaveBeenCalledWith(
                expect.objectContaining({ signal: controller.signal })
            );
        });

        it('결과를 MARKET_BRIEFING_CACHE_TTL로 캐시에 기록한다', async () => {
            await runBriefing(MARKET_DATA, US_CONTEXT);

            expect(mockCacheSet).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    briefing: expect.any(Object),
                    generatedAt: expect.any(String),
                }),
                MARKET_BRIEFING_CACHE_TTL
            );
        });
    });

    describe('캐시 프로바이더 없음', () => {
        it('cache provider null이면 조회 건너뛰고 LLM을 호출한다', async () => {
            mockCreateCacheProvider.mockReturnValueOnce(null);

            const result = await runBriefing(MARKET_DATA, US_CONTEXT);

            expect(result.status).toBe('done');
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockCallBriefingAi).toHaveBeenCalledTimes(1);
        });
    });

    describe('in-flight 중복 제거', () => {
        it('같은 캐시 키 동시 호출은 LLM을 1회만 태운다', async () => {
            let resolveAi: (value: string) => void = () => {};
            mockCallBriefingAi.mockReturnValueOnce(
                new Promise<string>(resolve => {
                    resolveAi = resolve;
                })
            );

            const both = Promise.all([
                runBriefing(MARKET_DATA, US_CONTEXT),
                runBriefing(MARKET_DATA, US_CONTEXT),
            ]);

            resolveAi(JSON.stringify(mockBriefingRaw));
            const [a, b] = await both;

            expect(mockCallBriefingAi).toHaveBeenCalledTimes(1);
            expect(a.status).toBe('done');
            expect(b.status).toBe('done');
        });
    });

    /**
     * `runBriefing`이 호출자의 context를 프롬프트까지 넘기는지 확인한다.
     *
     * 이 단언이 없으면 빌더 호출부를 하드코딩 리터럴로 바꿔도 스위트가 초록으로
     * 남는다 — 프롬프트 빌더 테스트는 빌더가 context를 지킨다는 것만 증명하고,
     * 캐시 키 테스트는 region이 해시에 닿는다는 것만 증명한다.
     */
    describe('context 전달', () => {
        it('marketLabel이 프롬프트에 실린다', async () => {
            await runBriefing(MARKET_DATA, {
                marketLabel: '한국 증시',
                volatility: null,
            });

            const { prompt } = mockCallBriefingAi.mock.calls.at(-1)![0] as {
                prompt: string;
            };
            expect(prompt).toContain('한국 증시');
        });

        it('volatility: null이면 변동성 스키마가 빠진다', async () => {
            await runBriefing(MARKET_DATA, {
                marketLabel: '한국 증시',
                volatility: null,
            });

            const { prompt } = mockCallBriefingAi.mock.calls.at(-1)![0] as {
                prompt: string;
            };
            expect(prompt).not.toContain('"volatilityAnalysis": {');
        });

        it('volatility가 있으면 그 값이 프롬프트에 박힌다', async () => {
            await runBriefing(MARKET_DATA, {
                marketLabel: '미국 증시',
                volatility: { label: 'VIX', level: 21.7 },
            });

            const { prompt } = mockCallBriefingAi.mock.calls.at(-1)![0] as {
                prompt: string;
            };
            expect(prompt).toContain('"vixLevel": 21.7');
        });
    });

    describe('캐시 장애 내성', () => {
        it('캐시 조회가 실패하면 로그만 남기고 LLM 브리핑 후 같은 키로 캐시에 기록한다', async () => {
            const errorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => undefined);
            mockCacheGet.mockRejectedValueOnce(new Error('redis down'));

            const result = await runBriefing(MARKET_DATA, US_CONTEXT);

            expect(result.status).toBe('done');
            expect(result.briefing.summary).toBe(mockBriefingRaw.summary);
            expect(mockCallBriefingAi).toHaveBeenCalledTimes(1);
            expect(mockCacheSet).toHaveBeenCalledWith(
                mockCacheGet.mock.calls[0][0],
                {
                    briefing: result.briefing,
                    generatedAt: '2026-08-02T10:00:00.000Z',
                },
                MARKET_BRIEFING_CACHE_TTL
            );
            expect(errorSpy).toHaveBeenCalledWith(
                '[RunBriefing] Cache read failed:',
                expect.any(Error)
            );
            errorSpy.mockRestore();
        });

        it('캐시 쓰기가 실패해도 브리핑은 그대로 반환되고 오류는 로그로만 남는다', async () => {
            const errorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => undefined);
            const writeError = new Error('redis write failed');
            mockCacheSet.mockRejectedValueOnce(writeError);

            const result = await runBriefing(MARKET_DATA, US_CONTEXT);

            expect(result.status).toBe('done');
            expect(result.briefing.summary).toBe(mockBriefingRaw.summary);
            await vi.waitFor(() =>
                expect(errorSpy).toHaveBeenCalledWith(
                    '[RunBriefing] Cache write failed:',
                    writeError
                )
            );
            errorSpy.mockRestore();
        });
    });

    describe('빈 브리핑', () => {
        it('LLM 응답에 summary가 없으면 경고를 남기고 빈 summary로 done을 반환한다', async () => {
            const warnSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => undefined);
            mockCallBriefingAi.mockResolvedValueOnce(
                JSON.stringify({ highlights: ['부분 응답'] })
            );

            const result = await runBriefing(MARKET_DATA, US_CONTEXT);

            expect(result.status).toBe('done');
            expect(result.briefing.summary).toBe('');
            expect(warnSpy).toHaveBeenCalledWith(
                '[RunBriefing] Empty briefing — summary field absent'
            );
            warnSpy.mockRestore();
        });

        it('summary가 있으면 빈 브리핑 경고를 남기지 않는다', async () => {
            const warnSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => undefined);

            await runBriefing(MARKET_DATA, US_CONTEXT);

            expect(warnSpy).not.toHaveBeenCalled();
            warnSpy.mockRestore();
        });
    });

    describe('인스턴스 간 생성 dedupe', () => {
        it('다른 인스턴스가 생성 중이면 LLM을 부르지 않고 그 결과로 done을 반환한다', async () => {
            const peerRaw = JSON.stringify({
                ...mockBriefingRaw,
                summary: '다른 인스턴스가 만든 브리핑.',
            });
            const lockingProvider = {
                ...mockCacheProvider,
                setIfAbsent: vi.fn().mockResolvedValue(false),
                get: vi.fn(async (key: string) => {
                    if (key.includes(':lock:generation:')) return 'generating';
                    if (key.includes(':generation:raw:'))
                        return { raw: peerRaw };
                    return null;
                }),
            };
            mockCreateCacheProvider.mockReturnValue(lockingProvider);

            const pending = runBriefing(MARKET_DATA, US_CONTEXT);
            await vi.advanceTimersByTimeAsync(5_000);
            const result = await pending;

            expect(mockCallBriefingAi).not.toHaveBeenCalled();
            expect(result.status).toBe('done');
            expect(result.briefing.summary).toBe(
                '다른 인스턴스가 만든 브리핑.'
            );
        });
    });
});
