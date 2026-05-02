/**
 * Domain-neutral input shapes consumed by `normalizeFundamentalSnapshot`.
 *
 * These interfaces describe the _domain role_ of each input to the pure
 * normalization function — not the wire format of any concrete HTTP provider.
 * Infrastructure adapters (e.g. FMP) return objects that structurally satisfy
 * these interfaces; domain never imports from infrastructure.
 *
 * Naming convention: `Fundamental<Role>Input` — describes what the field
 * represents in the business domain, not which API it comes from.
 */
import type { FundamentalSnapshot } from '@/domain/types';

// ─────────────────────────────────────────
// Domain-neutral input shapes
// ─────────────────────────────────────────

/** Company identity and market classification fields required for snapshot normalization. */
export interface FundamentalProfileInput {
    symbol: string;
    companyName: string;
    sector: string;
    industry: string;
    mktCap: number;
    ceo: string | null;
    website: string | null;
    description: string | null;
}

/** Valuation multiples and per-share earnings metrics (trailing-twelve-month). */
export interface FundamentalValuationMetrics {
    peRatioTTM: number | null;
    priceToSalesRatioTTM: number | null;
    pbRatioTTM: number | null;
    pegRatioTTM: number | null;
    enterpriseValueOverEBITDATTM: number | null;
    epsTTM: number | null;
}

/** Profitability and financial health ratios (trailing-twelve-month). */
export interface FundamentalRatiosInput {
    returnOnEquityTTM: number | null;
    returnOnAssetsTTM: number | null;
    operatingProfitMarginTTM: number | null;
    netProfitMarginTTM: number | null;
    debtRatioTTM: number | null;
    currentRatioTTM: number | null;
}

/** Year-over-year income statement growth rates. */
export interface FundamentalGrowthInput {
    growthRevenue: number | null;
    growthEPS: number | null;
}

/** Composite financial health scores (Altman Z-score + Piotroski F-score). */
export interface FundamentalFinancialScoresInput {
    altmanZScore: number | null;
    piotroskiScore: number | null;
}

/** Peer company entry used for the peer comparison table. */
export interface FundamentalPeerInput {
    symbol: string;
    companyName: string;
    marketCap: number;
}

/**
 * Consensus analyst estimate for the next reporting quarter.
 * `estimatedEpsAvg` and `estimatedRevenueAvg` are the mean values.
 */
export interface FundamentalAnalystEstimateInput {
    estimatedEpsAvg: number | null;
    estimatedRevenueAvg: number | null;
}

/** Buy/hold/sell grade consensus breakdown from analyst ratings. */
export interface FundamentalGradesConsensusInput {
    strongBuy: number;
    buy: number;
    hold: number;
    sell: number;
    strongSell: number;
}

/**
 * Analyst price target consensus (high / low / median / mean).
 * Maps to domain {@link PriceTargetConsensus} via `normalizeFundamentalSnapshot`.
 */
export interface FundamentalPriceTargetConsensusInput {
    targetHigh: number | null;
    targetLow: number | null;
    targetMedian: number | null;
    targetConsensus: number | null;
}

/**
 * Rolling average price targets grouped by lookback window.
 * `lastMonth` → 1-month avg, `lastQuarter` → 3-month avg, `lastYear` → 12-month avg.
 * Maps to domain {@link PriceTargetSummary} via `normalizeFundamentalSnapshot`.
 */
export interface FundamentalPriceTargetSummaryInput {
    lastMonth: { avgPriceTarget: number | null };
    lastQuarter: { avgPriceTarget: number | null };
    lastYear: { avgPriceTarget: number | null };
}

/** Sector performance snapshot entry for a single trading date. */
export interface FundamentalSectorPerformanceEntry {
    sector: string;
    changesPercentage: number;
}

/** Historical daily sector performance entry (one row per date per sector). */
export interface FundamentalSectorHistoricalEntry {
    date: string;
    sector: string;
    changesPercentage: number;
}

/** Cash flow statement input (subset — operating cash flow only). */
export interface FundamentalCashFlowInput {
    operatingCashFlow: number | null;
}

/** Earnings report entry for a symbol. `raw` preserves the full provider payload. */
export interface FundamentalEarningsReportInput {
    symbol: string;
    /** ISO date of the earnings event. Named `earningsDate` to match {@link EarningsReport.earningsDate}. */
    earningsDate: string;
    raw: unknown;
}

// ─────────────────────────────────────────
// Normalization helper
// ─────────────────────────────────────────

/**
 * Convert an FMP decimal ratio to a percentage value suitable for prompt display.
 *
 * FMP returns profitability/growth/health ratios as decimals (e.g. `0.15` for 15%).
 * The AI prompt prints these with a `%` suffix, so we multiply by 100 to avoid
 * the LLM seeing 100× wrong values.
 *
 * Fields that are already absolute (P/E, EPS, Altman Z-Score, cash flow amounts, etc.)
 * must NOT be passed through this helper.
 *
 * @param v - Decimal ratio from FMP, or `null`/`undefined` when unavailable.
 * @returns Value × 100, or `null` when input is nullish.
 */
const toPercent = (v: number | null | undefined): number | null =>
    v == null ? null : v * 100;

/**
 * Normalize raw FMP provider responses into the domain {@link FundamentalSnapshot}.
 *
 * Accepts all raw pieces collected by the application layer and maps field names
 * (e.g. `mktCap` → `marketCap`, `peRatioTTM` → `per`) to the canonical domain
 * shape. Null-coalesces every optional field so callers always receive a
 * structurally complete snapshot even when individual FMP calls return null.
 *
 * @param input - Aggregated raw responses from `FundamentalDataProvider` methods.
 * @param input.profile - Raw company profile (required; provides name, sector, etc.).
 * @param input.keyMetricsTtm - Raw TTM key metrics (valuation multiples, EPS); nullable.
 * @param input.ratiosTtm - Raw TTM ratios (profitability, debt, current ratio); nullable.
 * @param input.cashFlow - Raw cash flow statement (operating cash flow); nullable.
 * @param input.incomeGrowth - Raw year-over-year income growth (revenue + EPS); nullable.
 * @param input.financialScores - Raw Altman Z-score and Piotroski F-score; nullable.
 * @param input.peers - Raw peer list (empty array when peers are unavailable).
 * @param input.analystEstimate - Raw next-quarter analyst EPS + revenue consensus; nullable.
 * @param input.gradesConsensus - Raw buy/hold/sell grade breakdown; nullable.
 * @param input.priceTargetConsensus - Raw high/low/median/mean price targets; nullable.
 * @param input.priceTargetSummary - Raw rolling average price targets; nullable.
 * @param input.nextEarningsAt - ISO date string of the next earnings event; nullable.
 * @param input.sectorTodayChangePct - Sector day-over-day percent change; nullable.
 * @param input.sectorHistorical - Historical daily sector performance entries.
 * @returns A fully typed `FundamentalSnapshot` ready for prompt builders and UI.
 */
export function normalizeFundamentalSnapshot(input: {
    profile: FundamentalProfileInput;
    keyMetricsTtm: FundamentalValuationMetrics | null;
    ratiosTtm: FundamentalRatiosInput | null;
    cashFlow: FundamentalCashFlowInput | null;
    incomeGrowth: FundamentalGrowthInput | null;
    financialScores: FundamentalFinancialScoresInput | null;
    peers: FundamentalPeerInput[];
    analystEstimate: FundamentalAnalystEstimateInput | null;
    gradesConsensus: FundamentalGradesConsensusInput | null;
    priceTargetConsensus: FundamentalPriceTargetConsensusInput | null;
    priceTargetSummary: FundamentalPriceTargetSummaryInput | null;
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
        peers: input.peers.map(p => ({
            symbol: p.symbol,
            companyName: p.companyName,
            marketCap: p.marketCap,
        })),
        profitability: {
            roe: toPercent(input.ratiosTtm?.returnOnEquityTTM),
            roa: toPercent(input.ratiosTtm?.returnOnAssetsTTM),
            operatingMargin: toPercent(
                input.ratiosTtm?.operatingProfitMarginTTM
            ),
            netMargin: toPercent(input.ratiosTtm?.netProfitMarginTTM),
        },
        growth: {
            revenueYoy: toPercent(input.incomeGrowth?.growthRevenue),
            epsYoy: toPercent(input.incomeGrowth?.growthEPS),
        },
        health: {
            debtRatio: toPercent(input.ratiosTtm?.debtRatioTTM),
            currentRatio: input.ratiosTtm?.currentRatioTTM ?? null,
            operatingCashFlow: input.cashFlow?.operatingCashFlow ?? null,
            altmanZScore: input.financialScores?.altmanZScore ?? null,
            piotroskiScore: input.financialScores?.piotroskiScore ?? null,
        },
        futureDirection: {
            nextEarningsAt: input.nextEarningsAt,
            analystEstimateEps: input.analystEstimate?.estimatedEpsAvg ?? null,
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
