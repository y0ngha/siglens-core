import {
    MARKET_INDICES,
    MARKET_SUMMARY_FMP_SYMBOLS,
    SECTOR_ETFS,
} from '@/domain/constants/dashboard-tickers';
import type { MarketDataProvider } from '@/domain/ports/marketDataProvider';
import type { MarketQuote, MarketSummaryData } from '@/domain/types';

/**
 * Fetch real-time quotes for all dashboard market indices and sector ETFs.
 *
 * Issues one quote request per symbol in parallel via the configured market
 * data provider. Symbols that fail to fetch are emitted with `price` and
 * `changesPercentage` defaulted to `0` (so the dashboard renders fully even
 * if a single quote is unavailable).
 *
 * @param provider - Injected market data provider.
 * @returns Indices and sector ETFs with their most recent quote data —
 *   see {@link MarketSummaryData}.
 *
 * @see getMarketSummaryWithBriefing
 * @see getSectorSignals
 */
export async function getMarketSummary(
    provider: MarketDataProvider
): Promise<MarketSummaryData> {
    const quotes = await Promise.all(
        MARKET_SUMMARY_FMP_SYMBOLS.map(sym => provider.getQuote(sym))
    );

    const quoteMap = new Map<string, MarketQuote>(
        quotes
            .filter((q): q is MarketQuote => q !== null)
            .map(q => [q.symbol, q])
    );

    return {
        indices: MARKET_INDICES.map(idx => {
            const q = quoteMap.get(idx.fmpSymbol);
            return {
                symbol: idx.symbol,
                fmpSymbol: idx.fmpSymbol,
                displayName: idx.displayName,
                koreanName: idx.koreanName,
                price: q?.price ?? 0,
                changesPercentage: q?.changesPercentage ?? 0,
            };
        }),
        sectors: SECTOR_ETFS.map(etf => {
            const q = quoteMap.get(etf.symbol);
            return {
                symbol: etf.symbol,
                sectorName: etf.sectorName,
                koreanName: etf.koreanName,
                price: q?.price ?? 0,
                changesPercentage: q?.changesPercentage ?? 0,
            };
        }),
    };
}
