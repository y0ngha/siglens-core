import { positionAgainstZone } from '@/domain/analysis/planCheck';
import type {
    EvaluablePlan,
    OutcomePlanSubject,
    OutcomeWindow,
    PlanApproach,
    PlanEntry,
    PlanOutcomeLabel,
    PlanReason,
    PlanResolution,
} from '@/domain/outcomes/types';
import {
    anchorIndex,
    baselineMean,
    closeSeries,
    forwardBar,
    forwardOffsets,
    pctChange,
    scannedBars,
} from '@/domain/outcomes/windowSeries';

const EMPTY_LABEL: PlanOutcomeLabel = {
    recommendation: null,
    outcome: 'no_plan',
    reason: null,
    approach: null,
    entryOffset: null,
    exitOffset: null,
    fill: null,
    exit: null,
    target: null,
    anchorBarUnobserved: false,
    gap: null,
    returnPct: null,
    holdBars: null,
    rwNullTargetFirst: null,
    baselineSameLengthPct: null,
    baselineN: null,
    sameWindowHoldPct: null,
};

/** The plan's prices when it can be evaluated, else why not; the checks run in this order. */
function evaluable(
    plan: OutcomePlanSubject | null
): EvaluablePlan | PlanReason {
    if (plan === null) return 'none';
    if (plan.recommendation === 'avoid') return 'avoid';
    const { entryLow: low, entryHigh: high, stop, targets } = plan;
    if (low === null || high === null) return 'no_entry';
    if (stop === null) return 'no_stop';
    if (targets.length === 0) return 'no_target';
    if (stop >= low) return 'stop_inside_zone';
    return { low, high, stop, targets };
}

function approachOf(
    referencePrice: number,
    low: number,
    high: number
): PlanApproach {
    // The exact-edge rule `buildPlanState` reads: `inside` is `in_zone`.
    const position = positionAgainstZone(referencePrice, low, high);
    if (position === 'above') return 'from_above';
    if (position === 'below') return 'from_below';
    return 'inside';
}

/**
 * The bar that fills the plan, judged bar by bar by where it **opens**, never by where the
 * reference price was:
 *
 * - opens inside the zone (edges included): filled at the open;
 * - opens above the zone: filled at the zone high on the first bar whose low reaches it;
 * - opens below the zone: if the previous close (the anchor bar's final close for bar 1,
 *   else the close of the bar before) was at or above the zone low, the gap jumped the zone
 *   from above and the plan is `void` (no fill): `gap_below_stop` when the open is also at
 *   or under the stop, else `gap_below_zone`. Otherwise it waits, and is filled at the
 *   zone low on the first bar whose high reaches it. A stop under the entry but above a
 *   price still below the zone is the normal shape of a breakout plan and voids nothing.
 *
 * A bar that opens outside the zone and never comes back to it is not a fill: no fill is
 * ever recorded outside the zone. `null`: the zone was not reached inside the window.
 */
function findEntry(
    window: OutcomeWindow,
    low: number,
    high: number,
    stop: number
): PlanEntry | null {
    // Bar 1 follows the anchor bar's final close (for a forming anchor that is more than
    // the analysis saw; `anchorBarUnobserved` flags the plans that could depend on it).
    const previousClose = (offset: number): number =>
        offset === 1
            ? window.anchorBar[4]
            : forwardBar(window, offset - 1).close;
    const entryAt = (offset: number): PlanEntry | null => {
        const bar = forwardBar(window, offset);
        if (bar.open >= low && bar.open <= high) {
            return { kind: 'filled', offset, fill: bar.open, via: 'open' };
        }
        if (bar.open > high) {
            return bar.low <= high
                ? { kind: 'filled', offset, fill: high, via: 'from_above' }
                : null;
        }
        if (previousClose(offset) >= low) {
            return {
                kind: 'void',
                offset,
                reason: bar.open <= stop ? 'gap_below_stop' : 'gap_below_zone',
            };
        }
        return bar.high >= low
            ? { kind: 'filled', offset, fill: low, via: 'from_below' }
            : null;
    };
    return (
        forwardOffsets(window)
            .map(entryAt)
            .find(entry => entry !== null) ?? null
    );
}

/**
 * Resolution of the entry bar when the fill was not at its open. One extreme of the bar
 * may predate the fill, and uncertainty never helps the plan:
 *
 * - from above (the low cannot predate the fill, the high may): a bar reaching both levels
 *   is `ambiguous`; a low through the stop is `stop_first`; a close at or over the target
 *   is `target_first`; a high over the target with a lower close proves nothing, continue.
 * - from below (the high cannot predate the fill, the low may): both levels is
 *   `ambiguous`; a high over the target with the low above the stop is `target_first`; a
 *   close at or under the stop is `stop_first`; a low through the stop with a close above
 *   it is `ambiguous` (the low may have come after the fill); otherwise continue.
 */
function resolveEntryBar(
    via: 'from_above' | 'from_below',
    bar: { high: number; low: number; close: number },
    stop: number,
    target: number
): Omit<PlanResolution, 'offset'> | null {
    const stopTouched = bar.low <= stop;
    const targetTouched = bar.high >= target;
    if (stopTouched && targetTouched) {
        return { kind: 'ambiguous', price: null, gap: false };
    }
    if (via === 'from_above') {
        if (stopTouched) return { kind: 'stop_first', price: stop, gap: false };
        return bar.close >= target
            ? { kind: 'target_first', price: target, gap: false }
            : null;
    }
    if (targetTouched)
        return { kind: 'target_first', price: target, gap: false };
    if (bar.close <= stop)
        return { kind: 'stop_first', price: stop, gap: false };
    return stopTouched ? { kind: 'ambiguous', price: null, gap: false } : null;
}

/** Resolution of a bar that is wholly after the fill: a gap through a level exits at the open. */
function resolveWholeBar(
    bar: { open: number; high: number; low: number },
    stop: number,
    target: number
): Omit<PlanResolution, 'offset'> | null {
    if (bar.open <= stop)
        return { kind: 'stop_first', price: bar.open, gap: true };
    if (bar.open >= target) {
        return { kind: 'target_first', price: bar.open, gap: true };
    }
    const stopHit = bar.low <= stop;
    const targetHit = bar.high >= target;
    if (stopHit && targetHit) {
        return { kind: 'ambiguous', price: null, gap: false };
    }
    if (stopHit) return { kind: 'stop_first', price: stop, gap: false };
    if (targetHit) return { kind: 'target_first', price: target, gap: false };
    return null;
}

function resolve(
    window: OutcomeWindow,
    entry: Extract<PlanEntry, { kind: 'filled' }>,
    stop: number,
    target: number
): PlanResolution | null {
    return (
        forwardOffsets(window)
            .filter(offset => offset >= entry.offset)
            .map((offset): PlanResolution | null => {
                const bar = forwardBar(window, offset);
                const resolved =
                    offset === entry.offset && entry.via !== 'open'
                        ? resolveEntryBar(entry.via, bar, stop, target)
                        : resolveWholeBar(bar, stop, target);
                return resolved === null ? null : { ...resolved, offset };
            })
            .find(resolution => resolution !== null) ?? null
    );
}

/**
 * Labels a long-only plan against the forward bars. `plan` is in the window's basis (the
 * caller has applied `adjFactor`).
 *
 * - `no_plan`: the plan cannot be evaluated; `reason` says why, in this order: no plan
 *   (`none`), an `avoid` verdict, no zone (`no_entry`), no stop (`no_stop`; also a stop core
 *   rejected), no target, a stop at or above the zone's low (`stop_inside_zone`).
 *   `wait` plans are evaluated like any other; `recommendation` is on every label.
 * - `approach`: the reference price against the zone, kept for stratification only. It reads
 *   the raw reference close, while plan state reads the printed (KRX tick-rounded) close, so
 *   for an off-grid KRW close the two can differ by one tick at a zone edge.
 * - Entry: see {@link findEntry}. The fill is always inside the zone. None by the end of
 *   the window is `not_triggered`; a gap that jumps the zone from above is `void_at_entry`
 *   (`gap_below_stop` or `gap_below_zone`, no fill). The `target` is the first one above
 *   the fill (none: `void_at_entry`, `no_target_above_fill`).
 * - `anchorBarUnobserved`: the anchor was forming and its final range overlaps the zone, so
 *   the plan may have filled in the unobserved part of that bar.
 * - Scan: the entry bar by {@link resolveEntryBar} (the fill was not at its open), every
 *   later bar by {@link resolveWholeBar}. Nothing by the end of the window is
 *   `open_at_horizon`, marked at the last close.
 *
 * `rwNullTargetFirst` is `(fill − stop) / (target − stop)`, the chance a driftless random
 * walk reaches the target before the stop with no horizon: the placebo for the `target_first`
 * share over **all** triggered plans (never over resolved trades only).
 *
 * @internal
 */
export function labelPlanOutcome(
    plan: OutcomePlanSubject | null,
    window: OutcomeWindow
): PlanOutcomeLabel {
    const recommendation = plan?.recommendation ?? null;
    const checked = evaluable(plan);
    if (typeof checked === 'string') {
        return { ...EMPTY_LABEL, recommendation, reason: checked };
    }
    const { low, high, stop, targets } = checked;
    // The part of a forming anchor bar the analysis did not see could only have filled the
    // plan if the bar's final range overlaps the zone. A stop touched without a fill
    // changes nothing, so the stop plays no part.
    const anchorBarUnobserved =
        window.anchorForming &&
        window.anchorBar[3] <= high &&
        window.anchorBar[2] >= low;

    const approach = approachOf(window.referencePrice, low, high);
    const withApproach = {
        ...EMPTY_LABEL,
        recommendation,
        approach,
        anchorBarUnobserved,
    };
    const entry = findEntry(window, low, high, stop);
    if (entry === null) return { ...withApproach, outcome: 'not_triggered' };
    if (entry.kind === 'void') {
        return {
            ...withApproach,
            outcome: 'void_at_entry',
            reason: entry.reason,
            entryOffset: entry.offset,
        };
    }

    const filled = {
        ...withApproach,
        entryOffset: entry.offset,
        fill: entry.fill,
    };
    const target = targets.find(price => price > entry.fill);
    if (target === undefined) {
        return {
            ...filled,
            outcome: 'void_at_entry',
            reason: 'no_target_above_fill',
        };
    }

    const resolution = resolve(window, entry, stop, target);
    const exitOffset = resolution?.offset ?? scannedBars(window);
    const exit =
        resolution === null
            ? forwardBar(window, exitOffset).close
            : resolution.price;

    const series = closeSeries(window);
    const i0 = anchorIndex(window);
    const holdBars = exitOffset - entry.offset + 1;
    const baseline = baselineMean(series, holdBars);
    return {
        ...filled,
        outcome: resolution?.kind ?? 'open_at_horizon',
        exitOffset,
        exit,
        target,
        gap: resolution?.gap ?? false,
        returnPct: exit === null ? null : pctChange(entry.fill, exit),
        holdBars,
        rwNullTargetFirst: (entry.fill - stop) / (target - stop),
        baselineSameLengthPct: baseline.pct,
        baselineN: baseline.n,
        sameWindowHoldPct: pctChange(
            series[i0 + entry.offset - 1],
            series[i0 + exitOffset]
        ),
    };
}
