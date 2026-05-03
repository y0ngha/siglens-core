/**
 * FundamentalDataProvider infrastructure types.
 *
 * FMP-specific `Raw*` response shapes are defined here as infrastructure-layer
 * types owned by the FMP adapter. The Raw* types represent the FMP-source shapes
 * that adapters typically receive before mapping to domain-neutral input interfaces.
 *
 * Provider implementations are responsible for adapting their source-specific shapes
 * (e.g. FMP's `mktCap`) to the domain-neutral input interfaces. The `FundamentalDataProvider`
 * interface exposes the domain-neutral types — concrete adapters must perform any
 * field-name or shape mapping before returning.
 *
 * Consumer (siglens) implements `FundamentalDataProvider` using FMP `/stable/*`
 * endpoints. Core depends only on the interface — never on the concrete HTTP client.
 */
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
    FundamentalProfileInput,
    FundamentalRatiosInput,
    FundamentalSectorHistoricalInput,
    FundamentalSectorPerformanceInput,
    FundamentalValuationMetrics,
    GradesEvent,
} from '@/domain/types';

// ─────────────────────────────────────────
// FMP-specific Raw* response shapes (infrastructure-owned)
// ─────────────────────────────────────────

/** @internal Raw FMP company profile fields (subset used by the snapshot normalizer). */
export interface RawProfile {
    symbol: string;
    companyName: string;
    sector: string;
    industry: string;
    /** FMP-specific field name. Adapters must map this to `FundamentalProfileInput.marketCap` before returning from `getProfile`. */
    mktCap: number;
    ceo: string | null;
    website: string | null;
    description: string | null;
}

/** @internal Raw FMP key metrics (TTM). Covers valuation multiples needed for snapshot. */
export interface RawKeyMetricsTtm {
    peRatioTTM: number | null;
    priceToSalesRatioTTM: number | null;
    pbRatioTTM: number | null;
    pegRatioTTM: number | null;
    enterpriseValueOverEBITDATTM: number | null;
    epsTTM: number | null;
}

/** @internal Raw FMP ratios (TTM). Covers profitability and health metrics. */
export interface RawRatiosTtm {
    returnOnEquityTTM: number | null;
    returnOnAssetsTTM: number | null;
    operatingProfitMarginTTM: number | null;
    netProfitMarginTTM: number | null;
    debtRatioTTM: number | null;
    currentRatioTTM: number | null;
}

/** @internal Raw FMP income statement growth (year-over-year). */
export interface RawIncomeGrowth {
    growthRevenue: number | null;
    growthEPS: number | null;
}

/** @internal Raw FMP financial scores (Altman Z-score + Piotroski F-score). */
export interface RawFinancialScore {
    altmanZScore: number | null;
    piotroskiScore: number | null;
}

/** @internal Raw FMP stock peer entry used for peer comparison table. */
export interface RawStockPeer {
    symbol: string;
    companyName: string;
    marketCap: number;
}

/**
 * @internal
 * Raw FMP analyst estimate (next quarter averages).
 * `estimatedEpsAvg` and `estimatedRevenueAvg` are the consensus mean values.
 */
export interface RawAnalystEstimate {
    estimatedEpsAvg: number | null;
    estimatedRevenueAvg: number | null;
}

/** @internal Raw FMP analyst grade consensus breakdown. */
export interface RawGradesConsensus {
    strongBuy: number;
    buy: number;
    hold: number;
    sell: number;
    strongSell: number;
}

/**
 * @internal
 * Raw FMP price target consensus (high / low / median / mean).
 */
export interface RawPriceTargetConsensus {
    targetHigh: number | null;
    targetLow: number | null;
    targetMedian: number | null;
    targetConsensus: number | null;
}

/**
 * @internal
 * Raw FMP price target summary grouped by lookback window.
 * `lastMonth` → 1-month avg, `lastQuarter` → 3-month avg, `lastYear` → 12-month avg.
 */
export interface RawPriceTargetSummary {
    lastMonth: { avgPriceTarget: number | null };
    lastQuarter: { avgPriceTarget: number | null };
    lastYear: { avgPriceTarget: number | null };
}

/** @internal Raw FMP sector performance snapshot for a single trading date. */
export interface RawSectorPerformance {
    sector: string;
    changesPercentage: number;
}

/** @internal Raw FMP historical sector performance entry (one row per date per sector). */
export interface RawHistoricalSectorPerformance {
    date: string;
    sector: string;
    changesPercentage: number;
}

/** @internal Raw FMP cash flow statement (subset — operating cash flow only). */
export interface RawCashFlowStatement {
    operatingCashFlow: number | null;
}

/** @internal Raw FMP earnings report for a symbol. `raw` preserves the full provider payload. */
export interface RawEarningsReport {
    symbol: string;
    /** ISO date of the earnings event. Named `earningsDate` to match {@link EarningsReport.earningsDate}. */
    earningsDate: string;
    raw: unknown;
}

// ─────────────────────────────────────────
// Provider interface
// ─────────────────────────────────────────

/**
 * Fundamental data fetcher abstraction. Consumer (siglens) implements via
 * FMP `/stable/*` endpoints. Core only depends on this interface.
 *
 * Provider implementations are responsible for adapting their source-specific shapes
 * (e.g. FMP's `mktCap`) to the domain-neutral input interfaces before returning.
 * The Raw* types in this file represent the FMP-source shapes that adapters typically
 * receive before mapping.
 *
 * @see normalizeFundamentalSnapshot
 */
export interface FundamentalDataProvider {
    /**
     * Fetch company profile (name, sector, industry, market cap, CEO, …).
     *
     * Implementations must map source-specific field names to {@link FundamentalProfileInput}
     * before returning (e.g. FMP's `mktCap` → `marketCap`).
     *
     * @param symbol - Ticker symbol (e.g. `"AAPL"`).
     * @returns Domain-neutral profile object, or `null` if unavailable.
     */
    getProfile(symbol: string): Promise<FundamentalProfileInput | null>;

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
     * Fetch the latest grading actions (analyst rating changes) for a symbol.
     *
     * @todo Reserved for a future analysis phase that surfaces individual rating events.
     *   Current `submitFundamentalAnalysis` uses `getGradesConsensus` (aggregated counts) only.
     *
     * @param symbol - U.S. equity ticker.
     * @param limit - Maximum number of recent grading events to return.
     * @returns Recent grading actions sorted descending by date.
     */
    getGrades(symbol: string, limit?: number): Promise<GradesEvent[]>;

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
