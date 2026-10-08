import type {
    ChartPatternId,
    PatternBreakoutDirection,
    PatternLine,
    PivotPoint,
    QualifiedPattern,
} from '@/domain/types';
import {
    classifyLineDrift,
    fitBoundaryLine,
    lineValueAt,
    parallelBoundaryLine,
    trendlineHeight,
} from '@/domain/patterns/boundaryLines';
import {
    BOUNDARY_MIN_TOUCHES,
    BROADENING_MIN_SIDE_TOUCHES,
    BROADENING_MIN_TOTAL_TOUCHES,
    BROADENING_MIN_WIDTH_RATIO,
    CONVERGING_MAX_WIDTH_RATIO,
    LINE_PATTERN_MIN_BARS,
    PARALLEL_MAX_WIDTH_RATIO,
    PARALLEL_MIN_WIDTH_RATIO,
    RECTANGLE_FLAT_DRIFT_PRICE_PCT,
    RECTANGLE_MIN_TOUCHES,
    TRENDLINE_MAX_WINDOW_PIVOTS,
    TRENDLINE_MIN_WINDOW_PIVOTS,
    TRENDLINE_PIVOT_WINDOW,
    WEDGE_MIN_TOUCHES,
} from '@/domain/patterns/constants';
import {
    type QualifyContext,
    minHeight,
    priorTrend,
} from '@/domain/patterns/qualify/context';

// ─── Boundary pairs: triangles, wedges, channels, rectangle (§2.2–§3.2) ───

const FIXED_TRENDLINE_DIRECTION: Partial<
    Record<ChartPatternId, PatternBreakoutDirection>
> = {
    ascending_triangle: 'up',
    descending_triangle: 'down',
    ascending_wedge: 'down',
    descending_wedge: 'up',
};

/**
 * @internal
 * Tries windows of the last `TRENDLINE_PIVOT_WINDOW` down to
 * `TRENDLINE_MIN_WINDOW_PIVOTS` confirmed pivots and keeps the qualified
 * window whose pivots most often touch their boundary (then the longer
 * one). Starting later is how a deep, early outlier low drops out instead of
 * dragging the support line under every later low.
 *
 * The chosen window is then grown backwards ({@link extendBackwards}), so a
 * maturing pattern keeps its first touches when newer pivots confirm: with a
 * fixed window the ninth confirmed pivot pushed the first touch out, moving
 * the start, the overlay id, the height and the target (spec 2026-10-07
 * §3.1 — levels are fixed once their touches confirm).
 */
export function qualifyTrendlines(ctx: QualifyContext): QualifiedPattern[] {
    const largest = Math.min(TRENDLINE_PIVOT_WINDOW, ctx.pivots.length);
    // 큰 창부터 작은 창 순서다 — 아래 `reduce`가 엄격한 `>`로 비교하므로 비율이 같으면
    // 먼저 온(더 긴) 창이 남는다.
    const sizes = Array.from(
        { length: Math.max(0, largest - TRENDLINE_MIN_WINDOW_PIVOTS + 1) },
        (_, k) => largest - k
    );
    const best = sizes.reduce<{
        pattern: QualifiedPattern;
        ratio: number;
        size: number;
    } | null>((acc, size) => {
        const pattern = qualifyTrendlineWindow(ctx, ctx.pivots.slice(-size));
        if (pattern === null) return acc;
        const ratio = pattern.touches / size;
        return acc === null || ratio > acc.ratio
            ? { pattern, ratio, size }
            : acc;
    }, null);
    return best ? [extendBackwards(ctx, best.pattern, best.size)] : [];
}

/**
 * Grows a qualified window one earlier pivot at a time, up to
 * `TRENDLINE_MAX_WINDOW_PIVOTS`, and returns the longest version that gained
 * touches. A longer window is accepted only while it still qualifies as the
 * same pattern and both boundaries keep every touch they had — the same
 * lines, now confirmed further back. An earlier pivot that is not a touch is
 * stepped over (the next one back may be); the growth stops at the first
 * window that breaks containment, changes the family or drops a touch, so a
 * deep outlier never re-enters.
 */
function extendBackwards(
    ctx: QualifyContext,
    pattern: QualifiedPattern,
    size: number
): QualifiedPattern {
    let best = pattern;
    const limit = Math.min(TRENDLINE_MAX_WINDOW_PIVOTS, ctx.pivots.length);
    for (let next = size + 1; next <= limit; next++) {
        const longer = qualifyTrendlineWindow(ctx, ctx.pivots.slice(-next));
        if (longer === null || !keepsBoundaries(longer, best)) break;
        if (longer.touches > best.touches) best = longer;
    }
    return best;
}

/** Whether `longer` is the same pattern as `shorter` with every touch of both boundaries kept. */
function keepsBoundaries(
    longer: QualifiedPattern,
    shorter: QualifiedPattern
): boolean {
    if (
        longer.id !== shorter.id ||
        longer.shape.kind !== 'trendline' ||
        shorter.shape.kind !== 'trendline'
    )
        return false;
    const keeps = (wide: PatternLine, narrow: PatternLine): boolean =>
        narrow.touches.every(t => wide.touches.some(w => w.index === t.index));
    return (
        keeps(longer.shape.upper, shorter.shape.upper) &&
        keeps(longer.shape.lower, shorter.shape.lower)
    );
}

/**
 * One window's boundary pair: the two lines fitted independently
 * (`fitBoundaryLine`). Only when that pair does not qualify is a channel
 * tried from one fitted line and its parallel through the opposite side's
 * extreme ({@link parallelChannel}) — the parallel construction rescues a
 * channel whose second side has no straight line through two of its
 * pivots; it never replaces a qualified pair (a triangle or wedge ranks
 * above a channel in arbitration, and a tie would otherwise hand it over).
 */
function qualifyTrendlineWindow(
    ctx: QualifyContext,
    window: readonly PivotPoint[]
): QualifiedPattern | null {
    const from = window[0].index;
    const to = window[window.length - 1].index;
    if (to - from + 1 < LINE_PATTERN_MIN_BARS) return null;
    const highs = window.filter(p => p.kind === 'high');
    const lows = window.filter(p => p.kind === 'low');
    const upper = fitBoundaryLine(highs, ctx.bars, 'upper', from, to, ctx.atr);
    const lower = fitBoundaryLine(lows, ctx.bars, 'lower', from, to, ctx.atr);
    const fitted =
        upper === null || lower === null
            ? null
            : patternFromBoundaries(ctx, window, upper, lower);
    if (fitted !== null) return fitted;
    return [
        upper === null
            ? null
            : parallelChannel(ctx, window, upper, lows, 'lower', from, to),
        lower === null
            ? null
            : parallelChannel(ctx, window, lower, highs, 'upper', from, to),
    ].reduce<QualifiedPattern | null>(
        (best, p) =>
            p !== null && (best === null || p.touches > best.touches)
                ? p
                : best,
        null
    );
}

const CHANNEL_IDS: ReadonlySet<ChartPatternId> = new Set([
    'ascending_channel',
    'descending_channel',
]);

/**
 * A channel built from `guide` (one side's fitted boundary) and its
 * parallel through the opposite side's extreme pivot
 * (`parallelBoundaryLine`). The parallel's own `BOUNDARY_MIN_TOUCHES`
 * touches are required by `boundariesInterleave`, like any boundary's. Only
 * a channel may come out of it: two flat parallels would otherwise read as a
 * rectangle the independent fit rejected, and the rectangle rules are not
 * meant to loosen with this construction.
 */
function parallelChannel(
    ctx: QualifyContext,
    window: readonly PivotPoint[],
    guide: PatternLine,
    opposite: readonly PivotPoint[],
    side: 'upper' | 'lower',
    from: number,
    to: number
): QualifiedPattern | null {
    const line = parallelBoundaryLine(
        guide,
        opposite,
        ctx.bars,
        side,
        from,
        to,
        ctx.atr
    );
    if (line === null) return null;
    const pattern =
        side === 'lower'
            ? patternFromBoundaries(ctx, window, guide, line)
            : patternFromBoundaries(ctx, window, line, guide);
    return pattern !== null && CHANNEL_IDS.has(pattern.id) ? pattern : null;
}

/** The family, size and direction checks every boundary pair goes through. */
function patternFromBoundaries(
    ctx: QualifyContext,
    window: readonly PivotPoint[],
    upper: PatternLine,
    lower: PatternLine
): QualifiedPattern | null {
    const from = window[0].index;
    const to = window[window.length - 1].index;
    if (!boundariesInterleave(upper, lower)) return null;

    const startWidth = lineValueAt(upper, from) - lineValueAt(lower, from);
    const endWidth = lineValueAt(upper, to) - lineValueAt(lower, to);
    if (!(startWidth > 0 && endWidth > 0)) return null;
    const price = ctx.bars[to].close;
    const id = trendlinePatternId(
        lineValueAt(upper, to) - lineValueAt(upper, from),
        lineValueAt(lower, to) - lineValueAt(lower, from),
        endWidth / startWidth,
        upper,
        lower,
        ctx.atr,
        price
    );
    if (id === null) return null;
    if (trendlineHeight(id, upper, lower) < minHeight(ctx, price)) return null;

    return {
        id,
        startIndex: Math.min(upper.start.index, lower.start.index),
        endIndex: Math.max(upper.end.index, lower.end.index),
        pivots: window,
        shape: {
            kind: 'trendline',
            upper,
            lower,
            direction:
                FIXED_TRENDLINE_DIRECTION[id] ??
                priorTrend(ctx, Math.min(upper.start.index, lower.start.index)),
        },
        touches: upper.touches.length + lower.touches.length,
    };
}

/**
 * Both boundaries are in play at the same time: each keeps at least
 * `BOUNDARY_MIN_TOUCHES` touches from the other boundary's first touch on.
 * Not in the spec's table — without it a double top's rally low, trough and
 * two peaks (low-high-low-high) read as an ascending triangle and, ranked
 * above doubles in arbitration, displaced it. A boundary that only "touches"
 * before the other one starts is the trend leading into the pattern.
 */
function boundariesInterleave(upper: PatternLine, lower: PatternLine): boolean {
    const touchesFrom = (line: PatternLine, start: number): number =>
        line.touches.filter(t => t.index >= start).length;
    return (
        touchesFrom(upper, lower.start.index) >= BOUNDARY_MIN_TOUCHES &&
        touchesFrom(lower, upper.start.index) >= BOUNDARY_MIN_TOUCHES
    );
}

/**
 * The §2.3 table: each boundary is flat / rising / falling by its total move
 * over the span (a dead band in between is "not drawable"), and the width
 * ratio separates converging (triangles, wedges), parallel (channels) and
 * diverging (broadening) pairs. Wedges need `WEDGE_MIN_TOUCHES` per side,
 * the broadening formation `BROADENING_MIN_TOTAL_TOUCHES` in total with
 * `BROADENING_MIN_SIDE_TOUCHES` on one side. A rectangle is two lines flat by
 * its own looser price share, touched `RECTANGLE_MIN_TOUCHES` times each.
 */
function trendlinePatternId(
    upperMove: number,
    lowerMove: number,
    widthRatio: number,
    upper: PatternLine,
    lower: PatternLine,
    atr: number,
    price: number
): ChartPatternId | null {
    const u = classifyLineDrift(upperMove, atr, price);
    const l = classifyLineDrift(lowerMove, atr, price);
    const converging = widthRatio <= CONVERGING_MAX_WIDTH_RATIO;
    const parallel =
        widthRatio >= PARALLEL_MIN_WIDTH_RATIO &&
        widthRatio <= PARALLEL_MAX_WIDTH_RATIO;
    const upperTouches = upper.touches.length;
    const lowerTouches = lower.touches.length;
    const wedgeTouches =
        upperTouches >= WEDGE_MIN_TOUCHES && lowerTouches >= WEDGE_MIN_TOUCHES;

    if (u === 'flat' && l === 'rising')
        return converging ? 'ascending_triangle' : null;
    if (u === 'falling' && l === 'flat')
        return converging ? 'descending_triangle' : null;
    if (u === 'falling' && l === 'rising')
        return converging ? 'symmetrical_triangle' : null;
    if (u === 'rising' && l === 'rising')
        return sameDirectionId(
            converging && wedgeTouches,
            parallel,
            'ascending_wedge',
            'ascending_channel'
        );
    if (u === 'falling' && l === 'falling')
        return sameDirectionId(
            converging && wedgeTouches,
            parallel,
            'descending_wedge',
            'descending_channel'
        );
    if (u === 'rising' && l === 'falling') {
        const broadening =
            widthRatio >= BROADENING_MIN_WIDTH_RATIO &&
            upperTouches + lowerTouches >= BROADENING_MIN_TOTAL_TOUCHES &&
            Math.max(upperTouches, lowerTouches) >= BROADENING_MIN_SIDE_TOUCHES;
        return broadening ? 'broadening_formation' : null;
    }
    const rectangleFlat = (move: number): boolean =>
        classifyLineDrift(move, atr, price, RECTANGLE_FLAT_DRIFT_PRICE_PCT) ===
        'flat';
    const rectangleTouches =
        upperTouches >= RECTANGLE_MIN_TOUCHES &&
        lowerTouches >= RECTANGLE_MIN_TOUCHES;
    return rectangleTouches &&
        rectangleFlat(upperMove) &&
        rectangleFlat(lowerMove)
        ? 'rectangle'
        : null;
}

function sameDirectionId(
    wedge: boolean,
    channel: boolean,
    wedgeId: ChartPatternId,
    channelId: ChartPatternId
): ChartPatternId | null {
    if (wedge) return wedgeId;
    return channel ? channelId : null;
}
