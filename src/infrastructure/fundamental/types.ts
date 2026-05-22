/**
 * Adapter-internal FMP raw response shapes for the `FundamentalDataProvider`
 * port (declared in `@/domain/ports/fundamentalDataProvider`).
 *
 * Each `Raw*` interface mirrors the on-the-wire FMP `/stable/*` payload that
 * a concrete adapter typically receives. Adapters are responsible for mapping
 * these source-specific shapes (e.g. FMP's `mktCap`) to the domain-neutral
 * input interfaces declared in `@/domain/types` before returning from any
 * `FundamentalDataProvider` method.
 *
 * These types are not part of the port contract — they exist purely as an
 * implementation aid for FMP-backed adapters and are not re-exported from
 * the public API.
 */

/** @internal Raw FMP company profile fields (subset used by the snapshot normalizer). */
export interface RawProfile {
    symbol: string;
    companyName: string;
    sector: string;
    industry: string;
    /** FMP-specific field name. Adapters must map this to `FundamentalProfile.marketCap` before returning from `getProfile`. */
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
