import type {
    Bar,
    PatternPoint,
    PivotKind,
    PivotPoint,
    QualifiedPattern,
} from '@/domain/types';
import { fitQuadratic } from '@/domain/patterns/classifiers';
import {
    BOUNDARY_CONTAINMENT_ATR,
    CUP_HANDLE_MAX_DEPTH_RATIO,
    CUP_MIN_BARS,
    CUP_PRIOR_ADVANCE_SPAN_SHARE,
    CUP_RIM_MATCH_MAX_PRICE_PCT,
    CUP_RIM_MAX_DEPTH_SHARE,
    CURVATURE_VERTEX_MID_HI,
    CURVATURE_VERTEX_MID_LO,
    HANDLE_MAX_BARS,
    HANDLE_MIN_BARS,
    RIM_MATCH_MAX_PRICE_PCT,
    ROUNDING_ARC_SAMPLES,
    ROUNDING_MIN_R2,
    U_EXTREME_BAND,
    U_EXTREME_MIN_SHARE,
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
} from '@/domain/patterns/qualify/context';

// ─── Cup & handle and rounding ──────────────────────────────────────────────

/** Which way a curved base opens: a bottom holds a U under high rims, a top a dome over low rims. */
type CurveShape = 'bottom' | 'top';

interface RimSpan {
    /** Lowest low (bottom) / highest high (top) between the rims. */
    extreme: PatternPoint;
    /** Right rim to extreme. */
    depth: number;
}

/**
 * The checks a cup and a rounding base share: rims (confirmed pivots of the
 * rim kind) at least `CUP_MIN_BARS` apart, within `rimMatchPct` of each
 * other (`RIM_MATCH_MAX_PRICE_PCT` for a rounding base,
 * `CUP_RIM_MATCH_MAX_PRICE_PCT` for a cup) AND within
 * `CUP_RIM_MAX_DEPTH_SHARE` of the depth; no bar inside the bowl beyond
 * the LOWER rim (the upper one, for a top) by more than the containment
 * slack (`breaksInnerRim`);
 * a depth past the height floor on BOTH sides — measured from the lower rim
 * — and a U rather than a V (`isUShaped`).
 */
function measureRimSpan(
    ctx: QualifyContext,
    left: PivotPoint,
    right: PivotPoint,
    shape: CurveShape,
    rimMatchPct: number
): RimSpan | null {
    if (right.index - left.index + 1 < CUP_MIN_BARS) return null;
    const rimGap = Math.abs(left.price - right.price);
    if (rimGap > rimMatchPct * Math.max(left.price, right.price)) return null;
    const sign = shape === 'bottom' ? 1 : -1;
    // The rim nearer the extreme: the lower of a bottom's, the higher of a top's.
    const innerRim = sign * Math.min(sign * left.price, sign * right.price);
    const slack = BOUNDARY_CONTAINMENT_ATR * ctx.atr;
    const beyondRim = (bar: Bar): boolean =>
        shape === 'bottom'
            ? bar.high > innerRim + slack
            : bar.low < innerRim - slack;
    if (breaksInnerRim(ctx.bars, left.index, right.index, beyondRim))
        return null;
    const extreme =
        shape === 'bottom'
            ? extremePoint(
                  barPoints(ctx.bars, left.index + 1, right.index - 1, barLow),
                  isLower
              )
            : extremePoint(
                  barPoints(ctx.bars, left.index + 1, right.index - 1, barHigh),
                  isHigher
              );
    const depth = sign * (right.price - extreme.price);
    const innerDepth = sign * (innerRim - extreme.price);
    if (innerDepth < minHeight(ctx, innerRim)) return null;
    if (rimGap > CUP_RIM_MAX_DEPTH_SHARE * innerDepth) return null;
    if (
        !isUShaped(
            ctx.bars,
            left.index,
            right.index,
            extreme.price,
            depth,
            shape
        )
    )
        return null;
    return { extreme, depth };
}

/**
 * Whether a bar between the rims pokes beyond the inner rim (`beyondRim`)
 * once price has left the rims: the bars of the higher rim's own leg —
 * before price first gets back inside the inner rim from the left, after it
 * last was inside on the right — sit above the lower rim by construction
 * and are not counted. Anywhere else such a bar means the base is not one
 * bowl (a staircase of rising highs, a second peak in the middle).
 */
function breaksInnerRim(
    bars: readonly Bar[],
    left: number,
    right: number,
    beyondRim: (bar: Bar) => boolean
): boolean {
    // The rims' own legs may sit beyond the lower rim — skip the bars beyond it at
    // both ends, then any bar beyond it in between breaks the cup.
    const interior = bars.slice(left + 1, right);
    const first = interior.findIndex(bar => !beyondRim(bar));
    if (first === -1) return false;
    const last = interior.findLastIndex(bar => !beyondRim(bar));
    return interior.slice(first, last + 1).some(beyondRim);
}

/**
 * Whether the left rim tops the bars before it over
 * `CUP_PRIOR_ADVANCE_SPAN_SHARE` of the cup's span — price advanced into
 * it (by the containment slack). As much history as exists counts.
 */
function hasPriorAdvance(
    ctx: QualifyContext,
    left: PivotPoint,
    right: PivotPoint
): boolean {
    const lookback = Math.ceil(
        CUP_PRIOR_ADVANCE_SPAN_SHARE * (right.index - left.index)
    );
    const slack = BOUNDARY_CONTAINMENT_ATR * ctx.atr;
    return ctx.bars
        .slice(Math.max(0, left.index - lookback), left.index)
        .every(bar => bar.high <= left.price + slack);
}

/**
 * U, not V: at least `U_EXTREME_MIN_SHARE` of the closes between the rims
 * sit within `U_EXTREME_BAND` of the depth from the extreme. A V passes
 * through that band once, quickly.
 */
function isUShaped(
    bars: readonly Bar[],
    from: number,
    to: number,
    extreme: number,
    depth: number,
    shape: CurveShape
): boolean {
    const closes = bars.slice(from, to + 1).map(bar => bar.close);
    const band = U_EXTREME_BAND * depth;
    const near = closes.filter(c =>
        shape === 'bottom' ? c <= extreme + band : c >= extreme - band
    ).length;
    return near / closes.length >= U_EXTREME_MIN_SHARE;
}

/**
 * @internal
 * Cup & handle: rims are confirmed highs, the right rim `HANDLE_MIN_BARS`–
 * `HANDLE_MAX_BARS` bars back; the handle low — the lowest confirmed swing
 * low after the right rim, so it does not follow a falling current leg —
 * sits at or above the cup's midpoint: no deeper than
 * `CUP_HANDLE_MAX_DEPTH_RATIO` of the cup below the right rim. The left rim
 * tops the bars before it (`hasPriorAdvance`) and the bottom sits in the
 * middle half of the span by time. The earliest right rim in
 * the handle window, then the earliest left rim, that passes wins.
 */
export function qualifyCup(ctx: QualifyContext): QualifiedPattern[] {
    const rims = ctx.pivots.filter(p => p.kind === 'high');
    // Right rims oldest first: once a cup qualifies on a right rim, a later
    // high entering the handle window does not re-select it (the cup stays
    // the same drawing until it is spent or ages out).
    const rights = rims.filter((p, r) => {
        const handleBars = ctx.lastIndex - p.index;
        return (
            r >= 1 &&
            handleBars >= HANDLE_MIN_BARS &&
            handleBars <= HANDLE_MAX_BARS
        );
    });
    for (const right of rights) {
        for (const left of rims.filter(p => p.index < right.index)) {
            const q = qualifyCupAt(ctx, left, right);
            if (q) return [q];
        }
    }
    return [];
}

function qualifyCupAt(
    ctx: QualifyContext,
    left: PivotPoint,
    right: PivotPoint
): QualifiedPattern | null {
    if (!hasPriorAdvance(ctx, left, right)) return null;
    const span = measureRimSpan(
        ctx,
        left,
        right,
        'bottom',
        CUP_RIM_MATCH_MAX_PRICE_PCT
    );
    const handleLow = lowestConfirmedLowAfter(ctx, right.index);
    if (span === null || handleLow === null) return null;
    if (!extremeInMiddleHalf(left, right, span.extreme)) return null;
    if (right.price - handleLow.price > CUP_HANDLE_MAX_DEPTH_RATIO * span.depth)
        return null;
    return {
        id: 'cup_and_handle',
        startIndex: left.index,
        endIndex: handleLow.index,
        // Only the cup's own structure, left rim to handle low: a swing after
        // the handle belongs to whatever forms next, and arbitration treats
        // one shared pivot as overlap.
        pivots: ctx.pivots.filter(
            p => p.index >= left.index && p.index <= handleLow.index
        ),
        shape: {
            kind: 'cup',
            leftRim: left,
            rightRim: right,
            bottom: span.extreme,
            handleLow: { index: handleLow.index, price: handleLow.price },
        },
        touches: 4,
    };
}

/**
 * @internal
 * Rounding: the most recent rim pivot is the right rim; the earliest earlier rim
 * that passes is the left one. A quadratic fitted on the closes between the
 * rims must open the right way, put its vertex in the middle half of the
 * span and explain at least `ROUNDING_MIN_R2` of the variance, and the
 * extreme bar itself must lie in the middle half too (as for cups). The drawing
 * is a curve, not the zigzag of lows — see {@link sampleArc} for why it is
 * not the fitted curve itself.
 */
export function qualifyRounding(
    ctx: QualifyContext,
    shape: CurveShape
): QualifiedPattern[] {
    const rimKind: PivotKind = shape === 'bottom' ? 'high' : 'low';
    const rims = ctx.pivots.filter(p => p.kind === rimKind);
    if (rims.length < 2) return [];
    const right = rims[rims.length - 1];
    for (const left of rims.slice(0, -1)) {
        const q = qualifyRoundingAt(ctx, left, right, shape);
        if (q) return [q];
    }
    return [];
}

function qualifyRoundingAt(
    ctx: QualifyContext,
    left: PivotPoint,
    right: PivotPoint,
    shape: CurveShape
): QualifiedPattern | null {
    const span = measureRimSpan(
        ctx,
        left,
        right,
        shape,
        RIM_MATCH_MAX_PRICE_PCT
    );
    if (span === null || !isRecent(ctx, right.index, right.index - left.index))
        return null;
    const closes = ctx.bars
        .slice(left.index, right.index + 1)
        .map((bar, k) => ({ x: k, y: bar.close }));
    const fit = fitQuadratic(closes);
    if (fit === null || (shape === 'bottom' ? fit.a <= 0 : fit.a >= 0))
        return null;
    const width = right.index - left.index;
    // Both the fitted vertex and the printed extreme bar: the fit can centre
    // its vertex while the actual low is a gap-down two bars after the left
    // rim (AAPL daily, 2026-10-08) — drawn through the printed points, that is
    // a crash and a slow climb, not a saucer.
    if (
        !inMiddleHalf(-fit.b / (2 * fit.a), width) ||
        !extremeInMiddleHalf(left, right, span.extreme)
    )
        return null;
    const curve = (x: number): number => fit.a * x * x + fit.b * x + fit.c;
    if (rSquared(closes, curve) < ROUNDING_MIN_R2) return null;

    const swingKind: PivotKind = shape === 'bottom' ? 'low' : 'high';
    const laterSwings = ctx.pivots.filter(
        p => p.kind === swingKind && p.index > span.extreme.index
    );
    const invalidation =
        laterSwings.length > 0
            ? laterSwings[laterSwings.length - 1]
            : span.extreme;
    return {
        id: shape === 'bottom' ? 'rounding_bottom' : 'rounding_top',
        startIndex: left.index,
        endIndex: right.index,
        pivots: ctx.pivots.filter(
            p => p.index >= left.index && p.index <= right.index
        ),
        shape: {
            kind: 'rounding',
            leftRim: left,
            rightRim: right,
            extreme: span.extreme,
            invalidation: {
                index: invalidation.index,
                price: invalidation.price,
            },
            arc: sampleArc(left, right, span.extreme),
        },
        touches: 2,
    };
}

/** Whether `offset` bars into a `width`-bar span lies in its middle half (`CURVATURE_VERTEX_MID_LO`–`_HI`). */
function inMiddleHalf(offset: number, width: number): boolean {
    return (
        offset >= width * CURVATURE_VERTEX_MID_LO &&
        offset <= width * CURVATURE_VERTEX_MID_HI
    );
}

/**
 * Whether a curved base's extreme bar (the cup or saucer bottom, the dome
 * top) sits in the middle half of the rim-to-rim span, by time: a crash off
 * the left rim followed by a long climb back is a V on its side, not a bowl.
 * Shared by cups and rounding bases.
 */
function extremeInMiddleHalf(
    left: PivotPoint,
    right: PivotPoint,
    extreme: PatternPoint
): boolean {
    return inMiddleHalf(extreme.index - left.index, right.index - left.index);
}

/** Coefficient of determination of `curve` over `points`; 0 for a flat series. */
function rSquared(
    points: readonly { x: number; y: number }[],
    curve: (x: number) => number
): number {
    const mean = points.reduce((sum, p) => sum + p.y, 0) / points.length;
    const total = points.reduce((sum, p) => sum + (p.y - mean) ** 2, 0);
    if (total === 0) return 0;
    const residual = points.reduce(
        (sum, p) => sum + (p.y - curve(p.x)) ** 2,
        0
    );
    return 1 - residual / total;
}

/**
 * The drawn arc: about `ROUNDING_ARC_SAMPLES` bar indices from rim to rim,
 * plus the extreme's own bar, on a curve through the three printed points —
 * the left rim, the bottom (top) and the right rim.
 *
 * Not the fitted curve: it is fitted on closes, so it starts and ends off the
 * rims and does not reach the extreme low (high). AAPL daily, 2026-10-08 A/B:
 * the fit began 3.8 ATR under the printed left rim (319.7 vs 344.57) and
 * bottomed at 309.8 against a printed bottom of 300.00, so the chart and the
 * card disagreed. The fit's shape re-anchored to those points is, on each
 * side of the extreme, the parabola with its vertex at the extreme through
 * that side's rim (a parabola scaled to two anchors is still a parabola), so
 * each side is that half-parabola. It never passes the extreme or the rims —
 * monotone on each side, flat at the extreme where the two halves meet.
 */
function sampleArc(
    left: PivotPoint,
    right: PivotPoint,
    extreme: PatternPoint
): PatternPoint[] {
    const width = right.index - left.index;
    const offsets = Array.from({ length: ROUNDING_ARC_SAMPLES }, (_, k) =>
        Math.round((width * k) / (ROUNDING_ARC_SAMPLES - 1))
    );
    const indices = [
        ...new Set([...offsets.map(x => left.index + x), extreme.index]),
    ].toSorted((a, b) => a - b);
    return indices.map(index => {
        const rim = index <= extreme.index ? left : right;
        const side = Math.abs(rim.index - extreme.index);
        const t = side === 0 ? 0 : (index - extreme.index) / side;
        return {
            index,
            price: extreme.price + (rim.price - extreme.price) * t * t,
        };
    });
}
