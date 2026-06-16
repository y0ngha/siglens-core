import type { Chamber, CongressTrade } from '@/domain/types';

/**
 * @port
 * 의회 거래 공시 데이터 포트.
 *
 * Adapters live in the consumer (e.g. siglens provides its own adapter built on
 * FMP congress endpoints) and must map source-specific shapes to the
 * domain-neutral CongressTrade interface before returning — the port surface
 * references only domain types. Returns trades sorted by transactionDate
 * descending (newest first); an empty array when no data is available;
 * implementations throw only on infrastructure failures, never for missing
 * data (0건 != 장애 — 어댑터/래퍼 계약).
 */
export interface CongressTradesProvider {
    /**
     * Fetch congressional trade disclosures for a symbol.
     *
     * @param symbol - Ticker symbol (e.g. `"AAPL"`).
     * @param chamber - Legislative chamber (`'senate'` or `'house'`).
     * @param limit - Maximum number of records to return.
     * @returns Trade records, newest transactionDate first; empty array if unavailable.
     */
    getTrades(
        symbol: string,
        chamber: Chamber,
        limit: number
    ): Promise<CongressTrade[]>;
}
