/**
 * The `weekly-hygiene` mode (WP-19 core-1 gates K1 to K3): what a `1Week` prompt must not carry
 * from the daily one, what it must carry instead, and how its guide selection differs.
 *
 *   K1  one pass over every sample at `1Week`: no VWAP, none of the daily-only sentences, the
 *       weekly label and horizons, Monday rows, a pivot from the last finished week and a Fear &
 *       Greed section equal to the daily render's
 *   K2  the weekly result's `riskLevel` equals the daily one's (needs the stored results of two
 *       runs: a render has no model answer and so no `riskLevel`)
 *   K3  reported: per-guide injection rates and qualified-pattern counts, weekly against daily
 *
 * The patterns below are registered text. A sentence core words differently is not "absent";
 * the registered list is part of the gate and is recorded in `run.json`.
 */
import type { GateResult } from './analysisFieldsEvalTypes';
import { printedQualified } from './analysisFieldsEvalPrompt';
import {
    HTF_EVAL_CONSTANTS as C,
    aggregateWeeks,
    isoWeekStart,
    roundToKrxTick,
    matchesPrinted,
    periodProgress,
    weekdayOf,
    windowBars,
} from './htfEvalCompute';
import {
    fearGreedOf,
    marketReferenceOf,
    printedBarRows,
} from './htfEvalPrompt';
import { marketOfSymbol } from './markets';
import {
    checkGate,
    type Check,
    type CheckRow,
    type HtfCaseData,
    type HtfSample,
} from './htfEvalGates';

/** Daily-only sentences a weekly prompt must not print (registered; WP-19 §3.3, §9.2 K1). */
export const DAILY_ONLY_PATTERNS: readonly { name: string; pattern: RegExp }[] =
    [
        {
            name: 'candleReliability',
            pattern: /on daily bars, candle labels showed no forward edge/,
        },
        {
            name: 'stopSpacingBacktest',
            pattern: /Measured in a two-year daily backtest of this prompt/,
        },
        {
            name: 'dailyConfluenceReliability',
            pattern: /Daily, descriptive only — measured 2000–2026/,
        },
        {
            name: 'pullbackBlock',
            pattern: /### Short-term sell-off check \(computed, 1Day bars\)/,
        },
        {
            name: 'dailyIntervalLabel',
            pattern: /Timeframe: Daily|Daily chart\. Indicator signals/,
        },
        // WP-18 core-3: measured base rates, measured on daily bars only.
        {
            name: 'baseRateEngineLine',
            pattern: /^- Measured on this engine \(/m,
        },
        { name: 'baseRateLabel', pattern: /\[Measured: / },
        { name: 'baseRatePooledLabel', pattern: /\[Measured over every / },
        {
            name: 'baseRateNotMeasuredLabel',
            pattern: /\[Not measured on intraday bars\]/,
        },
        {
            name: 'baseRateNotMeasuredLine',
            pattern: /^- Not measured on intraday bars\./m,
        },
        {
            name: 'baseRateWritingRuleMeasured',
            pattern:
                /when you mention reliability, cite the Measured label on its guide/,
        },
        {
            name: 'baseRateWritingRuleNotMeasured',
            pattern:
                /reliability was not measured on intraday bars, so do not state any/,
        },
        {
            name: 'levelHoldMeasured',
            pattern:
                /Measured on \d+ symbols \(U\.S\. and Korean\), daily bars/,
        },
        {
            name: 'levelHoldNotMeasured',
            pattern: /Not measured on intraday bars\. Treat these levels/,
        },
        /**
         * A weekly chart is not an intraday one, and core words every unmeasured case as
         * "intraday" today. Any weekly prompt that still says so fails this clause until
         * WP-19 core-1 decides the weekly wording (a core-1 follow-up).
         */
        { name: 'intradayWording', pattern: /intraday/i },
    ];

/**
 * A weekly case may print no Fear & Greed section only when the daily history it is computed
 * from is shorter than this (the replay set's own selection rule: 260 bars before every case).
 * Every case of set v1 prints one; an absence anywhere else is a failure, not "vacuous".
 */
export const FEAR_GREED_MIN_DAILY_BARS = 260;

/** The weekly horizon headers of `## Market Reference` (bars, label) and the daily ones that must not appear. */
export const WEEKLY_HORIZONS: readonly {
    bars: number;
    header: string;
}[] = [
    { bars: 20, header: '### Short-term — ~5 months (20 bars)' },
    { bars: 52, header: '### Medium-term — ~1 year (52 bars)' },
    { bars: 156, header: '### Long-term — ~3 years (156 bars)' },
];
const DAILY_HORIZON_HEADERS: readonly string[] = [
    '### Short-term — ~1 month (20 bars)',
    '### Medium-term — ~1 quarter (60 bars)',
    '### Long-term — ~9-12 months (200 bars)',
];

const WEEKLY_CONTEXT =
    'Weekly chart built by SIGLENS from daily bars: each bar is one ISO week';

/** Classic pivot levels of one bar, the instrument's own copy of the formulas. */
function pivotsOf(bar: { high: number; low: number; close: number }) {
    const p = (bar.high + bar.low + bar.close) / 3;
    const range = bar.high - bar.low;
    return {
        PP: p,
        R1: 2 * p - bar.low,
        S1: 2 * p - bar.high,
        R2: p + range,
        S2: p - range,
    } as const;
}

/**
 * The pivot source of a weekly analysis: the last weekly bar if its week has finished, else
 * the bar before it (design §3.3). `null` when the case's `asOf` has no later stored bar.
 */
function pivotSourceWeek(data: HtfCaseData) {
    const weeks = aggregateWeeks(
        windowBars(data.bars, data.replayCase.asOf, C.longWindowDays)
    );
    const progress = periodProgress(
        data.bars,
        data.replayCase.asOf,
        isoWeekStart
    );
    if (progress === null) return null;
    const source = progress.inProgress
        ? weeks[weeks.length - 2]
        : weeks[weeks.length - 1];
    return source ?? null;
}

/** The pivot values printed in `## Market Reference` as `- <price> (Pivot XX; ...`. */
function printedPivots(reference: string): readonly {
    name: string;
    price: string;
}[] {
    return [
        ...reference.matchAll(/^- (\S+) \(Pivot (PP|R1|S1|R2|S2)[;)]/gm),
    ].map(m => ({ name: m[2], price: m[1] }));
}

/** K1 on one weekly sample, with the daily render of the same case and tier. */
export function checkWeeklyHygiene(
    weekly: HtfSample,
    daily: HtfSample,
    data: HtfCaseData
): Check {
    const text = weekly.dynamic;
    const reference = marketReferenceOf(text);
    const rows = printedBarRows(text).rows;
    const source = pivotSourceWeek(data);
    if (source === null) {
        return { failures: [], notComputable: 'asOf is the last stored bar' };
    }
    const own = pivotsOf(source);
    const weeks = aggregateWeeks(
        windowBars(data.bars, data.replayCase.asOf, C.longWindowDays)
    );
    const kr = marketOfSymbol(data.replayCase.symbol) === 'kr';
    const printed = printedPivots(reference);
    const dailyBars = windowBars(
        data.bars,
        data.replayCase.asOf,
        C.longWindowDays
    ).length;
    const fearGreed = fearGreedOf(text);
    const fearGreedDaily = fearGreedOf(daily.dynamic);
    const failures = [
        ...(/^- VWAP:/m.test(text) ? ['vwapLine'] : []),
        ...(reference.includes('VWAP') ? ['vwapLevel'] : []),
        ...DAILY_ONLY_PATTERNS.filter(p => p.pattern.test(text)).map(
            p => `dailyOnly:${p.name}`
        ),
        ...(text.includes('Timeframe: Weekly') ? [] : ['weeklyLabel']),
        ...(text.includes(WEEKLY_CONTEXT) ? [] : ['weeklyContext']),
        ...DAILY_HORIZON_HEADERS.filter(h => reference.includes(h)).map(
            h => `dailyHorizon:${h}`
        ),
        ...WEEKLY_HORIZONS.filter(
            h => weeks.length >= h.bars && !reference.includes(h.header)
        ).map(h => `weeklyHorizonMissing:${h.bars}`),
        ...(rows.length === 0 ? ['noRows'] : []),
        ...rows.flatMap(row =>
            row.ts % 86_400 === 0 &&
            weekdayOf(row.ts) === 1 &&
            (row.time === null || row.time === '00:00')
                ? []
                : ['rowNotMondayDate']
        ),
        ...printed.flatMap(p => {
            const value = own[p.name as keyof typeof own];
            return matchesPrinted(p.price, kr ? roundToKrxTick(value) : value)
                ? []
                : [`pivot:${p.name}`];
        }),
        ...(fearGreed === fearGreedDaily ? [] : ['fearGreedDiffers']),
        ...(fearGreed === '' && dailyBars >= FEAR_GREED_MIN_DAILY_BARS
            ? ['fearGreedAbsentUnexplained']
            : []),
    ];
    return {
        failures: [...new Set(failures)],
        notComputable: null,
        pivotsChecked: printed.length,
    };
}

/**
 * K1 over the population. Computable only if some printed pivot was compared at all: a set of
 * prompts that print no pivot would pass the pivot clause by never testing it.
 */
export function k1Gate(rows: readonly CheckRow[]): GateResult {
    const base = checkGate(
        'K1',
        'weekly prompts carry no daily-only text and the weekly parts the design lists',
        rows
    );
    const pivots = rows.reduce((n, r) => n + (r.check.pivotsChecked ?? 0), 0);
    if (pivots > 0)
        return {
            ...base,
            value: `${base.value}; ${pivots} pivot values compared`,
        };
    return {
        ...base,
        pass: base.pass === false ? false : null,
        value: `${base.value}; no pivot value was printed, so the pivot clause compared nothing`,
    };
}

export interface HygieneExtras {
    /** Samples whose prompt printed no pivot at all (the lists are filtered by distance). */
    noPivotPrinted: number;
    fearGreedAbsentBoth: number;
    charsRatioMedian: number | null;
    notMeasurableWeekly: number;
    notMeasurableDaily: number;
    /** Cases whose weekly history is under 200 bars (weekly MA200 is null). */
    weeklyMa200Null: number;
}

const median = (values: readonly number[]): number | null => {
    const sorted = values.toSorted((a, b) => a - b);
    return sorted.length === 0 ? null : sorted[Math.floor(sorted.length / 2)];
};

export function hygieneExtras(
    pairs: readonly {
        weekly: HtfSample;
        daily: HtfSample;
        data: HtfCaseData;
    }[]
): HygieneExtras {
    const count = (s: string): number =>
        (s.match(/Not measurable/g) ?? []).length;
    return {
        noPivotPrinted: pairs.filter(
            p => printedPivots(marketReferenceOf(p.weekly.dynamic)).length === 0
        ).length,
        fearGreedAbsentBoth: pairs.filter(
            p =>
                fearGreedOf(p.weekly.dynamic) === '' &&
                fearGreedOf(p.daily.dynamic) === ''
        ).length,
        charsRatioMedian: median(
            pairs.map(
                p =>
                    (p.weekly.stable.length + p.weekly.dynamic.length) /
                    (p.daily.stable.length + p.daily.dynamic.length)
            )
        ),
        notMeasurableWeekly: pairs.reduce(
            (n, p) => n + count(p.weekly.dynamic),
            0
        ),
        notMeasurableDaily: pairs.reduce(
            (n, p) => n + count(p.daily.dynamic),
            0
        ),
        weeklyMa200Null: pairs.filter(
            p =>
                aggregateWeeks(
                    windowBars(
                        p.data.bars,
                        p.data.replayCase.asOf,
                        C.longWindowDays
                    )
                ).length < C.backdropMaPeriod
        ).length,
    };
}

/** K3 (reported): how many samples carry each guide and how many qualified patterns a prompt prints. */
export function injectionRates(
    skillsOf: ReadonlyMap<string, readonly string[]>,
    samples: readonly HtfSample[]
): {
    n: number;
    perGuide: Record<string, number>;
    meanQualifiedPatterns: number | null;
} {
    const perGuide = samples
        .flatMap(s => skillsOf.get(`${s.caseId}#${s.tier}`) ?? [])
        .reduce<Record<string, number>>(
            (acc, name) => ({ ...acc, [name]: (acc[name] ?? 0) + 1 }),
            {}
        );
    const counts = samples.map(s => printedQualified(s.dynamic).ids.length);
    return {
        n: samples.length,
        perGuide,
        meanQualifiedPatterns:
            counts.length === 0
                ? null
                : counts.reduce((a, b) => a + b, 0) / counts.length,
    };
}

/** K2: `riskLevel` of the weekly result equals the daily one's for the same case and tier. */
export function k2Gate(
    pairs:
        readonly { caseId: string; weekly: unknown; daily: unknown }[] | null,
    expected: number
): GateResult {
    const base = {
        id: 'K2',
        description:
            "the weekly run's riskLevel equals the daily run's, case by case",
        threshold: '100% of the cases',
    };
    if (pairs === null) {
        return { ...base, pass: null, value: 'no --run and --before' };
    }
    const comparable = pairs.filter(
        p => typeof p.weekly === 'string' && typeof p.daily === 'string'
    );
    const equal = comparable.filter(p => p.weekly === p.daily).length;
    const covered = comparable.length === expected && pairs.length === expected;
    return {
        ...base,
        pass: covered
            ? equal === comparable.length
            : equal < comparable.length
              ? false
              : null,
        value: `${equal}/${comparable.length} equal of ${expected} cases`,
    };
}
