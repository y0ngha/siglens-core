import type {
    AxisScore,
    FinancialSignal,
    FinancialsAxis,
    FinancialsGrade,
    FinancialsScorecard,
    FinancialsSnapshot,
    ScoreMetric,
} from '@/domain/types';

/**
 * Deterministic 4-axis financial scorecard.
 *
 * Pure function: maps a normalized {@link FinancialsSnapshot} (each array sorted
 * newest→oldest, index 0 = latest fiscal period) to a {@link FinancialsScorecard}
 * with per-axis scores (0–100), letter grades, qualitative signals, and a
 * composite roll-up. No I/O, no randomness — identical input always yields
 * identical output. Null metrics are excluded from averages so missing data
 * never silently drags a score toward zero; only a genuinely empty axis input
 * collapses to the deterministic worst case (score 0 / grade 'F').
 */

// ─── Scoring weights ─────────────────────────────────────────────────────────
//
// Each growth/cash axis computes a "core" score from its primary series, then
// blends in a secondary growth series only when that series is actually present.
// The blend is a convex combination (weights sum to 1.0 with their core) so an
// ABSENT secondary series leaves the core score byte-for-byte unchanged — no
// re-normalization rounding drift, no zero-drag. When PRESENT, the secondary
// series nudges the score by its weighted share.
//
// growth core  = financialGrowth band(0.7) + consistency(0.3)  [unchanged]
// growth blend = core * (1 - INCOME) + incomeGrowthBand * INCOME
//   incomeGrowth (revenue/NI/EPS/operating-income YoY) overlaps financialGrowth
//   on revenue/NI/EPS, so it is kept as its own banded second opinion (avoiding
//   double-counting the same rates inside the core band) and additionally
//   surfaces the operating-income dimension financialGrowth lacks.
// cash blend = core * (1 - CASHFLOWGROWTH) + cashFlowGrowthBand * CASHFLOWGROWTH
//   cashFlowGrowth (FCF + OCF YoY) is a growth-of-cash signal distinct from the
//   level-based core (FCF margin / positive-FCF ratio / conversion).
const GROWTH_BAND_WEIGHT = 0.7;
const GROWTH_CONSISTENCY_WEIGHT = 0.3;
const GROWTH_INCOME_WEIGHT = 0.2;

const CASH_GROWTH_WEIGHT = 0.15;

// ─── Signal score deltas ─────────────────────────────────────────────────────
//
// Per-signal score adjustments applied on top of an axis's banded base score
// before clamping to [0, 100]. Positive = reward, negative = penalty.
const MARGIN_EXPANSION_DELTA = 15;
const MARGIN_CONTRACTION_DELTA = -15;
const EARNINGS_QUALITY_GOOD_DELTA = 20;
const ACCRUAL_WARNING_DELTA = -20;
const NET_CASH_DELTA = 15;
const DEBT_RISING_DELTA = -10;
const CAPEX_HEAVY_DELTA = -10;

// ─── Signal trigger thresholds ───────────────────────────────────────────────
//
// Conditions (on growth fractions / ratios) that switch a qualitative signal on.
const ACCRUAL_GOOD_THRESHOLD = 1.0; // OCF/NI ≥ this ⇒ earnings quality good
const ACCRUAL_WARNING_THRESHOLD = 0.8; // OCF/NI < this ⇒ accrual warning
const OPERATING_INCOME_GROWTH_THRESHOLD = 0.1; // YoY operating-income growth
const DEBT_RISING_THRESHOLD = 0.1; // YoY debt growth
const CAPEX_HEAVY_THRESHOLD = 0.15; // capex / revenue
const FCF_GROWTH_THRESHOLD = 0.1; // YoY free-cash-flow growth

// ─── Letter-grade cutoffs ────────────────────────────────────────────────────
//
// Inclusive lower bounds for each letter grade on the 0–100 score scale.
const GRADE_A_MIN = 80;
const GRADE_B_MIN = 65;
const GRADE_C_MIN = 50;
const GRADE_D_MIN = 35;

// ─── Band-score lookup tables ────────────────────────────────────────────────
//
// Each band maps a metric to a 0–100 score via descending [threshold, score]
// breakpoints. The first breakpoint whose comparison passes wins; the last
// `else` element is the floor score when no threshold is met. `growthBand` and
// `marginBand`/`fcfMarginBand`/`currentRatioBand`/`conversionBand` use `>=`
// (higher is better); `debtRatioBand` uses `<=` (lower is better).
const PERCENT_SCALE = 100; // fraction → percent

/** Growth-fraction breakpoints (0.20 = 20%); higher is better. */
const GROWTH_BAND: readonly [number, number][] = [
    [0.2, 100],
    [0.1, 75],
    [0.05, 55],
    [0, 40],
];
const GROWTH_BAND_FLOOR = 15;

/** Margin breakpoints (percent units, 20 = 20%); higher is better. */
const MARGIN_BAND: readonly [number, number][] = [
    [20, 100],
    [12, 75],
    [6, 55],
    [0, 40],
];
const MARGIN_BAND_FLOOR = 15;

/** Current-ratio breakpoints; higher is better. */
const CURRENT_RATIO_BAND: readonly [number, number][] = [
    [2, 100],
    [1.5, 80],
    [1, 55],
    [0.8, 35],
];
const CURRENT_RATIO_BAND_FLOOR = 15;

/** Debt-ratio (liabilities/assets) breakpoints; LOWER is better (uses `<=`). */
const DEBT_RATIO_BAND: readonly [number, number][] = [
    [0.4, 100],
    [0.55, 75],
    [0.7, 50],
    [0.85, 30],
];
const DEBT_RATIO_BAND_FLOOR = 15;

/** FCF-margin breakpoints (percent units); higher is better. */
const FCF_MARGIN_BAND: readonly [number, number][] = [
    [20, 100],
    [10, 75],
    [5, 55],
    [0, 40],
];
const FCF_MARGIN_BAND_FLOOR = 15;

/** FCF/OCF conversion-ratio breakpoints; higher is better. */
const CONVERSION_BAND: readonly [number, number][] = [
    [0.8, 100],
    [0.6, 75],
    [0.4, 50],
    [0, 30],
];
const CONVERSION_BAND_FLOOR = 10;

// ─── Shared helpers ──────────────────────────────────────────────────────────

const grade = (s: number): FinancialsGrade =>
    s >= GRADE_A_MIN
        ? 'A'
        : s >= GRADE_B_MIN
          ? 'B'
          : s >= GRADE_C_MIN
            ? 'C'
            : s >= GRADE_D_MIN
              ? 'D'
              : 'F';

/**
 * Score a value against a descending "higher is better" breakpoint table.
 * Returns the first matching score, the `floor` when none match, or `null`
 * when the input is null.
 */
const bandAscending = (
    v: number | null,
    table: readonly [number, number][],
    floor: number
): number | null => {
    if (v == null) return null;
    const hit = table.find(([threshold]) => v >= threshold);
    return hit ? hit[1] : floor;
};

/**
 * Score a value against a descending "lower is better" breakpoint table.
 * Returns the first matching score, the `floor` when none match, or `null`
 * when the input is null.
 */
const bandDescending = (
    v: number | null,
    table: readonly [number, number][],
    floor: number
): number | null => {
    if (v == null) return null;
    const hit = table.find(([threshold]) => v <= threshold);
    return hit ? hit[1] : floor;
};

/** null 제외 평균. 전부 null이면 0. */
const avg = (xs: (number | null)[]): number => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length === 0 ? 0 : v.reduce((a, b) => a + b, 0) / v.length;
};

const clamp = (n: number): number => Math.max(0, Math.min(100, n));

/** 성장률(소수, 0.20=20%)→구간 점수. null 통과. */
const growthBand = (g: number | null): number | null =>
    bandAscending(g, GROWTH_BAND, GROWTH_BAND_FLOOR);

/** 마진(퍼센트 단위, 20=20%)→구간 점수. null 통과. */
const marginBand = (m: number | null): number | null =>
    bandAscending(m, MARGIN_BAND, MARGIN_BAND_FLOOR);

/** 유동비율→구간 점수. null 통과. */
const currentRatioBand = (cr: number | null): number | null =>
    bandAscending(cr, CURRENT_RATIO_BAND, CURRENT_RATIO_BAND_FLOOR);

/** 부채비율(부채/자산)→구간 점수. null 통과. */
const debtRatioBand = (dr: number | null): number | null =>
    bandDescending(dr, DEBT_RATIO_BAND, DEBT_RATIO_BAND_FLOOR);

/** FCF 마진(퍼센트 단위)→구간 점수. null 통과. */
const fcfMarginBand = (m: number | null): number | null =>
    bandAscending(m, FCF_MARGIN_BAND, FCF_MARGIN_BAND_FLOOR);

/** FCF/OCF 전환율→구간 점수. null 통과. */
const conversionBand = (c: number | null): number | null =>
    bandAscending(c, CONVERSION_BAND, CONVERSION_BAND_FLOOR);

/** null-safe 비율. 분모가 null/0이거나 분자가 null이면 null. */
const ratio = (
    num: number | null | undefined,
    den: number | null | undefined
): number | null =>
    num == null || den == null || den === 0 ? null : num / den;

/** value를 퍼센트(×100)로 환산. null 통과. */
const toPct = (g: number | null | undefined): number | null =>
    g == null ? null : g * PERCENT_SCALE;

/**
 * Conditional signal helper: returns the FF-style `{ delta, signal }` pair.
 *
 * Centralizes the "score adjustment + optional qualitative signal" pattern so
 * axis scorers can be built declaratively (no `let` reassignment, no array
 * `push`). When `active` is false, contributes a 0 delta and no signal.
 */
type SignalContribution = { delta: number; signal: FinancialSignal | null };

const contribute = (
    active: boolean,
    delta: number,
    signal: FinancialSignal
): SignalContribution =>
    active ? { delta, signal } : { delta: 0, signal: null };

const noContribution: SignalContribution = { delta: 0, signal: null };

/** Collect the non-null signals from a list of contributions, in order. */
const collectSignals = (
    contributions: readonly SignalContribution[]
): FinancialSignal[] =>
    contributions
        .map(c => c.signal)
        .filter((s): s is FinancialSignal => s !== null);

// ─── Growth axis ─────────────────────────────────────────────────────────────

function scoreGrowth(s: FinancialsSnapshot): AxisScore {
    const fg = s.financialGrowth[0];
    const prev = s.financialGrowth[1];
    const ig = s.incomeGrowth[0];

    const metrics: ScoreMetric[] = [
        {
            labelKo: '매출 성장률',
            value: toPct(fg?.revenueGrowth),
            unit: 'pct',
        },
        {
            labelKo: '순이익 성장률',
            value: toPct(fg?.netIncomeGrowth),
            unit: 'pct',
        },
        { labelKo: 'EPS 성장률', value: toPct(fg?.epsGrowth), unit: 'pct' },
        {
            labelKo: 'FCF 성장률',
            value: toPct(fg?.freeCashFlowGrowth),
            unit: 'pct',
        },
        {
            labelKo: '영업이익 성장률',
            value: toPct(ig?.growthOperatingIncome),
            unit: 'pct',
        },
    ];

    if (s.financialGrowth.length === 0) {
        return { score: 0, grade: 'F', signals: [], metrics };
    }

    const bandAvg = avg([
        growthBand(fg?.revenueGrowth ?? null),
        growthBand(fg?.netIncomeGrowth ?? null),
        growthBand(fg?.epsGrowth ?? null),
        growthBand(fg?.freeCashFlowGrowth ?? null),
    ]);

    const revRows = s.financialGrowth.filter(r => r.revenueGrowth != null);
    const positives = revRows.filter(r => r.revenueGrowth! > 0).length;
    const consistency =
        revRows.length === 0 ? 0 : (positives / revRows.length) * PERCENT_SCALE;

    // Core score from financialGrowth alone (unchanged 0.7 / 0.3 split).
    const core =
        bandAvg * GROWTH_BAND_WEIGHT + consistency * GROWTH_CONSISTENCY_WEIGHT;

    // incomeGrowth (revenue / net income / EPS / operating income YoY) banded
    // second opinion. growthOperatingIncome adds the operating-income dimension
    // financialGrowth lacks. Blended only when present so absent incomeGrowth
    // leaves `core` exactly unchanged.
    const incomeBand = avg([
        growthBand(ig?.growthRevenue ?? null),
        growthBand(ig?.growthNetIncome ?? null),
        growthBand(ig?.growthEPS ?? null),
        growthBand(ig?.growthOperatingIncome ?? null),
    ]);
    const blended =
        s.incomeGrowth.length > 0
            ? core * (1 - GROWTH_INCOME_WEIGHT) +
              incomeBand * GROWTH_INCOME_WEIGHT
            : core;
    const score = Math.round(blended);

    const signals = collectSignals([
        contribute(
            fg?.revenueGrowth != null &&
                prev?.revenueGrowth != null &&
                fg.revenueGrowth > prev.revenueGrowth,
            0,
            {
                type: 'revenue_accel',
                direction: 'positive',
                labelKo: '매출 성장 가속',
            }
        ),
        contribute(
            fg?.netIncomeGrowth != null &&
                fg?.revenueGrowth != null &&
                fg.netIncomeGrowth > fg.revenueGrowth,
            0,
            {
                type: 'operating_leverage',
                direction: 'positive',
                labelKo: '영업 레버리지',
            }
        ),
        contribute(fg?.revenueGrowth != null && fg.revenueGrowth < 0, 0, {
            type: 'growth_decline',
            direction: 'negative',
            labelKo: '매출 역성장',
        }),
        contribute(
            ig?.growthOperatingIncome != null &&
                ig.growthOperatingIncome > OPERATING_INCOME_GROWTH_THRESHOLD,
            0,
            {
                type: 'operating_income_growth',
                direction: 'positive',
                labelKo: '영업이익 성장',
            }
        ),
    ]);

    return { score, grade: grade(score), signals, metrics };
}

// ─── Quality axis ────────────────────────────────────────────────────────────

function scoreQuality(s: FinancialsSnapshot): AxisScore {
    const inc = s.income[0];
    const prev = s.income[1];
    const cf = s.cashFlow[0];

    const acc = ratio(cf?.operatingCashFlow, inc?.netIncome);

    const metrics: ScoreMetric[] = [
        { labelKo: '순이익률', value: inc?.netMargin ?? null, unit: 'pct' },
        {
            labelKo: '영업이익률',
            value: inc?.operatingMargin ?? null,
            unit: 'pct',
        },
        { labelKo: '발생액 비율', value: acc, unit: 'ratio' },
    ];

    if (s.income.length === 0) {
        return { score: 0, grade: 'F', signals: [], metrics };
    }

    const base = avg([
        marginBand(inc?.netMargin ?? null),
        marginBand(inc?.operatingMargin ?? null),
    ]);

    const trendUp =
        inc?.netMargin != null &&
        prev?.netMargin != null &&
        inc.netMargin > prev.netMargin;
    const trendDown =
        inc?.netMargin != null &&
        prev?.netMargin != null &&
        inc.netMargin < prev.netMargin;

    const trend: SignalContribution = trendUp
        ? contribute(true, MARGIN_EXPANSION_DELTA, {
              type: 'margin_expansion',
              direction: 'positive',
              labelKo: '마진 개선',
          })
        : trendDown
          ? contribute(true, MARGIN_CONTRACTION_DELTA, {
                type: 'margin_contraction',
                direction: 'negative',
                labelKo: '마진 악화',
            })
          : noContribution;

    const accruals: SignalContribution =
        acc != null && acc >= ACCRUAL_GOOD_THRESHOLD
            ? contribute(true, EARNINGS_QUALITY_GOOD_DELTA, {
                  type: 'earnings_quality_good',
                  direction: 'positive',
                  labelKo: '이익의 질 양호',
              })
            : acc != null && acc < ACCRUAL_WARNING_THRESHOLD
              ? contribute(true, ACCRUAL_WARNING_DELTA, {
                    type: 'accrual_warning',
                    direction: 'negative',
                    labelKo: '이익의 질 주의',
                })
              : noContribution;

    const contributions = [trend, accruals];
    const delta = contributions.reduce((sum, c) => sum + c.delta, 0);

    const score = Math.round(clamp(base + delta));
    return {
        score,
        grade: grade(score),
        signals: collectSignals(contributions),
        metrics,
    };
}

// ─── Solvency axis ───────────────────────────────────────────────────────────

function scoreSolvency(s: FinancialsSnapshot): AxisScore {
    const bs = s.balance[0];
    const fg = s.financialGrowth[0];

    const debtRatio = ratio(bs?.totalLiabilities, bs?.totalAssets);

    const metrics: ScoreMetric[] = [
        { labelKo: '유동비율', value: bs?.currentRatio ?? null, unit: 'ratio' },
        { labelKo: '부채비율', value: debtRatio, unit: 'ratio' },
        { labelKo: '순부채', value: bs?.netDebt ?? null, unit: 'usd' },
    ];

    if (s.balance.length === 0) {
        return { score: 0, grade: 'F', signals: [], metrics };
    }

    const base = avg([
        currentRatioBand(bs?.currentRatio ?? null),
        debtRatioBand(debtRatio),
    ]);

    const netCash = contribute(
        bs?.netDebt != null && bs.netDebt < 0,
        NET_CASH_DELTA,
        {
            type: 'net_cash',
            direction: 'positive',
            labelKo: '순현금 기업',
        }
    );

    const debtRising = contribute(
        fg?.debtGrowth != null && fg.debtGrowth > DEBT_RISING_THRESHOLD,
        DEBT_RISING_DELTA,
        {
            type: 'debt_rising',
            direction: 'negative',
            labelKo: '부채 증가',
        }
    );

    const contributions = [netCash, debtRising];
    const delta = contributions.reduce((sum, c) => sum + c.delta, 0);

    const score = Math.round(clamp(base + delta));
    return {
        score,
        grade: grade(score),
        signals: collectSignals(contributions),
        metrics,
    };
}

// ─── Cash axis ───────────────────────────────────────────────────────────────

function scoreCash(s: FinancialsSnapshot): AxisScore {
    const cf = s.cashFlow[0];
    const inc = s.income[0];
    const cfg = s.cashFlowGrowth[0];

    const conversion = ratio(cf?.freeCashFlow, cf?.operatingCashFlow);
    const capexAbs =
        cf?.capitalExpenditure == null ? null : Math.abs(cf.capitalExpenditure);
    const capexIntensity = ratio(capexAbs, inc?.revenue);

    const metrics: ScoreMetric[] = [
        { labelKo: 'FCF 마진', value: cf?.fcfMargin ?? null, unit: 'pct' },
        { labelKo: 'FCF 전환율', value: conversion, unit: 'ratio' },
        { labelKo: '설비투자 강도', value: capexIntensity, unit: 'ratio' },
        {
            labelKo: 'FCF 성장률',
            value: toPct(cfg?.growthFreeCashFlow),
            unit: 'pct',
        },
        {
            labelKo: '영업현금흐름 성장률',
            value: toPct(cfg?.growthOperatingCashFlow),
            unit: 'pct',
        },
    ];

    if (s.cashFlow.length === 0) {
        return { score: 0, grade: 'F', signals: [], metrics };
    }

    const fcfRows = s.cashFlow.filter(r => r.freeCashFlow != null);
    const positives = fcfRows.filter(r => r.freeCashFlow! > 0).length;
    const positiveRatio =
        fcfRows.length === 0 ? 0 : (positives / fcfRows.length) * PERCENT_SCALE;
    // positiveRatio is a meaningful 0 only when at least one non-null fcf row
    // exists; with no rows it should not pollute the average as a hard 0.
    const positiveRatioMetric = fcfRows.length === 0 ? null : positiveRatio;

    const base = avg([
        fcfMarginBand(cf?.fcfMargin ?? null),
        positiveRatioMetric,
        conversionBand(conversion),
    ]);

    // cashFlowGrowth (FCF + OCF YoY) banded average — a growth-of-cash signal
    // distinct from the level-based `base`. Blended only when present so absent
    // cashFlowGrowth leaves `base` exactly unchanged.
    const cashGrowthBand = avg([
        growthBand(cfg?.growthFreeCashFlow ?? null),
        growthBand(cfg?.growthOperatingCashFlow ?? null),
    ]);
    const blended =
        s.cashFlowGrowth.length > 0
            ? base * (1 - CASH_GROWTH_WEIGHT) +
              cashGrowthBand * CASH_GROWTH_WEIGHT
            : base;

    const capexHeavy = contribute(
        capexIntensity != null && capexIntensity > CAPEX_HEAVY_THRESHOLD,
        CAPEX_HEAVY_DELTA,
        {
            type: 'capex_heavy',
            direction: 'negative',
            labelKo: '설비투자 과다',
        }
    );

    const fcfDirection: SignalContribution =
        cf?.freeCashFlow != null && cf.freeCashFlow > 0
            ? contribute(true, 0, {
                  type: 'fcf_solid',
                  direction: 'positive',
                  labelKo: '잉여현금흐름 견조',
              })
            : cf?.freeCashFlow != null && cf.freeCashFlow < 0
              ? contribute(true, 0, {
                    type: 'fcf_negative',
                    direction: 'negative',
                    labelKo: '잉여현금흐름 적자',
                })
              : noContribution;

    const fcfGrowing = contribute(
        cfg?.growthFreeCashFlow != null &&
            cfg.growthFreeCashFlow > FCF_GROWTH_THRESHOLD,
        0,
        {
            type: 'fcf_growth',
            direction: 'positive',
            labelKo: '잉여현금흐름 성장',
        }
    );

    // Signal ordering preserves the original capex → fcf direction sequence,
    // with the new cash-growth signal appended last.
    const contributions = [capexHeavy, fcfDirection, fcfGrowing];
    const delta = contributions.reduce((sum, c) => sum + c.delta, 0);

    const score = Math.round(clamp(blended + delta));
    return {
        score,
        grade: grade(score),
        signals: collectSignals(contributions),
        metrics,
    };
}

// ─── Composite summary ───────────────────────────────────────────────────────

const AXIS_LABELS_KO = {
    growth: '성장성',
    quality: '수익성',
    solvency: '안정성',
    cash: '현금창출력',
} as const;

/**
 * Build the Korean composite summary.
 *
 * Picks the strongest (`우수`) and weakest (`주의`) axis by **score** (not grade)
 * so that two axes sharing a grade but differing in score are still ranked, and
 * a stable axis order (growth → quality → solvency → cash) breaks exact ties
 * deterministically. The weakest axis is always chosen from the set EXCLUDING
 * the strongest, so the summary can never name the same axis twice — even when
 * every axis collapses to the same score (e.g. an empty snapshot: all 0/F).
 */
function buildSummaryKo(
    growth: AxisScore,
    quality: AxisScore,
    solvency: AxisScore,
    cash: AxisScore
): string {
    const axes: { key: FinancialsAxis; axis: AxisScore }[] = [
        { key: 'growth', axis: growth },
        { key: 'quality', axis: quality },
        { key: 'solvency', axis: solvency },
        { key: 'cash', axis: cash },
    ];

    // Highest score wins; first-in-order wins exact ties (stable).
    const top = axes.reduce((best, cur) =>
        cur.axis.score > best.axis.score ? cur : best
    );

    // Weakest is chosen from the remaining axes only, guaranteeing top !== bottom.
    const rest = axes.filter(a => a.key !== top.key);
    const bottom = rest.reduce((worst, cur) =>
        cur.axis.score < worst.axis.score ? cur : worst
    );

    return `${AXIS_LABELS_KO[top.key]} 우수(${top.axis.grade}), ${AXIS_LABELS_KO[bottom.key]} 주의(${bottom.axis.grade})`;
}

// ─── Public entry point ──────────────────────────────────────────────────────

/**
 * Compute the deterministic 4-axis financials scorecard for a symbol.
 *
 * @param s - Normalized financials snapshot (each series newest→oldest, index 0
 *   = latest fiscal period). Empty axis arrays collapse to the worst case
 *   (score 0 / grade 'F'); null metrics are excluded from averages.
 * @returns A {@link FinancialsScorecard} with per-axis scores, grades, signals,
 *   metrics, and a composite roll-up with a Korean summary string.
 */
export function computeFinancialsScorecard(
    s: FinancialsSnapshot
): FinancialsScorecard {
    const growth = scoreGrowth(s);
    const quality = scoreQuality(s);
    const solvency = scoreSolvency(s);
    const cash = scoreCash(s);

    const compositeScore = Math.round(
        avg([growth.score, quality.score, solvency.score, cash.score])
    );

    return {
        growth,
        quality,
        solvency,
        cash,
        composite: {
            score: compositeScore,
            grade: grade(compositeScore),
            summaryKo: buildSummaryKo(growth, quality, solvency, cash),
        },
    };
}
