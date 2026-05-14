import type { OptionsChain, OptionsSnapshot } from '@/domain/options/types';

/**
 * Provider contract for fetching options market data. Implementations live
 * in consumer projects (siglens injects YahooOptionsAdapter). Phase 1
 * keeps a single implementation; Tradier fallback is reserved for a
 * future Phase.
 */
export interface OptionsDataProvider {
    /** Full snapshot (all expirations) for a symbol. null when no options market. */
    fetchSnapshot(symbol: string): Promise<OptionsSnapshot | null>;
    /** Single expiration's chain. null when the expiration is unavailable. */
    fetchChain(
        symbol: string,
        expirationDate: string
    ): Promise<OptionsChain | null>;
    /** Fast existence check — does NOT fetch chain data. */
    hasOptionsMarket(symbol: string): Promise<boolean>;
}
