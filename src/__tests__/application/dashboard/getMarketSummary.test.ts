import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarketDataProvider } from '@/domain/ports/marketDataProvider';
import type { MarketQuote } from '@/domain/types';

const mockGetQuote = vi.fn<(s: string) => Promise<MarketQuote | null>>();
const mockGetBars = vi.fn();

const fakeProvider: MarketDataProvider = {
    getQuote: mockGetQuote,
    getBars: mockGetBars,
};

import { getMarketSummary } from '@/application/dashboard/getMarketSummary';
import {
    MARKET_INDICES,
    SECTOR_ETFS,
} from '@/domain/constants/dashboard-tickers';

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
        const result = await getMarketSummary(fakeProvider);
        const sp500 = result.indices.find(i => i.symbol === 'GSPC');
        expect(sp500).toMatchObject({ price: 5000, changesPercentage: 1.5 });
    });

    it('quote 가 없으면 price/changesPercentage 가 0', async () => {
        mockGetQuote.mockResolvedValue(null);
        const result = await getMarketSummary(fakeProvider);
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
        const result = await getMarketSummary(fakeProvider);
        const xlk = result.sectors.find(s => s.symbol === 'XLK');
        expect(xlk).toMatchObject({ price: 200, changesPercentage: -0.5 });
    });
});
