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
 * Provider-agnostic contract for fetching bars and quotes.
 *
 * Implementations are constructed via {@link createMarketDataProvider} based
 * on the `MARKET_PROVIDER` env var.
 */
export interface MarketDataProvider {
    /** Fetch OHLCV bars for the requested symbol/timeframe. */
    getBars(options: GetBarsOptions): Promise<Bar[]>;
    /** Fetch the latest quote for `symbol`, or `null` when unavailable. */
    getQuote(symbol: string): Promise<MarketQuote | null>;
}

/** Outcome of {@link tryAcquireReanalyzeCooldown}. */
export type AcquireReanalyzeCooldownResult =
    | { ok: true }
    | { ok: false; remainingMs: number };

/** @internal Validated worker configuration (URL + shared secret). */
export interface WorkerConfig {
    workerUrl: string;
    workerSecret: string;
}

/** @internal Validated Alpaca API credentials. */
export interface AlpacaConfig {
    apiKey: string;
    secretKey: string;
}
