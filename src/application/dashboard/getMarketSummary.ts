import type { MarketDataProvider } from '@/domain/ports/marketDataProvider';
import type {
    IndexTicker,
    MarketQuote,
    MarketSummaryData,
    SectorEtf,
} from '@/domain/types';

/**
 * Fetch real-time quotes for all dashboard market indices and sector ETFs.
 *
 * Issues one quote request per symbol in parallel via the configured market
 * data provider. Symbols that fail to fetch are emitted with `price` and
 * `changesPercentage` defaulted to `0` (so the dashboard renders fully even
 * if a single quote is unavailable).
 *
 * @param provider - Market data provider injected by the consumer (siglens app).
 * @param marketIndices - Consumer-owned market indices to quote.
 * @param sectorEtfs - Consumer-owned sector ETFs to quote.
 * @returns Indices and sector ETFs with their most recent quote data —
 *   see {@link MarketSummaryData}.
 *
 * @see getSectorSignals
 */
export async function getMarketSummary(
    provider: MarketDataProvider,
    marketIndices: readonly IndexTicker[],
    sectorEtfs: readonly SectorEtf[]
): Promise<MarketSummaryData> {
    const quoteSymbols = [
        ...marketIndices.map(index => index.fmpSymbol),
        ...sectorEtfs.map(etf => etf.symbol),
    ];
    const quotes = await Promise.all(
        quoteSymbols.map(symbol => provider.getQuote(symbol))
    );

    const quoteMap = new Map<string, MarketQuote>(
        quotes
            .filter((q): q is MarketQuote => q !== null)
            .map(q => [q.symbol, q])
    );

    return {
        indices: marketIndices.map(idx => {
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
        sectors: sectorEtfs.map(etf => {
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
