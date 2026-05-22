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

/**
 * @internal Identifier for the configured market data adapter implementation.
 * Resolved by {@link readMarketProviderType} from `MARKET_DATA_PROVIDER` and
 * consumed by {@link createMarketDataProvider} to dispatch to the matching
 * adapter. Internal dispatch tag — consumers control selection via the env
 * var, so this union is not part of the public API.
 */
export type MarketDataProviderType = 'alpaca' | 'fmp';
