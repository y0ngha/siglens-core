/**
 * FundamentalDataProvider infrastructure types.
 *
 * Raw FMP response shapes and the provider interface used by the application
 * layer. Normalization to domain types happens via `normalizeFundamentalSnapshot`.
 *
 * Consumer (siglens) implements `FundamentalDataProvider` using FMP `/stable/*` endpoints.
 * Core depends only on the interface — never on the concrete HTTP client.
 */
import type {
    FundamentalSnapshot,
    GradesEvent,
} from '@/domain/types';

// ─────────────────────────────────────────
// Raw FMP response shapes
// ─────────────────────────────────────────

/** Raw FMP company profile fields (subset used by the snapshot normalizer). */
export interface RawProfile {
    symbol: string;
    companyName: string;
    sector: string;
    industry: string;
    mktCap: number;
    ceo: string | null;
    website: string | null;
    description: string | null;
}

/** Raw FMP key metrics (TTM). Covers valuation multiples needed for snapshot. */
export interface RawKeyMetricsTtm {
    peRatioTTM: number | null;
    priceToSalesRatioTTM: number | null;
    pbRatioTTM: number | null;
    pegRatioTTM: number | null;
    enterpriseValueOverEBITDATTM: number | null;
    epsTTM: number | null;
}

/** Raw FMP ratios (TTM). Covers profitability and health metrics. */
export interface RawRatiosTtm {
    returnOnEquityTTM: number | null;
    returnOnAssetsTTM: number | null;
    operatingProfitMarginTTM: number | null;
    netProfitMarginTTM: number | null;
    debtRatioTTM: number | null;
    currentRatioTTM: number | null;
}

/** Raw FMP income statement growth (year-over-year). */
export interface RawIncomeGrowth {
    growthRevenue: number | null;
    growthEPS: number | null;
}

/** Raw FMP financial scores (Altman Z-score + Piotroski F-score). */
export interface RawFinancialScore {
    altmanZScore: number | null;
    piotroskiScore: number | null;
}

/** Raw FMP stock peer entry used for peer comparison table. */
export interface RawStockPeer {
    symbol: string;
    companyName: string;
    marketCap: number;
}

/**
 * Raw FMP analyst estimate (next quarter averages).
 * `estimatedEpsAvg` and `estimatedRevenueAvg` are the consensus mean values.
 */
export interface RawAnalystEstimate {
    estimatedEpsAvg: number | null;
    estimatedRevenueAvg: number | null;
}

/** Raw FMP analyst grade consensus breakdown. @see {@link FundamentalFutureDirection} for the domain shape. */
export interface RawGradesConsensus {
    strongBuy: number;
    buy: number;
    hold: number;
    sell: number;
    strongSell: number;
}

/**
 * Raw FMP price target consensus (high / low / median / mean).
 * Maps to domain {@link PriceTargetConsensus} via `normalizeFundamentalSnapshot`.
 */
export interface RawPriceTargetConsensus {
    targetHigh: number | null;
    targetLow: number | null;
    targetMedian: number | null;
    targetConsensus: number | null;
}

/**
 * Raw FMP price target summary grouped by lookback window.
 * `lastMonth` → 1-month avg, `lastQuarter` → 3-month avg, `lastYear` → 12-month avg.
 * Maps to domain {@link PriceTargetSummary} via `normalizeFundamentalSnapshot`.
 */
export interface RawPriceTargetSummary {
    lastMonth: { avgPriceTarget: number | null };
    lastQuarter: { avgPriceTarget: number | null };
    lastYear: { avgPriceTarget: number | null };
}

/** Raw FMP sector performance snapshot for a single trading date. */
export interface RawSectorPerformance {
    sector: string;
    changesPercentage: number;
}

/** Raw FMP historical sector performance entry (one row per date per sector). */
export interface RawHistoricalSectorPerformance {
    date: string;
    sector: string;
    changesPercentage: number;
}

/** Raw FMP cash flow statement (subset — operating cash flow only). */
export interface RawCashFlowStatement {
    operatingCashFlow: number | null;
}

/** Raw FMP earnings report for a symbol. `raw` preserves the full provider payload. */
export interface RawEarningsReport {
    symbol: string;
    date: string;
    raw: unknown;
}

// ─────────────────────────────────────────
// Provider interface
// ─────────────────────────────────────────

/**
 * Fundamental data fetcher abstraction. Consumer (siglens) implements via
 * FMP `/stable/*` endpoints. Core only depends on this interface.
 *
 * Each method returns the raw FMP response shape (or null / empty array if
 * the data is unavailable). Normalization to domain `FundamentalSnapshot`
 * happens in the application layer via `normalizeFundamentalSnapshot`.
 *
 * @see normalizeFundamentalSnapshot
 */
export interface FundamentalDataProvider {
    /** Fetch company profile (name, sector, industry, market cap, CEO, …). */
    getProfile(symbol: string): Promise<RawProfile | null>;
    /** Fetch TTM key metrics (valuation multiples, EPS). */
    getKeyMetricsTtm(symbol: string): Promise<RawKeyMetricsTtm | null>;
    /** Fetch TTM ratios (profitability margins, debt & current ratios). */
    getRatiosTtm(symbol: string): Promise<RawRatiosTtm | null>;
    /** Fetch the latest annual income statement (full shape varies by provider). */
    getIncomeStatement(symbol: string): Promise<unknown | null>;
    /** Fetch the latest annual balance sheet statement (full shape varies by provider). */
    getBalanceSheetStatement(symbol: string): Promise<unknown | null>;
    /** Fetch the latest annual cash flow statement (operating cash flow subset). */
    getCashFlowStatement(symbol: string): Promise<RawCashFlowStatement | null>;
    /** Fetch year-over-year income statement growth (revenue + EPS). */
    getIncomeStatementGrowth(symbol: string): Promise<RawIncomeGrowth | null>;
    /** Fetch Altman Z-score and Piotroski F-score for the symbol. */
    getFinancialScores(symbol: string): Promise<RawFinancialScore | null>;
    /** Fetch the peer list. Returns empty array when peers are unavailable. */
    getStockPeers(symbol: string): Promise<RawStockPeer[]>;
    /** Fetch next-quarter analyst EPS + revenue consensus estimates. */
    getAnalystEstimates(symbol: string): Promise<RawAnalystEstimate | null>;
    /**
     * Fetch the most recent analyst grade change events for a symbol.
     * Also used by the News page; exposed here to avoid a second provider.
     *
     * @param limit - Maximum number of events to return (default: 10).
     */
    getGrades(symbol: string, limit?: number): Promise<GradesEvent[]>;
    /** Fetch the current buy/hold/sell grade consensus breakdown. */
    getGradesConsensus(symbol: string): Promise<RawGradesConsensus | null>;
    /** Fetch analyst price target consensus (high / low / median / mean). */
    getPriceTargetConsensus(
        symbol: string,
    ): Promise<RawPriceTargetConsensus | null>;
    /** Fetch rolling average price targets (1-month, 3-month, 12-month). */
    getPriceTargetSummary(
        symbol: string,
    ): Promise<RawPriceTargetSummary | null>;
    /**
     * Fetch the sector performance snapshot for a single date.
     * FMP date-range is limited to the last 1 year.
     *
     * @param date - Trading date in `YYYY-MM-DD` format.
     */
    getSectorPerformanceSnapshot(date: string): Promise<RawSectorPerformance[]>;
    /**
     * Fetch historical daily sector performance for a given sector name.
     * Returns entries in reverse-chronological order (most recent first).
     */
    getHistoricalSectorPerformance(
        sector: string,
    ): Promise<RawHistoricalSectorPerformance[]>;
    /** Fetch the latest earnings report for a symbol. */
    getEarningsReport(symbol: string): Promise<RawEarningsReport | null>;
}

// ─────────────────────────────────────────
// Normalization helper
// ─────────────────────────────────────────

/**
 * Normalize raw FMP provider responses into the domain {@link FundamentalSnapshot}.
 *
 * Accepts all raw pieces collected by the application layer and maps field names
 * (e.g. `mktCap` → `marketCap`, `peRatioTTM` → `per`) to the canonical domain
 * shape. Null-coalesces every optional field so callers always receive a
 * structurally complete snapshot even when individual FMP calls return null.
 *
 * @param input - Aggregated raw responses from `FundamentalDataProvider` methods.
 * @returns A fully typed `FundamentalSnapshot` ready for prompt builders and UI.
 */
export function normalizeFundamentalSnapshot(input: {
    profile: RawProfile;
    keyMetricsTtm: RawKeyMetricsTtm | null;
    ratiosTtm: RawRatiosTtm | null;
    cashFlow: RawCashFlowStatement | null;
    incomeGrowth: RawIncomeGrowth | null;
    financialScores: RawFinancialScore | null;
    peers: RawStockPeer[];
    analystEstimate: RawAnalystEstimate | null;
    gradesConsensus: RawGradesConsensus | null;
    priceTargetConsensus: RawPriceTargetConsensus | null;
    priceTargetSummary: RawPriceTargetSummary | null;
    nextEarningsAt: string | null;
    sectorTodayChangePct: number | null;
    sectorHistorical: Array<{ date: string; changePct: number }>;
}): FundamentalSnapshot {
    return {
        profile: {
            symbol: input.profile.symbol,
            companyName: input.profile.companyName,
            sector: input.profile.sector,
            industry: input.profile.industry,
            marketCap: input.profile.mktCap,
            ceo: input.profile.ceo,
            website: input.profile.website,
            description: input.profile.description,
        },
        valuation: {
            per: input.keyMetricsTtm?.peRatioTTM ?? null,
            psr: input.keyMetricsTtm?.priceToSalesRatioTTM ?? null,
            pbr: input.keyMetricsTtm?.pbRatioTTM ?? null,
            peg: input.keyMetricsTtm?.pegRatioTTM ?? null,
            evToEbitda:
                input.keyMetricsTtm?.enterpriseValueOverEBITDATTM ?? null,
            eps: input.keyMetricsTtm?.epsTTM ?? null,
        },
        peers: input.peers.map((p) => ({
            symbol: p.symbol,
            companyName: p.companyName,
            marketCap: p.marketCap,
        })),
        profitability: {
            roe: input.ratiosTtm?.returnOnEquityTTM ?? null,
            roa: input.ratiosTtm?.returnOnAssetsTTM ?? null,
            operatingMargin:
                input.ratiosTtm?.operatingProfitMarginTTM ?? null,
            netMargin: input.ratiosTtm?.netProfitMarginTTM ?? null,
        },
        growth: {
            revenueYoy: input.incomeGrowth?.growthRevenue ?? null,
            epsYoy: input.incomeGrowth?.growthEPS ?? null,
        },
        health: {
            debtRatio: input.ratiosTtm?.debtRatioTTM ?? null,
            currentRatio: input.ratiosTtm?.currentRatioTTM ?? null,
            operatingCashFlow: input.cashFlow?.operatingCashFlow ?? null,
            altmanZScore: input.financialScores?.altmanZScore ?? null,
            piotroskiScore: input.financialScores?.piotroskiScore ?? null,
        },
        futureDirection: {
            nextEarningsAt: input.nextEarningsAt,
            analystEstimateEps:
                input.analystEstimate?.estimatedEpsAvg ?? null,
            analystEstimateRevenue:
                input.analystEstimate?.estimatedRevenueAvg ?? null,
            gradesConsensus: input.gradesConsensus,
            priceTargetConsensus: input.priceTargetConsensus
                ? {
                      high: input.priceTargetConsensus.targetHigh,
                      low: input.priceTargetConsensus.targetLow,
                      median: input.priceTargetConsensus.targetMedian,
                      consensus: input.priceTargetConsensus.targetConsensus,
                  }
                : null,
            priceTargetSummary: input.priceTargetSummary
                ? {
                      month1Avg:
                          input.priceTargetSummary.lastMonth.avgPriceTarget,
                      month3Avg:
                          input.priceTargetSummary.lastQuarter.avgPriceTarget,
                      year1Avg:
                          input.priceTargetSummary.lastYear.avgPriceTarget,
                  }
                : null,
        },
        sectorDirection: {
            todayChangePct: input.sectorTodayChangePct,
            historical: input.sectorHistorical,
        },
    };
}
