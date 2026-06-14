import type {
    AxisScore,
    FinancialSignal,
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

// ─── Shared helpers ──────────────────────────────────────────────────────────

const grade = (s: number): FinancialsGrade =>
    s >= 80 ? 'A' : s >= 65 ? 'B' : s >= 50 ? 'C' : s >= 35 ? 'D' : 'F';

/** null 제외 평균. 전부 null이면 0. */
const avg = (xs: (number | null)[]): number => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length === 0 ? 0 : v.reduce((a, b) => a + b, 0) / v.length;
};

const clamp = (n: number): number => Math.max(0, Math.min(100, n));

/** 성장률(소수, 0.20=20%)→구간 점수. null 통과. */
const growthBand = (g: number | null): number | null =>
    g == null
        ? null
        : g >= 0.2
          ? 100
          : g >= 0.1
            ? 75
            : g >= 0.05
              ? 55
              : g >= 0
                ? 40
                : 15;

/** 마진(퍼센트 단위, 20=20%)→구간 점수. null 통과. */
const marginBand = (m: number | null): number | null =>
    m == null
        ? null
        : m >= 20
          ? 100
          : m >= 12
            ? 75
            : m >= 6
              ? 55
              : m >= 0
                ? 40
                : 15;

/** 유동비율→구간 점수. null 통과. */
const currentRatioBand = (cr: number | null): number | null =>
    cr == null
        ? null
        : cr >= 2
          ? 100
          : cr >= 1.5
            ? 80
            : cr >= 1
              ? 55
              : cr >= 0.8
                ? 35
                : 15;

/** 부채비율(부채/자산)→구간 점수. null 통과. */
const debtRatioBand = (dr: number | null): number | null =>
    dr == null
        ? null
        : dr <= 0.4
          ? 100
          : dr <= 0.55
            ? 75
            : dr <= 0.7
              ? 50
              : dr <= 0.85
                ? 30
                : 15;

/** FCF 마진(퍼센트 단위)→구간 점수. null 통과. */
const fcfMarginBand = (m: number | null): number | null =>
    m == null
        ? null
        : m >= 20
          ? 100
          : m >= 10
            ? 75
            : m >= 5
              ? 55
              : m >= 0
                ? 40
                : 15;

/** FCF/OCF 전환율→구간 점수. null 통과. */
const conversionBand = (c: number | null): number | null =>
    c == null
        ? null
        : c >= 0.8
          ? 100
          : c >= 0.6
            ? 75
            : c >= 0.4
              ? 50
              : c >= 0
                ? 30
                : 10;

/** null-safe 비율. 분모가 null/0이거나 분자가 null이면 null. */
const ratio = (
    num: number | null | undefined,
    den: number | null | undefined
): number | null =>
    num == null || den == null || den === 0 ? null : num / den;

/** value를 퍼센트(×100)로 환산. null 통과. */
const toPct = (g: number | null | undefined): number | null =>
    g == null ? null : g * 100;

// ─── Growth axis ─────────────────────────────────────────────────────────────

function scoreGrowth(s: FinancialsSnapshot): AxisScore {
    const fg = s.financialGrowth[0];
    const prev = s.financialGrowth[1];

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
        { labelKo: 'EPS 성장률', value: toPct(fg?.epsgrowth), unit: 'pct' },
        {
            labelKo: 'FCF 성장률',
            value: toPct(fg?.freeCashFlowGrowth),
            unit: 'pct',
        },
    ];

    if (s.financialGrowth.length === 0) {
        return { score: 0, grade: 'F', signals: [], metrics };
    }

    const bandAvg = avg([
        growthBand(fg?.revenueGrowth ?? null),
        growthBand(fg?.netIncomeGrowth ?? null),
        growthBand(fg?.epsgrowth ?? null),
        growthBand(fg?.freeCashFlowGrowth ?? null),
    ]);

    const revRows = s.financialGrowth.filter(r => r.revenueGrowth != null);
    const positives = revRows.filter(r => r.revenueGrowth! > 0).length;
    const consistency =
        revRows.length === 0 ? 0 : (positives / revRows.length) * 100;

    const score = Math.round(bandAvg * 0.7 + consistency * 0.3);

    const signals: FinancialSignal[] = [];
    if (
        fg?.revenueGrowth != null &&
        prev?.revenueGrowth != null &&
        fg.revenueGrowth > prev.revenueGrowth
    ) {
        signals.push({
            type: 'revenue_accel',
            direction: 'positive',
            labelKo: '매출 성장 가속',
        });
    }
    if (
        fg?.netIncomeGrowth != null &&
        fg?.revenueGrowth != null &&
        fg.netIncomeGrowth > fg.revenueGrowth
    ) {
        signals.push({
            type: 'operating_leverage',
            direction: 'positive',
            labelKo: '영업 레버리지',
        });
    }
    if (fg?.revenueGrowth != null && fg.revenueGrowth < 0) {
        signals.push({
            type: 'growth_decline',
            direction: 'negative',
            labelKo: '매출 역성장',
        });
    }

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

    const signals: FinancialSignal[] = [];

    let trend = 0;
    if (inc?.netMargin != null && prev?.netMargin != null) {
        if (inc.netMargin > prev.netMargin) {
            trend = 15;
            signals.push({
                type: 'margin_expansion',
                direction: 'positive',
                labelKo: '마진 개선',
            });
        } else {
            trend = -15;
            signals.push({
                type: 'margin_contraction',
                direction: 'negative',
                labelKo: '마진 악화',
            });
        }
    }

    let accruals = 0;
    if (acc != null) {
        if (acc >= 1.0) {
            accruals = 20;
            signals.push({
                type: 'earnings_quality_good',
                direction: 'positive',
                labelKo: '이익의 질 양호',
            });
        } else if (acc < 0.8) {
            accruals = -20;
            signals.push({
                type: 'accrual_warning',
                direction: 'negative',
                labelKo: '이익의 질 주의',
            });
        }
    }

    const score = Math.round(clamp(base + trend + accruals));
    return { score, grade: grade(score), signals, metrics };
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

    const signals: FinancialSignal[] = [];

    let bonus = 0;
    if (bs?.netDebt != null && bs.netDebt < 0) {
        bonus = 15;
        signals.push({
            type: 'net_cash',
            direction: 'positive',
            labelKo: '순현금 기업',
        });
    }

    let penalty = 0;
    if (fg?.debtGrowth != null && fg.debtGrowth > 0.1) {
        penalty = 10;
        signals.push({
            type: 'debt_rising',
            direction: 'negative',
            labelKo: '부채 증가',
        });
    }

    const score = Math.round(clamp(base + bonus - penalty));
    return { score, grade: grade(score), signals, metrics };
}

// ─── Cash axis ───────────────────────────────────────────────────────────────

function scoreCash(s: FinancialsSnapshot): AxisScore {
    const cf = s.cashFlow[0];
    const inc = s.income[0];

    const conversion = ratio(cf?.freeCashFlow, cf?.operatingCashFlow);
    const capexAbs =
        cf?.capitalExpenditure == null ? null : Math.abs(cf.capitalExpenditure);
    const capexIntensity = ratio(capexAbs, inc?.revenue);

    const metrics: ScoreMetric[] = [
        { labelKo: 'FCF 마진', value: cf?.fcfMargin ?? null, unit: 'pct' },
        { labelKo: 'FCF 전환율', value: conversion, unit: 'ratio' },
        { labelKo: '설비투자 강도', value: capexIntensity, unit: 'ratio' },
    ];

    if (s.cashFlow.length === 0) {
        return { score: 0, grade: 'F', signals: [], metrics };
    }

    const fcfRows = s.cashFlow.filter(r => r.freeCashFlow != null);
    const positives = fcfRows.filter(r => r.freeCashFlow! > 0).length;
    const positiveRatio =
        fcfRows.length === 0 ? 0 : (positives / fcfRows.length) * 100;
    // positiveRatio is a meaningful 0 only when at least one non-null fcf row
    // exists; with no rows it should not pollute the average as a hard 0.
    const positiveRatioMetric = fcfRows.length === 0 ? null : positiveRatio;

    const base = avg([
        fcfMarginBand(cf?.fcfMargin ?? null),
        positiveRatioMetric,
        conversionBand(conversion),
    ]);

    const signals: FinancialSignal[] = [];

    let penalty = 0;
    if (capexIntensity != null && capexIntensity > 0.15) {
        penalty = 10;
        signals.push({
            type: 'capex_heavy',
            direction: 'negative',
            labelKo: '설비투자 과다',
        });
    }

    if (cf?.freeCashFlow != null && cf.freeCashFlow > 0) {
        signals.push({
            type: 'fcf_solid',
            direction: 'positive',
            labelKo: '잉여현금흐름 견조',
        });
    } else if (cf?.freeCashFlow != null && cf.freeCashFlow < 0) {
        signals.push({
            type: 'fcf_negative',
            direction: 'negative',
            labelKo: '잉여현금흐름 적자',
        });
    }

    const score = Math.round(clamp(base - penalty));
    return { score, grade: grade(score), signals, metrics };
}

// ─── Composite summary ───────────────────────────────────────────────────────

const AXIS_LABELS_KO = {
    growth: '성장성',
    quality: '수익성',
    solvency: '안정성',
    cash: '현금창출력',
} as const;

const GRADE_RANK: Record<FinancialsGrade, number> = {
    A: 5,
    B: 4,
    C: 3,
    D: 2,
    F: 1,
};

function buildSummaryKo(
    growth: AxisScore,
    quality: AxisScore,
    solvency: AxisScore,
    cash: AxisScore
): string {
    // Stable axis ordering keeps the summary deterministic on grade ties.
    const axes = [
        { key: 'growth', axis: growth },
        { key: 'quality', axis: quality },
        { key: 'solvency', axis: solvency },
        { key: 'cash', axis: cash },
    ] as const;

    const top = axes.reduce((best, cur) =>
        GRADE_RANK[cur.axis.grade] > GRADE_RANK[best.axis.grade] ? cur : best
    );
    const bottom = axes.reduce((worst, cur) =>
        GRADE_RANK[cur.axis.grade] < GRADE_RANK[worst.axis.grade] ? cur : worst
    );

    return `${AXIS_LABELS_KO[top.key]} 우수(${top.axis.grade}), ${AXIS_LABELS_KO[bottom.key]} 주의(${bottom.axis.grade})`;
}

// ─── Public entry point ──────────────────────────────────────────────────────

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
