import type { Bar, MarketQuote, Timeframe } from '@/domain/types';

/** Options accepted by {@link MarketDataProvider.getBars}. */
export interface GetBarsOptions {
    /** Provider symbol (FMP-style). */
    symbol: string;
    /** Bar resolution. */
    timeframe: Timeframe;
    /** Maximum number of bars to return. */
    limit?: number;
    /** Optional ISO timestamp upper bound (exclusive). */
    before?: string;
    /** Optional ISO timestamp lower bound (inclusive). */
    from?: string;
}

/** Identifier for the configured market data provider implementation. */
export type MarketDataProviderType = 'alpaca' | 'fmp';

/**
 * @port
 * Provider-agnostic contract for fetching bars and quotes from a market
 * data source.
 *
 * Adapters live in `infrastructure/market/` and are selected at runtime via
 * the `MARKET_PROVIDER` env var. Each adapter wraps a single external API
 * (Alpaca, FMP, …) and surfaces transport errors to the caller — the
 * application layer decides whether a fetch failure should propagate,
 * retry, or degrade.
 */
export interface MarketDataProvider {
    /** Fetch OHLCV bars for the requested symbol/timeframe. */
    getBars(options: GetBarsOptions): Promise<Bar[]>;
    /** Fetch the latest quote for `symbol`, or `null` when unavailable. */
    getQuote(symbol: string): Promise<MarketQuote | null>;
}
