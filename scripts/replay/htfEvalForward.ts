/**
 * WP-19 measurements on stored bars (no prompt, no model): the case table (daily trend against
 * weekly trend on the set's cases, weekly bar counts, the unfinished week) and the M1 forward
 * measure (the 10-session return after every day by the pair of trends, week-clustered).
 *
 * M1 gates a *wording*: whether the higher-timeframe block may say that agreement between the
 * two trends showed no measured forward edge (DOM-12). It is the one check that deliberately
 * uses the shipped functions, injected as `labelers`: it asks whether the claim holds for what
 * the engine prints, so the reference is the engine. The case table is the instrument's own
 * recomputation.
 */
import type { GateResult, TrendLabel } from './analysisFieldsEvalTypes';
import {
    aggregateByWeek,
    intervalOf,
    isoWeekKey,
    pooledMean,
    resampleMultiplicities,
    resampledMean,
    streamForKey,
} from './engineEvalStats';
import {
    HTF_EVAL_CONSTANTS as C,
    aggregateWeeks,
    periodProgress,
    isoWeekStart,
    smaLast,
    trendOf,
    windowBars,
} from './htfEvalCompute';
import type { ReplayCase } from './types';
import type { Bar } from '@/domain/types';

/** Pre-registered constants of M1. */
export const FORWARD_CONSTANTS = {
    /** First bar index measured (the set's history needs a full MA200 before it). */
    fromBar: 300,
    replicates: 2000,
    seed: 20_261_122,
    /** The aligned cells may not exceed this many percentage points in the textbook direction. */
    textbookMarginPp: 1,
    /** The figures the design measured (WP-19 brief §1), reported next to the reproduction. */
    brief: {
        differentLabelShare: 0.547,
        oppositeShare: 0.013,
        alignedBullishExcessPp: 0.28,
        alignedBearishExcessPp: 0.0,
        casesInProgress: 661,
        weeklyMa200Computable: 522,
    },
} as const;

export const CELL_LABELS: readonly TrendLabel[] = [
    'bullish',
    'neutral',
    'bearish',
];

export interface ForwardLabelers {
    /** Daily trend on the standard 730-day window ending at the last bar given. */
    daily: (windowBars: readonly Bar[]) => TrendLabel | null;
    /** Weekly trend from the 1,830-day daily window ending at the last bar given. */
    weekly: (longWindowBars: readonly Bar[]) => TrendLabel | null;
}

export interface ForwardObservation {
    week: string;
    daily: TrendLabel;
    weekly: TrendLabel;
    /** Percent. */
    forward: number;
}

/** The index of the first bar with `time >= from`; `bars.length` when none. */
function lowerBound(bars: readonly Bar[], from: number): number {
    const state = { lo: 0, hi: bars.length };
    // CP-5: a binary search narrows its own bounds.
    while (state.lo < state.hi) {
        const mid = (state.lo + state.hi) >> 1;
        if (bars[mid].time < from) state.lo = mid + 1;
        else state.hi = mid;
    }
    return state.lo;
}

/** Every measurable day of one symbol: its two labels and the next `forwardSessions` return. */
export function observationsOf(
    bars: readonly Bar[],
    labelers: ForwardLabelers,
    stride = 1
): readonly ForwardObservation[] {
    const horizon = C.forwardSessions;
    const days = 86_400;
    return bars.flatMap((bar, i) => {
        if (
            i < FORWARD_CONSTANTS.fromBar ||
            i + horizon >= bars.length ||
            (i - FORWARD_CONSTANTS.fromBar) % stride !== 0
        ) {
            return [];
        }
        const daily = labelers.daily(
            bars.slice(
                lowerBound(bars, bar.time - C.dailyWindowDays * days),
                i + 1
            )
        );
        const weekly = labelers.weekly(
            bars.slice(
                lowerBound(bars, bar.time - C.longWindowDays * days),
                i + 1
            )
        );
        if (daily === null || weekly === null) return [];
        return [
            {
                week: isoWeekKey(bar.time),
                daily,
                weekly,
                forward: (bars[i + horizon].close / bar.close - 1) * 100,
            },
        ];
    });
}

export interface ForwardCell {
    daily: TrendLabel;
    weekly: TrendLabel;
    n: number;
    meanForwardPct: number | null;
    /** Cell mean minus the all-day mean, percentage points. */
    excessPp: number | null;
    /** Week-clustered 95% interval of the excess. */
    low: number | null;
    high: number | null;
}

/**
 * A paired contrast of two cells that share the daily trend: the weekly trend agrees with it
 * (aligned) or is its opposite. Reported next to the gate, not part of it.
 */
export interface ForwardContrast {
    name: string;
    /** Mean forward return of the aligned cell minus that of the opposed cell, percentage points. */
    differencePp: number | null;
    low: number | null;
    high: number | null;
}

export interface ForwardSummary {
    days: number;
    weeks: number;
    allMeanPct: number | null;
    cells: readonly ForwardCell[];
    contrasts: readonly ForwardContrast[];
    replicates: number;
}

/** Excess of each (daily, weekly) cell over the all-day mean, with week-clustered bootstrap intervals. */
export function summarizeForward(
    observations: readonly ForwardObservation[]
): ForwardSummary {
    const weeks = [...new Set(observations.map(o => o.week))].toSorted();
    const all = aggregateByWeek(
        observations.map(o => ({ week: o.week, value: o.forward })),
        weeks
    );
    const draws = resampleMultiplicities(
        weeks.length,
        FORWARD_CONSTANTS.replicates,
        streamForKey(FORWARD_CONSTANTS.seed, 'wp19-m1')
    );
    const allMean = pooledMean(all);
    const cells = CELL_LABELS.flatMap(daily =>
        CELL_LABELS.map((weekly): ForwardCell => {
            const members = observations.filter(
                o => o.daily === daily && o.weekly === weekly
            );
            const agg = aggregateByWeek(
                members.map(o => ({ week: o.week, value: o.forward })),
                weeks
            );
            const mean = pooledMean(agg);
            const interval = intervalOf(
                draws.map(m => {
                    const cell = resampledMean(agg, m);
                    const base = resampledMean(all, m);
                    return cell === null || base === null ? null : cell - base;
                })
            );
            return {
                daily,
                weekly,
                n: members.length,
                meanForwardPct: mean,
                excessPp:
                    mean === null || allMean === null ? null : mean - allMean,
                low: interval.low,
                high: interval.high,
            };
        })
    );
    const aggOf = (daily: TrendLabel, weekly: TrendLabel) =>
        aggregateByWeek(
            observations
                .filter(o => o.daily === daily && o.weekly === weekly)
                .map(o => ({ week: o.week, value: o.forward })),
            weeks
        );
    const contrast = (
        name: string,
        aligned: readonly [TrendLabel, TrendLabel],
        opposed: readonly [TrendLabel, TrendLabel]
    ): ForwardContrast => {
        const a = aggOf(...aligned);
        const b = aggOf(...opposed);
        const meanA = pooledMean(a);
        const meanB = pooledMean(b);
        const interval = intervalOf(
            draws.map(m => {
                const x = resampledMean(a, m);
                const y = resampledMean(b, m);
                return x === null || y === null ? null : x - y;
            })
        );
        return {
            name,
            differencePp:
                meanA === null || meanB === null ? null : meanA - meanB,
            low: interval.low,
            high: interval.high,
        };
    };
    return {
        days: observations.length,
        weeks: weeks.length,
        allMeanPct: allMean,
        cells,
        contrasts: [
            contrast(
                'daily bullish: weekly bullish minus weekly bearish',
                ['bullish', 'bullish'],
                ['bullish', 'bearish']
            ),
            contrast(
                'daily bearish: weekly bearish minus weekly bullish',
                ['bearish', 'bearish'],
                ['bearish', 'bullish']
            ),
        ],
        replicates: FORWARD_CONSTANTS.replicates,
    };
}

/**
 * M1: the "no measured forward edge" sentence may ship only if neither aligned cell has a
 * week-clustered 95% interval that excludes 0 by more than the margin in the textbook
 * direction (bullish and bullish above, bearish and bearish below). Not computable without
 * observations, an empty aligned cell or an interval that could not be drawn.
 */
export function m1Gate(summary: ForwardSummary): GateResult {
    const find = (d: TrendLabel, w: TrendLabel): ForwardCell | undefined =>
        summary.cells.find(c => c.daily === d && c.weekly === w);
    const bull = find('bullish', 'bullish');
    const bear = find('bearish', 'bearish');
    const margin = FORWARD_CONSTANTS.textbookMarginPp;
    const computable =
        summary.days > 0 &&
        bull !== undefined &&
        bear !== undefined &&
        bull.n > 0 &&
        bear.n > 0 &&
        bull.low !== null &&
        bear.high !== null;
    const exceeds =
        computable &&
        ((bull?.low ?? 0) > margin || (bear?.high ?? 0) < -margin);
    return {
        id: 'M1',
        description:
            'neither aligned cell (bullish/bullish, bearish/bearish), against the all-day mean, has a week-clustered 95% interval beyond the margin in the textbook direction (narrower than "agreement has no edge": the other seven cells and the aligned-minus-opposed contrasts are reported, not gated)',
        pass: computable ? !exceeds : null,
        value: computable
            ? `bullish/bullish low ${bull?.low?.toFixed(2)} pp, bearish/bearish high ${bear?.high?.toFixed(2)} pp over ${summary.days} days`
            : null,
        threshold: `bullish/bullish low <= +${margin} pp and bearish/bearish high >= -${margin} pp`,
    };
}

// ─── The case table ───────────────────────────────────────────────────────────

export interface CaseTableRow {
    caseId: string;
    daily: TrendLabel | null;
    weekly: TrendLabel | null;
    weeks: number;
    weeklyMa200: boolean;
    /** `null` when the case is the last stored bar of its symbol. */
    lastWeekInProgress: boolean | null;
}

export interface CaseTable {
    cases: number;
    weeks: { min: number; median: number; max: number; below40: number };
    weeklyMa200Computable: number;
    inProgress: number;
    finished: number;
    undetermined: number;
    pairs: Record<string, number>;
    same: number;
    opposite: number;
    oneNeutral: number;
    different: number;
}

/** Independent recomputation of one case's pair of trends and its unfinished-week status. */
export function caseRow(
    replayCase: ReplayCase,
    bars: readonly Bar[]
): CaseTableRow {
    const weeks = aggregateWeeks(
        windowBars(bars, replayCase.asOf, C.longWindowDays)
    );
    const progress = periodProgress(bars, replayCase.asOf, isoWeekStart);
    return {
        caseId: replayCase.caseId,
        daily:
            trendOf(windowBars(bars, replayCase.asOf, C.dailyWindowDays))
                ?.trend ?? null,
        weekly: trendOf(weeks)?.trend ?? null,
        weeks: weeks.length,
        weeklyMa200:
            smaLast(
                weeks.map(w => w.close),
                C.backdropMaPeriod
            ) !== null,
        lastWeekInProgress: progress === null ? null : progress.inProgress,
    };
}

export function summarizeCases(rows: readonly CaseTableRow[]): CaseTable {
    const counts = rows.map(r => r.weeks).toSorted((a, b) => a - b);
    const pairs = rows.reduce<Record<string, number>>((acc, r) => {
        const key = `${r.daily ?? 'null'}/${r.weekly ?? 'null'}`;
        return { ...acc, [key]: (acc[key] ?? 0) + 1 };
    }, {});
    const same = rows.filter(
        r => r.daily !== null && r.daily === r.weekly
    ).length;
    const opposite = rows.filter(
        r =>
            (r.daily === 'bullish' && r.weekly === 'bearish') ||
            (r.daily === 'bearish' && r.weekly === 'bullish')
    ).length;
    const oneNeutral = rows.filter(
        r =>
            (r.daily === 'neutral') !== (r.weekly === 'neutral') &&
            r.daily !== null &&
            r.weekly !== null
    ).length;
    return {
        cases: rows.length,
        weeks: {
            min: counts[0] ?? 0,
            median: counts[Math.floor(counts.length / 2)] ?? 0,
            max: counts[counts.length - 1] ?? 0,
            below40: counts.filter(n => n < C.trendMinBars).length,
        },
        weeklyMa200Computable: rows.filter(r => r.weeklyMa200).length,
        inProgress: rows.filter(r => r.lastWeekInProgress === true).length,
        finished: rows.filter(r => r.lastWeekInProgress === false).length,
        undetermined: rows.filter(r => r.lastWeekInProgress === null).length,
        pairs,
        same,
        opposite,
        oneNeutral,
        different: rows.length - same,
    };
}
