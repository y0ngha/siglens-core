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

    describe('cache hit', () => {
        it('cache hit → callBriefingAi NOT called, returns {status:"cached"}', async () => {
            mockCacheGet.mockResolvedValueOnce({
                briefing: mockCachedBriefing,
                generatedAt: '2026-08-02T10:00:00.000Z',
            });

            const result = await runBriefing(MARKET_DATA);

            expect(result.status).toBe('cached');
            expect(mockCallBriefingAi).not.toHaveBeenCalled();
        });

        it('캐시 히트 시 generatedAt을 그대로 반환한다', async () => {
            const generatedAt = '2026-08-02T10:00:00.000Z';
            mockCacheGet.mockResolvedValueOnce({
                briefing: mockCachedBriefing,
                generatedAt,
            });

            const result = await runBriefing(MARKET_DATA);

            if (result.status === 'cached') {
                expect(result.generatedAt).toBe(generatedAt);
            }
        });
    });

    describe('cache miss → LLM', () => {
        it('callBriefingAi를 1회 호출하고 done을 반환한다', async () => {
            const result = await runBriefing(MARKET_DATA);

            expect(mockCallBriefingAi).toHaveBeenCalledTimes(1);
            expect(result.status).toBe('done');
        });

        it('signal을 callBriefingAi에 그대로 전달한다', async () => {
            const controller = new AbortController();

            await runBriefing(MARKET_DATA, { signal: controller.signal });

            expect(mockCallBriefingAi).toHaveBeenCalledWith(
                expect.objectContaining({ signal: controller.signal })
            );
        });

        it('결과를 MARKET_BRIEFING_CACHE_TTL로 캐시에 기록한다', async () => {
            await runBriefing(MARKET_DATA);

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

            const result = await runBriefing(MARKET_DATA);

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
                runBriefing(MARKET_DATA),
                runBriefing(MARKET_DATA),
            ]);

            resolveAi(JSON.stringify(mockBriefingRaw));
            const [a, b] = await both;

            expect(mockCallBriefingAi).toHaveBeenCalledTimes(1);
            expect(a.status).toBe('done');
            expect(b.status).toBe('done');
        });
    });
});
