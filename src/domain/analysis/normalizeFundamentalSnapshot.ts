/**
 * Raw FMP response shapes consumed by `normalizeFundamentalSnapshot`.
 *
 * These interfaces live in domain because they describe the _input shape_ of a
 * pure normalization function — not the wire format of any concrete HTTP client.
 * The infrastructure `FundamentalDataProvider` returns objects that structurally
 * satisfy these interfaces; domain never imports from infrastructure.
 *
 * Consistent with the existing pattern: `Bar`, `IndicatorResult`, etc. are
 * defined in domain and produced by infrastructure.
 */
import type { FundamentalSnapshot } from '@/domain/types';

// ─────────────────────────────────────────
// Raw FMP response shapes (domain-owned)
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

/** Raw FMP analyst grade consensus breakdown. */
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
