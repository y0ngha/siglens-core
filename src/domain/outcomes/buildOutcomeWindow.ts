import { MS_PER_SECOND } from '@/domain/constants/time';
import { barTimeMs, findAnchorBarIndex } from '@/domain/analysis/priorAnalysis';
import { calculateATR } from '@/domain/indicators/atr';
import {
    ADJ_FACTOR_EPSILON,
    ADJ_FACTOR_RANGE,
    ANCHOR_FORMING_RANGE,
    ANCHOR_FORMING_REF_TOLERANCE,
    OUTCOME_PRE_BARS,
    OUTCOME_WINDOW_BARS,
} from '@/domain/outcomes/constants';
import type {
    OutcomeAnchor,
    OutcomeBarTuple,
    OutcomeWindowResult,
} from '@/domain/outcomes/types';
import type { Bar } from '@/domain/types';

/**
 * Finite positive prices with `low ≤ open, close ≤ high` (which also implies `low ≤ high`):
 * a bar that can have printed.
 */
function usableBar(bar: Bar): boolean {
    return (
        [bar.open, bar.high, bar.low, bar.close].every(
            price => Number.isFinite(price) && price > 0
        ) &&
        bar.open >= bar.low &&
        bar.open <= bar.high &&
        bar.close >= bar.low &&
        bar.close <= bar.high
    );
}

function toTuple(bar: Bar): OutcomeBarTuple {
    return [bar.time, bar.open, bar.high, bar.low, bar.close];
}

/** The anchor bar's index, or `null` when no bar is the one the anchor names. */
function resolveAnchorIndex(
    bars: readonly Bar[],
    anchor: OutcomeAnchor
): number | null {
    if ('generatedAtMs' in anchor) {
        return findAnchorBarIndex(bars, anchor.generatedAtMs);
    }
    const targetMs = anchor.barTime * MS_PER_SECOND;
    const index = findAnchorBarIndex(bars, targetMs);
    return index !== null && barTimeMs(bars[index]) === targetMs ? index : null;
}

/** Every bar usable and every `time` strictly after the one before it (within `bars`). */
function cleanSeries(bars: readonly Bar[]): boolean {
    return bars.every(
        (bar, i) => usableBar(bar) && (i === 0 || bar.time > bars[i - 1].time)
    );
}

/**
 * Leading forward bars (up to the window length) that are usable and strictly later than
 * the bar before them, starting from the anchor. A bad or out-of-order bar ends the run.
 */
function usableForwardCount(
    forward: readonly Bar[],
    anchorTime: number
): number {
    const candidates = forward.slice(0, OUTCOME_WINDOW_BARS);
    const firstBad = candidates.findIndex(
        (bar, i) =>
            !usableBar(bar) ||
            bar.time <= (i === 0 ? anchorTime : candidates[i - 1].time)
    );
    return firstBad === -1 ? candidates.length : firstBad;
}

/**
 * `bar close / close seen at analysis`: how today's price basis compares with the
 * analysis's. `NaN` when the close seen at analysis cannot be a price.
 */
function closeRatio(closeAtAnalysis: number, barClose: number): number {
    return Number.isFinite(closeAtAnalysis) && closeAtAnalysis > 0
        ? barClose / closeAtAnalysis
        : Number.NaN;
}

/**
 * Cuts the bars a label is computed from out of a symbol's closed bars.
 *
 * `closedBars` are oldest-first and contain **no forming bar** (the caller drops it): a
 * bar that is still moving would put a partial candle into the labels. Only the bars the
 * window reads are validated: the `OUTCOME_PRE_BARS` bars up to and including the anchor
 * (closes and ATR; ATR is computed from that window alone, not from the whole history)
 * and the forward bars. Those must be usable (finite positive prices, `low ≤ open, close
 * ≤ high`) with strictly increasing times, else `anchor_missing` (before the anchor) or
 * the usable run ends (after it). Bars earlier than that are ignored entirely. With fewer
 * than `OUTCOME_PRE_BARS` bars before the anchor, every bar before it is read and
 * validated.
 *
 * - The anchor is the bar the analysis names (`barTime`, `anchorSource: 'prompt_bar'`) or,
 *   for `{ generatedAtMs }`, the bar that instant falls in (`anchorSource: 'generated_at'`),
 *   taken as not yet closed at analysis time. On that fallback the reference price is the
 *   bar's **final** close, not a price the analysis saw: statistics should exclude or
 *   separate those rows.
 * - Daily bars are back-adjusted, so a split or dividend after the analysis rescales the
 *   anchor bar. When the bar was closed at analysis time its close is compared with
 *   today's: a ratio within `ADJ_FACTOR_EPSILON` of 1 is rounding (factor `1`), a ratio
 *   outside `ADJ_FACTOR_RANGE` (or not finite) means the bar is not the one analysed
 *   (`anchor_mismatch`), anything else is the adjustment factor the subject prices are
 *   multiplied by. A bar that was still forming cannot be compared exactly: the factor is
 *   `1` and `anchorForming` is `true`, but a ratio outside `ANCHOR_FORMING_RANGE` still
 *   reports a jump of price basis as `anchor_mismatch` (a small dividend adjustment stays
 *   inside that band and is not corrected). The reference price of a forming anchor is the
 *   close seen at analysis time, and it must lie inside the anchor bar's final
 *   `[low, high]` widened by `ANCHOR_FORMING_REF_TOLERANCE` (1%) on each side, else
 *   `anchor_mismatch`: a price this bar cannot have printed is a basis jump the loose band
 *   misses (the factor reported is still `bar close / close seen`).
 * - The window needs `OUTCOME_WINDOW_BARS` usable bars after the anchor, each strictly
 *   later than the one before; fewer is `insufficient_forward` with how many it has, and a
 *   bar with a bad price or a time that is not increasing ends the usable run instead of
 *   being read as a price.
 *
 * @param closedBars - A symbol's closed bars, oldest first.
 * @param anchor - Which bar the analysis was made on.
 * @returns The window, or why none can be built.
 */
export function buildOutcomeWindow(
    closedBars: readonly Bar[],
    anchor: OutcomeAnchor
): OutcomeWindowResult {
    const i0 = resolveAnchorIndex(closedBars, anchor);
    const readFrom = i0 === null ? 0 : Math.max(0, i0 - (OUTCOME_PRE_BARS - 1));
    if (i0 === null || !cleanSeries(closedBars.slice(readFrom, i0 + 1))) {
        return { status: 'anchor_missing' };
    }
    const anchorBar = closedBars[i0];
    const closedAtAnalysis = 'barTime' in anchor && anchor.closedAtAnalysis;
    const closeAtAnalysis =
        'barTime' in anchor ? anchor.closeAtAnalysis : anchorBar.close;

    const ratio = closeRatio(closeAtAnalysis, anchorBar.close);
    const [minRatio, maxRatio] = closedAtAnalysis
        ? ADJ_FACTOR_RANGE
        : ANCHOR_FORMING_RANGE;
    const seenInsideBar =
        closedAtAnalysis ||
        (closeAtAnalysis >=
            anchorBar.low * (1 - ANCHOR_FORMING_REF_TOLERANCE) &&
            closeAtAnalysis <=
                anchorBar.high * (1 + ANCHOR_FORMING_REF_TOLERANCE));
    if (!(seenInsideBar && ratio >= minRatio && ratio <= maxRatio)) {
        return {
            status: 'anchor_mismatch',
            factor: Number.isFinite(ratio) ? ratio : null,
        };
    }
    const adjFactor =
        closedAtAnalysis && Math.abs(ratio - 1) > ADJ_FACTOR_EPSILON
            ? ratio
            : 1;

    const forward = closedBars.slice(i0 + 1);
    const have = usableForwardCount(forward, anchorBar.time);
    if (have < OUTCOME_WINDOW_BARS) {
        return {
            status: 'insufficient_forward',
            have,
            need: OUTCOME_WINDOW_BARS,
        };
    }

    const anchorForming = !closedAtAnalysis;
    const referencePrice = anchorForming ? closeAtAnalysis : anchorBar.close;
    const preBars = closedBars.slice(readFrom, i0 + 1);
    const atr = calculateATR(preBars).at(-1) ?? null;
    const preCloses = preBars.map(bar => bar.close);

    return {
        status: 'ok',
        window: {
            referencePrice,
            adjFactor,
            anchorForming,
            anchorBar: toTuple(anchorBar),
            anchorSource:
                'generatedAtMs' in anchor ? 'generated_at' : 'prompt_bar',
            atr,
            preCloses: [...preCloses.slice(0, -1), referencePrice],
            forward: forward.slice(0, OUTCOME_WINDOW_BARS).map(toTuple),
        },
    };
}
