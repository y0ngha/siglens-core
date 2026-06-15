import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarketDataProvider } from '@/domain/ports/marketDataProvider';
import type { IndexTicker, MarketQuote, SectorEtf } from '@/domain/types';

const mockGetQuote = vi.fn<(s: string) => Promise<MarketQuote | null>>();
const mockGetBars = vi.fn();

const fakeProvider: MarketDataProvider = {
    getQuote: mockGetQuote,
    getBars: mockGetBars,
};

import { getMarketSummary } from '@/application/dashboard/getMarketSummary';

const MARKET_INDICES: readonly IndexTicker[] = [
    {
        symbol: 'GSPC',
        fmpSymbol: '^GSPC',
        displayName: 'S&P 500',
        koreanName: '미국 대형주 500',
    },
];
const SECTOR_ETFS: readonly SectorEtf[] = [
    { symbol: 'XLK', sectorName: 'Technology', koreanName: '기술' },
];

describe('getMarketSummary', () => {
    beforeEach(() => {
        mockGetQuote.mockReset();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('각 indices 에 quote 매핑 → price/changesPercentage 포함', async () => {
        mockGetQuote.mockImplementation(async sym =>
            sym === '^GSPC'
                ? {
                      symbol: '^GSPC',
                      price: 5000,
                      changesPercentage: 1.5,
                      name: 'S&P 500',
                  }
                : null
        );
        const result = await getMarketSummary(
            fakeProvider,
            MARKET_INDICES,
            SECTOR_ETFS
        );
        const sp500 = result.indices.find(i => i.symbol === 'GSPC');
        expect(sp500).toMatchObject({ price: 5000, changesPercentage: 1.5 });
    });

    it('quote 가 없으면 price/changesPercentage 가 0', async () => {
        mockGetQuote.mockResolvedValue(null);
        const result = await getMarketSummary(
            fakeProvider,
            MARKET_INDICES,
            SECTOR_ETFS
        );
        expect(result.indices).toHaveLength(MARKET_INDICES.length);
        expect(result.sectors).toHaveLength(SECTOR_ETFS.length);
        result.indices.forEach(idx => {
            expect(idx.price).toBe(0);
            expect(idx.changesPercentage).toBe(0);
        });
    });

    it('sector ETF quote 매핑', async () => {
        mockGetQuote.mockImplementation(async sym =>
            sym === 'XLK'
                ? {
                      symbol: 'XLK',
                      price: 200,
                      changesPercentage: -0.5,
                      name: 'Technology',
                  }
                : null
        );
        const result = await getMarketSummary(
            fakeProvider,
            MARKET_INDICES,
            SECTOR_ETFS
        );
        const xlk = result.sectors.find(s => s.symbol === 'XLK');
        expect(xlk).toMatchObject({ price: 200, changesPercentage: -0.5 });
    });
});
