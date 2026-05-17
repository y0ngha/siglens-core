import type { OptionsSnapshot } from '@/domain/options/types';

/**
 * Provider contract for fetching options market data. Implementations live
 * in consumer projects and are injected at the application boundary; core
 * does not bind to a specific data feed.
 *
 * The interface intentionally exposes only a full-snapshot fetcher plus a
 * lightweight existence check. Per-expiration fetching is not part of the
 * surface — consumers filter the snapshot client-side instead.
 */
export interface OptionsDataProvider {
    /**
     * Fetch the full options snapshot (all expirations) for a symbol.
     *
     * @param symbol - Underlying ticker (uppercase, e.g. `'AAPL'`).
     * @returns Full snapshot when an options market exists, or `null` when
     *   the symbol has no listed options.
     */
    fetchSnapshot(symbol: string): Promise<OptionsSnapshot | null>;
    /**
     * Lightweight existence check — does NOT fetch chain data.
     *
     * @param symbol - Underlying ticker (uppercase, e.g. `'AAPL'`).
     * @returns `true` when the symbol has any listed options expiration,
     *   `false` otherwise.
     */
    hasOptionsMarket(symbol: string): Promise<boolean>;
}
