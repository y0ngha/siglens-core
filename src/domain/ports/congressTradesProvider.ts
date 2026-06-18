import type { Chamber, RawCongressTrade } from '@/domain/types';

/**
 * @port
 * Port for congressional trade disclosure data.
 *
 * Adapters live in the consumer (e.g. siglens provides its own adapter built on
 * FMP congress endpoints) and fetch + return **raw FMP wire rows**
 * (`RawCongressTrade[]`) without normalization. The core use-case
 * (`normalizeCongressTrades(senate, house)`) maps raw → domain `CongressTrade`
 * in one place, preventing double-normalization.
 *
 * Contract: return an empty array when no data is available; throw ONLY on
 * infrastructure failures. Zero trades is a normal state, not an error.
 */
export interface CongressTradesProvider {
    /**
     * Fetch congressional trade disclosures for a symbol.
     *
     * @param symbol - Ticker symbol (e.g. `"AAPL"`).
     * @param chamber - Legislative chamber (`'senate'` or `'house'`).
     * @param limit - Maximum number of records to return.
     * @returns Raw FMP wire rows, empty array if no data available.
     */
    getTrades(
        symbol: string,
        chamber: Chamber,
        limit: number
    ): Promise<RawCongressTrade[]>;
}
