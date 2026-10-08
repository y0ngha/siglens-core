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
    PRIOR_TREND_BARS,
    PRIOR_TREND_MIN_ATR,
    RECTANGLE_FLAT_DRIFT_PRICE_PCT,
    RECTANGLE_MIN_TOUCHES,
    TRENDLINE_MIN_WINDOW_PIVOTS,
    TRENDLINE_PIVOT_WINDOW,
    WEDGE_MIN_TOUCHES,
} from '@/domain/patterns/constants';
import {
    type QualifyContext,
    minHeight,
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
 */
export function qualifyTrendlines(ctx: QualifyContext): QualifiedPattern[] {
    let best: { pattern: QualifiedPattern; ratio: number } | null = null;
    for (
        let size = Math.min(TRENDLINE_PIVOT_WINDOW, ctx.pivots.length);
        size >= TRENDLINE_MIN_WINDOW_PIVOTS;
        size--
    ) {
        const pattern = qualifyTrendlineWindow(ctx, ctx.pivots.slice(-size));
        if (pattern === null) continue;
        const ratio = pattern.touches / size;
        // Sizes run longest first, so a strict `>` keeps the longer window on a tie.
        if (best === null || ratio > best.ratio) best = { pattern, ratio };
    }
    return best ? [best.pattern] : [];
}

function qualifyTrendlineWindow(
    ctx: QualifyContext,
    window: readonly PivotPoint[]
): QualifiedPattern | null {
    const from = window[0].index;
    const to = window[window.length - 1].index;
    if (to - from + 1 < LINE_PATTERN_MIN_BARS) return null;
    const upper = fitBoundaryLine(
        window.filter(p => p.kind === 'high'),
        ctx.bars,
        'upper',
        from,
        to,
        ctx.atr
    );
    const lower = fitBoundaryLine(
        window.filter(p => p.kind === 'low'),
        ctx.bars,
        'lower',
        from,
        to,
        ctx.atr
    );
    if (upper === null || lower === null || !boundariesInterleave(upper, lower))
        return null;

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

/**
 * §3.2: the close change over the `PRIOR_TREND_BARS` bars before the pattern
 * start sets the direction once it reaches `PRIOR_TREND_MIN_ATR`·ATR;
 * otherwise the direction stays undetermined (`null`).
 */
function priorTrend(
    ctx: QualifyContext,
    start: number
): PatternBreakoutDirection | null {
    const from = Math.max(0, start - PRIOR_TREND_BARS);
    const change = ctx.bars[start].close - ctx.bars[from].close;
    if (Math.abs(change) < PRIOR_TREND_MIN_ATR * ctx.atr) return null;
    return change > 0 ? 'up' : 'down';
}
