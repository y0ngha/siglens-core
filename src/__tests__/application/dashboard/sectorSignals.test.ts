import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bar, MarketQuote, SectorSignalsResult } from '@/domain/types';
import type { CacheProvider } from '@/domain/ports/cache';
import type { MarketDataProvider } from '@/domain/ports/marketDataProvider';

const mockCache: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
} = {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
};

const createCacheProviderMock = vi.fn<() => CacheProvider | null>();
const mockGetQuote = vi.fn<(s: string) => Promise<MarketQuote | null>>();
const mockGetBars = vi.fn<() => Promise<Bar[]>>();

vi.mock('@/infrastructure/cache/redis', () => ({
    createCacheProvider: () => createCacheProviderMock(),
}));

const fakeProvider: MarketDataProvider = {
    getQuote: mockGetQuote,
    getBars: mockGetBars,
};

import { getSectorSignals } from '@/application/dashboard/sectorSignals';

const fixedNow = new Date('2026-04-25T13:48:00.000Z');

describe('getSectorSignals', () => {
    beforeEach(() => {
        mockCache.get.mockReset();
        mockCache.set.mockReset();
        mockCache.set.mockResolvedValue(undefined);
        createCacheProviderMock.mockReset();
        createCacheProviderMock.mockReturnValue(mockCache);
        mockGetQuote.mockReset();
        mockGetQuote.mockResolvedValue(null);
        mockGetBars.mockReset();
        mockGetBars.mockResolvedValue([]);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('cache hit 시 cached payload 를 반환한다', async () => {
        const cached: SectorSignalsResult = {
            computedAt: fixedNow.toISOString(),
            stocks: [],
        };
        mockCache.get.mockResolvedValue(cached);

        const result = await getSectorSignals(fakeProvider, '1Day', fixedNow);
        expect(result).toBe(cached);
        expect(mockGetBars).not.toHaveBeenCalled();
    });

    it('cache miss 시 provider fetch 후 결과를 캐시에 저장한다', async () => {
        mockCache.get.mockResolvedValue(null);

        const result = await getSectorSignals(fakeProvider, '1Day', fixedNow);
        expect(result.computedAt).toBe(fixedNow.toISOString());
        expect(result.stocks).toEqual([]);
        expect(mockCache.set).toHaveBeenCalledTimes(1);
        const [key, payload, ttl] = mockCache.set.mock.calls[0];
        expect(key).toMatch(/^dashboard:signals:1Day:/);
        expect(payload).toEqual(result);
        expect(typeof ttl).toBe('number');
    });

    it('cache provider 가 null 이어도 정상 동작', async () => {
        createCacheProviderMock.mockReturnValue(null);
        const result = await getSectorSignals(fakeProvider, '1Day', fixedNow);
        expect(result.stocks).toEqual([]);
    });

    it('cache get 실패는 무시하고 provider 로 fallthrough', async () => {
        mockCache.get.mockRejectedValue(new Error('cache down'));
        const result = await getSectorSignals(fakeProvider, '1Day', fixedNow);
        expect(result.stocks).toEqual([]);
    });

    it('cache set 실패는 호출자에게 전파되지 않는다', async () => {
        mockCache.get.mockResolvedValue(null);
        mockCache.set.mockRejectedValue(new Error('cache write down'));
        await expect(
            getSectorSignals(fakeProvider, '1Day', fixedNow)
        ).resolves.toBeDefined();
    });

    it('default timeframe 은 1Day', async () => {
        mockCache.get.mockResolvedValue(null);
        await getSectorSignals(fakeProvider, undefined, fixedNow);
        const [key] = mockCache.set.mock.calls[0];
        expect(key).toMatch(/^dashboard:signals:1Day:/);
    });
});
