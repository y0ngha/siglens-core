/**
 * FundamentalDataProvider infrastructure types.
 *
 * Raw FMP response shapes live in `src/domain/analysis/normalizeFundamentalSnapshot.ts`
 * (pure shape definitions owned by domain). This file re-exports them for
 * infrastructure consumers that need to implement `FundamentalDataProvider`, and
 * defines the provider interface itself.
 *
 * Consumer (siglens) implements `FundamentalDataProvider` using FMP `/stable/*` endpoints.
 * Core depends only on the interface — never on the concrete HTTP client.
 */
import type { GradesEvent } from '@/domain/types';

export type {
    RawProfile,
    RawKeyMetricsTtm,
    RawRatiosTtm,
    RawIncomeGrowth,
    RawFinancialScore,
    RawStockPeer,
    RawAnalystEstimate,
    RawGradesConsensus,
    RawPriceTargetConsensus,
    RawPriceTargetSummary,
    RawSectorPerformance,
    RawHistoricalSectorPerformance,
    RawCashFlowStatement,
    RawEarningsReport,
} from '@/domain/analysis/normalizeFundamentalSnapshot';

import type {
    RawProfile,
    RawKeyMetricsTtm,
    RawRatiosTtm,
    RawIncomeGrowth,
    RawFinancialScore,
    RawStockPeer,
    RawAnalystEstimate,
    RawGradesConsensus,
    RawPriceTargetConsensus,
    RawPriceTargetSummary,
    RawSectorPerformance,
    RawHistoricalSectorPerformance,
    RawCashFlowStatement,
    RawEarningsReport,
} from '@/domain/analysis/normalizeFundamentalSnapshot';

// ─────────────────────────────────────────
// Provider interface
// ─────────────────────────────────────────

/**
 * Fundamental data fetcher abstraction. Consumer (siglens) implements via
 * FMP `/stable/*` endpoints. Core only depends on this interface.
 *
 * Each method returns the raw FMP response shape (or null / empty array if
 * the data is unavailable). Normalization to domain `FundamentalSnapshot`
 * happens in the domain layer via `normalizeFundamentalSnapshot`.
 *
 * @see normalizeFundamentalSnapshot
 */
export interface FundamentalDataProvider {
    /**
     * Fetch company profile (name, sector, industry, market cap, CEO, …).
     *
     * @param symbol - Ticker symbol (e.g. `"AAPL"`).
     * @returns Raw profile object, or `null` if unavailable.
     */
    getProfile(symbol: string): Promise<RawProfile | null>;

    /**
     * Fetch TTM key metrics (valuation multiples, EPS).
     *
     * @param symbol - Ticker symbol.
     * @returns Raw TTM key metrics, or `null` if unavailable.
     */
    getKeyMetricsTtm(symbol: string): Promise<RawKeyMetricsTtm | null>;

    /**
     * Fetch TTM ratios (profitability margins, debt & current ratios).
     *
     * @param symbol - Ticker symbol.
     * @returns Raw TTM ratios, or `null` if unavailable.
     */
    getRatiosTtm(symbol: string): Promise<RawRatiosTtm | null>;

    /**
     * Fetch the latest annual cash flow statement (operating cash flow subset).
     *
     * @param symbol - Ticker symbol.
     * @returns Raw cash flow statement, or `null` if unavailable.
     */
    getCashFlowStatement(symbol: string): Promise<RawCashFlowStatement | null>;

    /**
     * Fetch year-over-year income statement growth (revenue + EPS).
     *
     * @param symbol - Ticker symbol.
     * @returns Raw income growth figures, or `null` if unavailable.
     */
    getIncomeStatementGrowth(symbol: string): Promise<RawIncomeGrowth | null>;

    /**
     * Fetch Altman Z-score and Piotroski F-score for the symbol.
     *
     * @param symbol - Ticker symbol.
     * @returns Raw financial scores, or `null` if unavailable.
     */
    getFinancialScores(symbol: string): Promise<RawFinancialScore | null>;

    /**
     * Fetch the peer list.
     *
     * @param symbol - Ticker symbol.
     * @returns Array of raw peer entries; empty array when peers are unavailable.
     */
    getStockPeers(symbol: string): Promise<RawStockPeer[]>;

    /**
     * Fetch next-quarter analyst EPS + revenue consensus estimates.
     *
     * @param symbol - Ticker symbol.
     * @returns Raw analyst estimate, or `null` if unavailable.
     */
    getAnalystEstimates(symbol: string): Promise<RawAnalystEstimate | null>;

    /**
     * Fetch the most recent analyst grade change events for a symbol.
     * Also used by the News page; exposed here to avoid a second provider.
     *
     * @param symbol - Ticker symbol.
     * @param limit - Maximum number of events to return (default: 10).
     * @returns Array of grade change events ordered by date (most recent first).
     */
    getGrades(symbol: string, limit?: number): Promise<GradesEvent[]>;

    /**
     * Fetch the current buy/hold/sell grade consensus breakdown.
     *
     * @param symbol - Ticker symbol.
     * @returns Raw grades consensus, or `null` if unavailable.
     */
    getGradesConsensus(symbol: string): Promise<RawGradesConsensus | null>;

    /**
     * Fetch analyst price target consensus (high / low / median / mean).
     *
     * @param symbol - Ticker symbol.
     * @returns Raw price target consensus, or `null` if unavailable.
     */
    getPriceTargetConsensus(
        symbol: string
    ): Promise<RawPriceTargetConsensus | null>;

    /**
     * Fetch rolling average price targets (1-month, 3-month, 12-month).
     *
     * @param symbol - Ticker symbol.
     * @returns Raw price target summary, or `null` if unavailable.
     */
    getPriceTargetSummary(
        symbol: string
    ): Promise<RawPriceTargetSummary | null>;

    /**
     * Fetch the sector performance snapshot for a single date.
     * FMP date-range is limited to the last 1 year.
     *
     * @param date - Trading date in `YYYY-MM-DD` format.
     * @returns Array of sector performance entries for that date.
     */
    getSectorPerformanceSnapshot(date: string): Promise<RawSectorPerformance[]>;

    /**
     * Fetch historical daily sector performance for a given sector name.
     * Returns entries in reverse-chronological order (most recent first).
     *
     * @param sector - Sector name as returned by FMP (e.g. `"Technology"`).
     * @returns Array of historical sector performance entries.
     */
    getHistoricalSectorPerformance(
        sector: string
    ): Promise<RawHistoricalSectorPerformance[]>;

    /**
     * Fetch the latest earnings report for a symbol.
     *
     * @param symbol - Ticker symbol.
     * @returns Raw earnings report, or `null` if unavailable.
     */
    getEarningsReport(symbol: string): Promise<RawEarningsReport | null>;
}
