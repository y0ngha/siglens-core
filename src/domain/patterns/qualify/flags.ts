import type {
    ChartPatternId,
    PatternBreakoutDirection,
    PatternLine,
    PatternPoint,
    PivotPoint,
    QualifiedPattern,
} from '@/domain/types';
import { detectHighTightFlagAnchors } from '@/domain/patterns/classifiers';
import {
    classifyLineDrift,
    fitBoundaryLine,
    lineValueAt,
} from '@/domain/patterns/boundaryLines';
import {
    BOUNDARY_CONTAINMENT_ATR,
    BOUNDARY_MIN_TOUCHES,
    CONVERGING_MAX_WIDTH_RATIO,
    FLAG_MAX_BARS,
    FLAG_MAX_BEYOND_POLE_ATR,
    FLAG_MAX_RETRACE,
    FLAG_MAX_START_WIDTH_POLE_SHARE,
    FLAG_MIN_TOUCH_SPACING_BARS,
    FLAG_MIN_BARS,
    FLAG_POLE_MAX_BARS,
    FLAG_POLE_MIN_ATR,
    FLAT_DRIFT_ATR,
    FLAT_DRIFT_PRICE_PCT,
    PARALLEL_MAX_WIDTH_RATIO,
} from '@/domain/patterns/constants';
import {
    type QualifyContext,
    minHeight,
    extremePoint,
    isLower,
    isHigher,
    barPoints,
    barLow,
    barHigh,
    lowestConfirmedLowAfter,
    isRecent,
    maxAgeBars,
} from '@/domain/patterns/qualify/context';

// ─── Flags and pennants (§3.4) ──────────────────────────────────────────────

/** Age window of the longest possible pole-plus-flag span (loop cutoff in `qualifyFlags`). */
const LONGEST_FLAG_MAX_AGE = maxAgeBars(FLAG_POLE_MAX_BARS + FLAG_MAX_BARS);

/**
 * @internal
 * The most recent pole — two consecutive confirmed pivots, base to top, at
 * least `FLAG_POLE_MIN_ATR`·ATR (and the height floor) over at most
 * `FLAG_POLE_MAX_BARS` bars — followed by `FLAG_MIN_BARS`–`FLAG_MAX_BARS`
 * bars of flag. The flag channel is fitted on the flag bars' swing highs
 * and lows (a short flag rarely holds a 1.5-ATR pivot); the two edges must
 * overlap in time. Whether the channel reads as a flag or a pennant is
 * decided by `flagPatternId` (see its JSDoc). When the newest bars have
 * already left the channel, the fit is retried on a shorter flag (down to
 * `FLAG_MIN_BARS`) so the breakout leg reads as a break, not as the end of
 * the pattern. The flag's age is counted to the fitted end, so a flag stays
 * drawn after its breakout while it is recent (`isRecent`) and not spent.
 * The flag bars stay within `FLAG_MAX_BEYOND_POLE_ATR`·ATR of the pole's end
 * and the channel starts at most `FLAG_MAX_START_WIDTH_POLE_SHARE` of the
 * pole wide.
 */
export function qualifyFlags(ctx: QualifyContext): QualifiedPattern[] {
    for (let i = ctx.pivots.length - 1; i >= 1; i--) {
        const top = ctx.pivots[i];
        const sinceTop = ctx.lastIndex - top.index;
        // No flag of an older top can still be recent: it ends within
        // FLAG_MAX_BARS of the top, and its age window is that of the longest
        // pole-plus-flag span.
        if (sinceTop > FLAG_MAX_BARS + LONGEST_FLAG_MAX_AGE) break;
        if (sinceTop < FLAG_MIN_BARS) continue;
        const q = qualifyFlagFromPole(ctx, ctx.pivots[i - 1], top);
        if (q) return [q];
    }
    return [];
}

/**
 * The bar highs (lows) that are swing points inside the flag: neither
 * neighbour goes beyond them. Not in the spec, which fits the flag channel on
 * every bar: consecutive bars of one straight leg are collinear, so "most
 * touches" then picks a line along a single leg instead of the line across
 * the flag's swings. The two end bars have one neighbour and are left out —
 * otherwise a breakout bar at the right edge would anchor a channel drawn
 * around itself and the flag could never read "broken".
 */
function localExtremes(
    points: readonly PatternPoint[],
    better: (candidate: number, best: number) => boolean
): PatternPoint[] {
    return points.filter(
        (p, i) =>
            i > 0 &&
            i < points.length - 1 &&
            !better(points[i - 1].price, p.price) &&
            !better(points[i + 1].price, p.price)
    );
}

/**
 * A flag consolidates: each channel line keeps at least
 * `BOUNDARY_MIN_TOUCHES` bars that touch it and not the other line, at
 * least `FLAG_MIN_TOUCH_SPACING_BARS` apart. Not in the spec — a straight
 * pullback leg fits two "parallel" lines one bar range apart that every bar
 * touches at once, which read as a flag after any pole-sized swing; and two
 * neighbouring bars on one line are one test of it.
 */
function touchesOneSideOnly(upper: PatternLine, lower: PatternLine): boolean {
    const onlyOn = (line: PatternLine, other: PatternLine): number =>
        spacedCount(
            line.touches.filter(
                t => !other.touches.some(o => o.index === t.index)
            )
        );
    return (
        onlyOn(upper, lower) >= BOUNDARY_MIN_TOUCHES &&
        onlyOn(lower, upper) >= BOUNDARY_MIN_TOUCHES
    );
}

/** Touches counted left to right, skipping any closer than `FLAG_MIN_TOUCH_SPACING_BARS` to the last counted one. */
function spacedCount(touches: readonly PatternPoint[]): number {
    return touches.reduce<{ count: number; last: number }>(
        (acc, t) =>
            t.index - acc.last >= FLAG_MIN_TOUCH_SPACING_BARS
                ? { count: acc.count + 1, last: t.index }
                : acc,
        { count: 0, last: -Infinity }
    ).count;
}

function qualifyFlagFromPole(
    ctx: QualifyContext,
    base: PivotPoint,
    top: PivotPoint
): QualifiedPattern | null {
    const pole = Math.abs(top.price - base.price);
    if (top.index - base.index > FLAG_POLE_MAX_BARS) return null;
    if (pole < Math.max(FLAG_POLE_MIN_ATR * ctx.atr, minHeight(ctx, top.price)))
        return null;
    const latestEnd = Math.min(ctx.lastIndex, top.index + FLAG_MAX_BARS);
    const first = firstFit(ctx, base, top, pole, latestEnd);
    if (first === null) return null;
    for (let end = latestEnd; end - top.index >= FLAG_MIN_BARS; end--) {
        const latest = fitFlag(ctx, base, top, end, pole, true);
        if (latest === null) continue;
        // Flag or pennant stays as first read (see firstFit); the drawing
        // is the newest fit only while it reads the same way, so the label
        // and the drawn channel never disagree.
        const chosen = latest.id === first.id ? latest : first;
        return isRecent(ctx, chosen.endIndex, chosen.endIndex - base.index)
            ? chosen
            : null;
    }
    return null;
}

/**
 * The flag as first read: the shortest fit (`FLAG_MIN_BARS` on), whether or
 * not price has left it yet. Those bars never change, so its flag-or-pennant
 * label is fixed once the flag first qualifies; reading the label from every
 * newer, longer fit flipped it between consecutive bars as a new touch
 * tilted the lines (2026-10-08 replay sweep: pennant → bear flag → pennant
 * on three bars).
 */
function firstFit(
    ctx: QualifyContext,
    base: PivotPoint,
    top: PivotPoint,
    pole: number,
    latestEnd: number
): QualifiedPattern | null {
    for (let end = top.index + FLAG_MIN_BARS; end <= latestEnd; end++) {
        const q = fitFlag(ctx, base, top, end, pole, false);
        if (q !== null) return q;
    }
    return null;
}

function fitFlag(
    ctx: QualifyContext,
    base: PivotPoint,
    top: PivotPoint,
    end: number,
    pole: number,
    requireExit: boolean
): QualifiedPattern | null {
    const direction: PatternBreakoutDirection =
        top.kind === 'high' ? 'up' : 'down';
    const sign = direction === 'up' ? 1 : -1;
    const from = top.index + 1;
    const lows = barPoints(ctx.bars, from, end, barLow);
    const highs = barPoints(ctx.bars, from, end, barHigh);
    const flagExtreme =
        direction === 'up'
            ? extremePoint(lows, isLower)
            : extremePoint(highs, isHigher);
    if (sign * (top.price - flagExtreme.price) > FLAG_MAX_RETRACE * pole)
        return null;
    // No flag bar runs past the pole's end (FLAG_MAX_BEYOND_POLE_ATR).
    const beyondPole =
        direction === 'up'
            ? Math.max(...highs.map(p => p.price)) - top.price
            : top.price - Math.min(...lows.map(p => p.price));
    if (beyondPole > FLAG_MAX_BEYOND_POLE_ATR * ctx.atr) return null;

    const upper = fitBoundaryLine(
        localExtremes(highs, isHigher),
        ctx.bars,
        'upper',
        from,
        end,
        ctx.atr
    );
    const lower = fitBoundaryLine(
        localExtremes(lows, isLower),
        ctx.bars,
        'lower',
        from,
        end,
        ctx.atr
    );
    if (
        upper === null ||
        lower === null ||
        Math.max(upper.start.index, lower.start.index) >
            Math.min(upper.end.index, lower.end.index) ||
        !touchesOneSideOnly(upper, lower)
    )
        return null;
    const startWidth = lineValueAt(upper, from) - lineValueAt(lower, from);
    const endWidth = lineValueAt(upper, end) - lineValueAt(lower, end);
    if (!(startWidth > 0 && endWidth > 0)) return null;
    if (startWidth > FLAG_MAX_START_WIDTH_POLE_SHARE * pole) return null;
    // A flag that ends before the last bar ends because price left it: the
    // next bar is outside the channel. One still inside means the range
    // simply went on — past FLAG_MAX_BARS that is a box, not a flag.
    if (
        requireExit &&
        end < ctx.lastIndex &&
        staysInside(ctx, upper, lower, end + 1)
    )
        return null;

    // Flag vs pennant is read over the channel's own touches (first to last
    // touch of either line), which only move when a new touch confirms —
    // read from the flag's first bar to its last, the label flipped between
    // consecutive bars as the end crept along (2026-10-08 replay sweep).
    const a = Math.min(upper.start.index, lower.start.index);
    const b = Math.max(upper.end.index, lower.end.index);
    const touchStartWidth = lineValueAt(upper, a) - lineValueAt(lower, a);
    const touchEndWidth = lineValueAt(upper, b) - lineValueAt(lower, b);
    if (!(touchStartWidth > 0 && touchEndWidth > 0)) return null;
    const id = flagPatternId(
        ctx,
        direction,
        touchEndWidth / touchStartWidth,
        lineValueAt(upper, b) - lineValueAt(upper, a),
        lineValueAt(lower, b) - lineValueAt(lower, a),
        ctx.bars[end].close
    );
    if (id === null) return null;

    return {
        id,
        startIndex: base.index,
        endIndex: end,
        pivots: [base, top],
        shape: {
            kind: 'flag',
            direction,
            poleBase: base,
            poleTop: top,
            upper,
            lower,
            flagExtreme,
        },
        touches: upper.touches.length + lower.touches.length,
    };
}

/** Whether bar `i` lies within both channel lines (by the containment slack). */
function staysInside(
    ctx: QualifyContext,
    upper: PatternLine,
    lower: PatternLine,
    i: number
): boolean {
    const slack = BOUNDARY_CONTAINMENT_ATR * ctx.atr;
    const bar = ctx.bars[i];
    return (
        bar.high <= lineValueAt(upper, i) + slack &&
        bar.low >= lineValueAt(lower, i) - slack
    );
}

/**
 * Flag or pennant from the channel's width ratio (end over start) and its
 * two edges' moves. Lines that are not converging (ratio above
 * `CONVERGING_MAX_WIDTH_RATIO`, at most `PARALLEL_MAX_WIDTH_RATIO`) and do
 * not move with the pole by more than the flat bound make a bull or bear
 * flag; converging lines whose upper edge is not rising and lower edge not
 * falling (§2.3 classes) make a pennant. No dead band between the two
 * (unlike channel vs. wedge): a dozen bars of flag give a noisy width ratio,
 * and a band would drop the many flags that narrow a little as they drift
 * against the pole.
 */
function flagPatternId(
    ctx: QualifyContext,
    direction: PatternBreakoutDirection,
    widthRatio: number,
    upperMove: number,
    lowerMove: number,
    price: number
): ChartPatternId | null {
    const sign = direction === 'up' ? 1 : -1;
    const flatBound = Math.min(
        FLAT_DRIFT_ATR * ctx.atr,
        FLAT_DRIFT_PRICE_PCT * price
    );
    const flag =
        widthRatio > CONVERGING_MAX_WIDTH_RATIO &&
        widthRatio <= PARALLEL_MAX_WIDTH_RATIO &&
        sign * upperMove <= flatBound &&
        sign * lowerMove <= flatBound;
    if (flag) return direction === 'up' ? 'bull_flag' : 'bear_flag';
    const pennant =
        widthRatio <= CONVERGING_MAX_WIDTH_RATIO &&
        classifyLineDrift(upperMove, ctx.atr, price) !== 'rising' &&
        classifyLineDrift(lowerMove, ctx.atr, price) !== 'falling';
    return pennant ? 'pennant' : null;
}

// ─── High tight flag (§3.5) ─────────────────────────────────────────────────

/**
 * @internal
 * The pre-screener's high-tight-flag rule, read on the bars up to the last
 * confirmed pivot, plus the common rules: the pole top must be a confirmed
 * pivot and the flag low (the invalidation) is a confirmed swing low after
 * the top. The height floor needs no check of its own (see below).
 */
export function qualifyHighTightFlag(ctx: QualifyContext): QualifiedPattern[] {
    const lastPivot = ctx.pivots[ctx.pivots.length - 1];
    if (lastPivot === undefined) return [];
    // Read the rule on the bars up to the last confirmed pivot: a breakout
    // leg above the pole top would otherwise become the "top" itself (with
    // no flag after it) and the pattern would vanish the day it breaks out.
    const anchors = detectHighTightFlagAnchors(
        ctx.bars.slice(0, lastPivot.index + 1)
    );
    if (anchors === null) return [];
    const { base, top } = anchors;
    const confirmedTop = ctx.pivots.some(
        p => p.kind === 'high' && p.index === top.index
    );
    const flagLow = lowestConfirmedLowAfter(ctx, top.index);
    // No separate height-floor check: a confirmed top has a pullback of at
    // least PIVOT_REVERSAL_ATR_MULT (1.5) ATR, which the HTF_FLAG_MAX_RETRACE
    // (25%) rule caps at a quarter of the top — so the top is at least 6 ATR,
    // and a pole of at least HTF_POLE_MIN_GAIN (+90%) is then at least
    // 0.47 × top: over 2.8 ATR and far over 3% of price. The floor always holds.
    if (!confirmedTop || flagLow === null) return [];
    return [
        {
            id: 'high_tight_flag',
            startIndex: base.index,
            endIndex: lastPivot.index,
            pivots: [base, top],
            shape: {
                kind: 'high_tight_flag',
                poleBase: base,
                poleTop: top,
                flagLow: { index: flagLow.index, price: flagLow.price },
            },
            touches: 2,
        },
    ];
}
