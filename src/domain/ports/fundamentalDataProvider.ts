import type {
    EarningsReport,
    FundamentalAnalystEstimateInput,
    FundamentalCashFlowInput,
    FundamentalFinancialScoresInput,
    FundamentalGradesConsensusInput,
    FundamentalGrowthInput,
    FundamentalPeerInput,
    FundamentalPriceTargetConsensusInput,
    FundamentalPriceTargetSummaryInput,
    FundamentalProfile,
    FundamentalRatiosInput,
    FundamentalSectorHistoricalInput,
    FundamentalSectorPerformanceInput,
    FundamentalValuationMetrics,
    GradesEvent,
} from '@/domain/types';

/**
 * @port
 * Fundamental data fetcher contract the domain depends on for company profile,
 * valuation, ratios, growth, scores, peers, analyst consensus, sector
 * performance, and earnings data.
 *
 * Adapters live in the consumer (e.g. siglens provides its own adapter built
 * on FMP `/stable/*` endpoints).
 * Provider implementations are responsible for adapting their source-specific
 * shapes (e.g. FMP's `mktCap`) to the domain-neutral input interfaces below
 * before returning — the port surface references only domain types.
 *
 * @see normalizeFundamentalSnapshot
 */
export interface FundamentalDataProvider {
    /**
     * Fetch company profile (name, sector, industry, market cap, CEO, …).
     *
     * Implementations must map source-specific field names to {@link FundamentalProfile}
     * before returning (e.g. FMP's `mktCap` → `marketCap`).
     *
     * @param symbol - Ticker symbol (e.g. `"AAPL"`).
     * @returns Domain-neutral profile object, or `null` if unavailable.
     */
    getProfile(symbol: string): Promise<FundamentalProfile | null>;

    /**
     * Fetch TTM key metrics (valuation multiples, EPS).
     *
     * @param symbol - Ticker symbol.
     * @returns Domain-neutral valuation metrics, or `null` if unavailable.
     */
    getKeyMetricsTtm(
        symbol: string
    ): Promise<FundamentalValuationMetrics | null>;

    /**
     * Fetch TTM ratios (profitability margins, debt & current ratios).
     *
     * @param symbol - Ticker symbol.
     * @returns Domain-neutral ratios, or `null` if unavailable.
     */
    getRatiosTtm(symbol: string): Promise<FundamentalRatiosInput | null>;

    /**
     * Fetch the latest annual cash flow statement (operating cash flow subset).
     *
     * @param symbol - Ticker symbol.
     * @returns Domain-neutral cash flow input, or `null` if unavailable.
     */
    getCashFlowStatement(
        symbol: string
    ): Promise<FundamentalCashFlowInput | null>;

    /**
     * Fetch year-over-year income statement growth (revenue + EPS).
     *
     * @param symbol - Ticker symbol.
     * @returns Domain-neutral income growth input, or `null` if unavailable.
     */
    getIncomeStatementGrowth(
        symbol: string
    ): Promise<FundamentalGrowthInput | null>;

    /**
     * Fetch Altman Z-score and Piotroski F-score for the symbol.
     *
     * @param symbol - Ticker symbol.
     * @returns Domain-neutral financial scores input, or `null` if unavailable.
     */
    getFinancialScores(
        symbol: string
    ): Promise<FundamentalFinancialScoresInput | null>;

    /**
     * Fetch the peer list.
     *
     * @param symbol - Ticker symbol.
     * @returns Array of domain-neutral peer inputs; empty array when peers are unavailable.
     */
    getStockPeers(symbol: string): Promise<FundamentalPeerInput[]>;

    /**
     * Fetch next-quarter analyst EPS + revenue consensus estimates.
     *
     * @param symbol - Ticker symbol.
     * @returns Domain-neutral analyst estimate input, or `null` if unavailable.
     */
    getAnalystEstimates(
        symbol: string
    ): Promise<FundamentalAnalystEstimateInput | null>;

    /**
     * @deprecated Reserved for a future analysis phase that surfaces
     *   individual analyst rating events. No use-case currently calls this
     *   method, and consumers (e.g. siglens FMP adapter) MAY implement it as
     *   a no-op or omit it entirely (the field is optional). The aggregated
     *   {@link FundamentalDataProvider.getGradesConsensus} is sufficient for
     *   `submitFundamentalAnalysis` today. Will be re-promoted to required
     *   in a future minor release once a caller exists.
     *
     * @param symbol - Ticker symbol.
     * @returns Recent analyst grading events for the symbol.
     */
    getGrades?(symbol: string): Promise<GradesEvent[]>;

    /**
     * Fetch the current buy/hold/sell grade consensus breakdown.
     *
     * @param symbol - Ticker symbol.
     * @returns Domain-neutral grades consensus input, or `null` if unavailable.
     */
    getGradesConsensus(
        symbol: string
    ): Promise<FundamentalGradesConsensusInput | null>;

    /**
     * Fetch analyst price target consensus (high / low / median / mean).
     *
     * @param symbol - Ticker symbol.
     * @returns Domain-neutral price target consensus input, or `null` if unavailable.
     */
    getPriceTargetConsensus(
        symbol: string
    ): Promise<FundamentalPriceTargetConsensusInput | null>;

    /**
     * Fetch rolling average price targets (1-month, 3-month, 12-month).
     *
     * @param symbol - Ticker symbol.
     * @returns Domain-neutral price target summary input, or `null` if unavailable.
     */
    getPriceTargetSummary(
        symbol: string
    ): Promise<FundamentalPriceTargetSummaryInput | null>;

    /**
     * Fetch the sector performance snapshot for a single date.
     * FMP date-range is limited to the last 1 year.
     *
     * @param date - Trading date in `YYYY-MM-DD` format.
     * @returns Array of domain-neutral sector performance entries for that date.
     */
    getSectorPerformanceSnapshot(
        date: string
    ): Promise<FundamentalSectorPerformanceInput[]>;

    /**
     * Fetch historical daily sector performance for a given sector name.
     * Returns entries in reverse-chronological order (most recent first).
     *
     * @param sector - Sector name as returned by FMP (e.g. `"Technology"`).
     * @returns Array of domain-neutral historical sector performance entries.
     */
    getHistoricalSectorPerformance(
        sector: string
    ): Promise<FundamentalSectorHistoricalInput[]>;

    /**
     * Fetch the latest earnings report for a symbol.
     *
     * @param symbol - Ticker symbol.
     * @returns Domain-neutral earnings report, or `null` if unavailable.
     */
    getEarningsReport(symbol: string): Promise<EarningsReport | null>;
}
