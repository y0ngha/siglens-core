import type { OptionsSnapshot } from '@/domain/options/types';

/**
 * Provider contract for fetching options market data. Implementations live
 * in consumer projects (siglens injects YahooOptionsAdapter). Phase 1
 * keeps a single implementation; Tradier fallback is reserved for a
 * future Phase.
 *
 * A per-expiration chain fetcher is intentionally omitted — consumers
 * currently filter the full snapshot client-side via `pickActiveChain`.
 * Add `fetchChain` here in the PR that introduces a caller.
 */
export interface OptionsDataProvider {
    /** Full snapshot (all expirations) for a symbol. null when no options market. */
    fetchSnapshot(symbol: string): Promise<OptionsSnapshot | null>;
    /** Fast existence check — does NOT fetch chain data. */
    hasOptionsMarket(symbol: string): Promise<boolean>;
}
