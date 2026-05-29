import type {
    FundamentalSnapshot,
    NormalizeFundamentalSnapshotInput,
} from '@/domain/types';

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
 * (e.g. `profile.marketCap` → `FundamentalProfile.marketCap`, `peRatioTTM` → `per`)
 * to the canonical domain shape. Null-coalesces every optional field so callers
 * always receive a structurally complete snapshot even when individual FMP calls
 * return null.
 *
 * Infrastructure adapters (e.g. the siglens FMP client) must map FMP's
 * wire-format `mktCap` → `FundamentalProfile.marketCap` when constructing the
 * input bundle, since `mktCap` is the FMP field name and `marketCap` is the
 * domain-neutral name used here.
 *
 * @param input - Aggregated domain-neutral inputs; see {@link NormalizeFundamentalSnapshotInput}.
 * @returns A fully typed `FundamentalSnapshot` ready for prompt builders and UI.
 *
 * @internal Builds the fundamental snapshot.
 */
export function normalizeFundamentalSnapshot(
    input: NormalizeFundamentalSnapshotInput
): FundamentalSnapshot {
    return {
        profile: {
            symbol: input.profile.symbol,
            companyName: input.profile.companyName,
            sector: input.profile.sector,
            industry: input.profile.industry,
            marketCap: input.profile.marketCap,
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
