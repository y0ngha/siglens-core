import type { Bar, MarketQuote, Timeframe } from '@/domain/types';

/** Options accepted by {@link MarketDataProvider.getBars}. */
export interface GetBarsOptions {
    /** Ticker symbol accepted by the configured provider. */
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

/**
 * @port
 * Provider-agnostic contract for fetching bars and quotes from a market
 * data source.
 *
 * Implementations (adapters) wrap a single external API and surface
 * transport errors to the caller. The application layer decides whether a
 * fetch failure should propagate, retry, or degrade.
 */
export interface MarketDataProvider {
    /**
     * Fetch OHLCV bars for the requested symbol/timeframe.
     * @param options - Symbol, timeframe, and optional time bounds.
     * @returns Ordered array of OHLCV bars; empty when none are available.
     */
    getBars(options: GetBarsOptions): Promise<Bar[]>;
    /**
     * Fetch the latest quote for the given symbol.
     * @param symbol - Provider symbol (e.g. equity ticker).
     * @returns The latest quote, or `null` when unavailable.
     */
    getQuote(symbol: string): Promise<MarketQuote | null>;
}
