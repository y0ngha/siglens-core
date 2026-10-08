import type {
    ChartPatternId,
    PatternLine,
    PivotKind,
    PivotPoint,
    QualifiedPattern,
} from '@/domain/types';
import {
    classifyLineDrift,
    fitBoundaryLine,
    lineValueAt,
} from '@/domain/patterns/boundaryLines';
import {
    DOUBLE_NECKLINE_EDGE_SHARE,
    EXTREME_MATCH_ATR_MULT,
    EXTREME_MATCH_MAX_PRICE_PCT,
    EXTREME_MIN_GAP_BARS,
    HS_HEAD_MIN_ATR,
    HS_MAX_PIVOTS_AFTER_RIGHT_SHOULDER,
    HS_MIN_BARS,
    HS_SHOULDER_MIN_CLEARANCE_ATR,
    HS_SHOULDER_MAX_PRICE_PCT,
    BOUNDARY_CONTAINMENT_ATR,
    PRIOR_TREND_BARS,
} from '@/domain/patterns/constants';
import {
    type QualifyContext,
    minHeight,
    extremePoint,
    isLower,
    isHigher,
    isRecent,
    priorTrend,
} from '@/domain/patterns/qualify/context';

// ─── Double / triple tops and bottoms (§3.8) ───────────────────────────────

const EXTREME_IDS: Record<
    PivotKind,
    { double: ChartPatternId; triple: ChartPatternId }
> = {
    high: { double: 'double_top', triple: 'triple_top' },
    low: { double: 'double_bottom', triple: 'triple_bottom' },
};

/**
 * @internal
 * The last two (and three) confirmed extremes of one kind. Every extreme is a
 * confirmed pivot — today's running high cannot be a second peak. The
 * extremes match within `min(EXTREME_MATCH_ATR_MULT·ATR,
 * EXTREME_MATCH_MAX_PRICE_PCT·price)`, sit at least `EXTREME_MIN_GAP_BARS`
 * apart (so a triple spans at least 21 bars) with no bar between them
 * beyond them by more than the containment slack, and stand
 * at least the height floor away from the neckline (for a double, a
 * neckline in the middle half of the span, `DOUBLE_NECKLINE_EDGE_SHARE`),
 * and the swings of the
 * other kind leading into the pattern do not clearly trend toward the
 * extremes (`opposingSwingsTrend`). Confirmed pivots
 * alternate, so an opposite pivot always sits between two consecutive
 * extremes.
 */
export function qualifyExtremes(
    ctx: QualifyContext,
    kind: PivotKind
): QualifiedPattern[] {
    const same = ctx.pivots.filter(p => p.kind === kind);
    const ids = EXTREME_IDS[kind];
    return [
        { count: 3, id: ids.triple },
        { count: 2, id: ids.double },
    ].flatMap(({ count, id }) => {
        if (same.length < count) return [];
        const q = qualifyExtremeSet(ctx, kind, same.slice(-count), id);
        return q ? [q] : [];
    });
}

function qualifyExtremeSet(
    ctx: QualifyContext,
    kind: PivotKind,
    extremes: readonly PivotPoint[],
    id: ChartPatternId
): QualifiedPattern | null {
    const first = extremes[0];
    const last = extremes[extremes.length - 1];
    const prices = extremes.map(p => p.price);
    const average = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    const tolerance = Math.min(
        EXTREME_MATCH_ATR_MULT * ctx.atr,
        EXTREME_MATCH_MAX_PRICE_PCT * average
    );
    if (Math.max(...prices) - Math.min(...prices) > tolerance) return null;
    const gapsOk = extremes
        .slice(1)
        .every((p, i) => p.index - extremes[i].index >= EXTREME_MIN_GAP_BARS);
    // A triple's span follows from two gaps of EXTREME_MIN_GAP_BARS (21 bars
    // at least), so it needs no check of its own.
    if (!gapsOk) return null;
    if (!isRecent(ctx, last.index, last.index - first.index)) return null;
    // The matched extremes are the extremes of their span: a bar beyond them
    // (a wide bar whose other end confirmed the swing, so it is no pivot)
    // would sit over a "double top" drawn under it.
    const slack = BOUNDARY_CONTAINMENT_ATR * ctx.atr;
    const level =
        kind === 'high'
            ? Math.max(...prices) + slack
            : Math.min(...prices) - slack;
    const poked = ctx.bars
        .slice(first.index, last.index + 1)
        .some(bar => (kind === 'high' ? bar.high > level : bar.low < level));
    if (poked) return null;

    const window = ctx.pivots.filter(
        p => p.index >= first.index && p.index <= last.index
    );
    const neckline = extremePoint(
        window.filter(p => p.kind !== kind),
        kind === 'high' ? isLower : isHigher
    );
    if (Math.abs(average - neckline.price) < minHeight(ctx, average))
        return null;
    if (extremes.length === 2) {
        const edge = DOUBLE_NECKLINE_EDGE_SHARE * (last.index - first.index);
        if (
            neckline.index - first.index < edge ||
            last.index - neckline.index < edge
        )
            return null;
    }
    if (opposingSwingsTrend(ctx, kind, extremes, tolerance)) return null;

    return {
        id,
        startIndex: first.index,
        endIndex: last.index,
        pivots: window,
        shape: { kind: 'extreme', neckline },
        touches: extremes.length,
    };
}

/**
 * Whether the swings of the other kind under (over) a run of equal extremes
 * clearly trend toward them: rising troughs under equal highs, falling peaks
 * over equal lows. The run is the matched extremes extended left over every
 * earlier extreme at the same level (within `tolerance`); its troughs are the
 * opposite pivots between the run's first and last extreme. Clearly means the
 * line through the first and last trough classifies as rising (falling) by
 * `classifyLineDrift`, the dead band the boundary pairs use. Equal highs over
 * rising lows are an ascending triangle, not a double or triple top — the
 * fuzzed triangle templates drew as doubles about 30% of the time. A plain
 * double top has one trough between its peaks and never trends.
 */
function opposingSwingsTrend(
    ctx: QualifyContext,
    kind: PivotKind,
    extremes: readonly PivotPoint[],
    tolerance: number
): boolean {
    const same = ctx.pivots.filter(p => p.kind === kind);
    const level = extremes[0].price;
    let runStart = same.indexOf(extremes[0]);
    while (
        runStart > 0 &&
        Math.abs(same[runStart - 1].price - level) <= tolerance
    )
        runStart--;
    const from = same[runStart].index;
    const to = extremes[extremes.length - 1].index;
    const swings = ctx.pivots.filter(
        p => p.kind !== kind && p.index > from && p.index < to
    );
    if (swings.length < 2) return false;
    const drift = classifyLineDrift(
        swings[swings.length - 1].price - swings[0].price,
        ctx.atr,
        ctx.bars[to].close
    );
    return drift === (kind === 'high' ? 'rising' : 'falling');
}

// ─── Head & shoulders (§3.3) ────────────────────────────────────────────────

/**
 * @internal
 * Five consecutive confirmed pivots [shoulder, trough, head, trough,
 * shoulder] whose right shoulder is one of the last
 * `HS_MAX_PIVOTS_AFTER_RIGHT_SHOULDER + 1` confirmed pivots (the most recent
 * match wins). The neckline is the boundary through the two troughs; the
 * spec's checks are span, level shoulders (each on its own bar —
 * `extractPivots` never puts two pivots on one bar), both shoulders at least
 * `HS_SHOULDER_MIN_CLEARANCE_ATR`·ATR on the pattern's side of the
 * neckline with no close through it from the second trough to the right
 * shoulder, a neckline that does not climb with the prior trend (its
 * trough-to-trough move is not `rising` for a top, `falling` for a bottom,
 * by `classifyLineDrift`), a head that tops the move into it
 * (`headTopsItsAdvance`), a
 * head clearing both shoulders by
 * `HS_HEAD_MIN_ATR`·ATR, and the height floor measured from the sloped
 * neckline at the head.
 */
export function qualifyHeadAndShoulders(
    ctx: QualifyContext,
    peakKind: PivotKind,
    id: ChartPatternId
): QualifiedPattern[] {
    for (let after = 0; after <= HS_MAX_PIVOTS_AFTER_RIGHT_SHOULDER; after++) {
        const end = ctx.pivots.length - after;
        if (end < 5) break;
        const q = qualifyHeadAndShouldersWindow(
            ctx,
            ctx.pivots.slice(end - 5, end),
            peakKind,
            id
        );
        if (q) return [q];
    }
    return [];
}

function qualifyHeadAndShouldersWindow(
    ctx: QualifyContext,
    window: readonly PivotPoint[],
    peakKind: PivotKind,
    id: ChartPatternId
): QualifiedPattern | null {
    const [ls, m1, head, m2, rs] = window;
    // Confirmed pivots alternate, so the first kind fixes the other four.
    if (ls.kind !== peakKind) return null;
    if (rs.index - ls.index + 1 < HS_MIN_BARS) return null;
    const sign = peakKind === 'high' ? 1 : -1;
    const headClearance =
        sign * head.price - Math.max(sign * ls.price, sign * rs.price);
    if (headClearance < HS_HEAD_MIN_ATR * ctx.atr) return null;
    if (
        Math.abs(ls.price - rs.price) >
        HS_SHOULDER_MAX_PRICE_PCT * Math.max(ls.price, rs.price)
    )
        return null;

    const neckline = fitBoundaryLine(
        [m1, m2],
        ctx.bars,
        peakKind === 'high' ? 'lower' : 'upper',
        m1.index,
        m2.index,
        ctx.atr
    );
    if (neckline === null) return null;
    const height = sign * (head.price - lineValueAt(neckline, head.index));
    if (height < minHeight(ctx, head.price)) return null;
    if (!headTopsItsAdvance(ctx, ls, head, rs, sign)) return null;
    const clears = (shoulder: PivotPoint): boolean =>
        sign * (shoulder.price - lineValueAt(neckline, shoulder.index)) >=
        HS_SHOULDER_MIN_CLEARANCE_ATR * ctx.atr;
    if (!clears(ls) || !clears(rs)) return null;
    // A neckline climbing with the prior trend (rising under a top, falling
    // over a bottom) by the boundaries' sloped class is the trend's own
    // rising lows: the "head" is just its latest high.
    const necklineDrift = classifyLineDrift(
        m2.price - m1.price,
        ctx.atr,
        ctx.bars[rs.index].close
    );
    if (necklineDrift === (sign === 1 ? 'rising' : 'falling')) return null;
    // A close through the neckline (beyond the containment slack) between
    // the second trough and the right shoulder, that bar included, means the
    // "right shoulder" is a rebound after the break, not a shoulder.
    const brokeEarly = ctx.bars
        .slice(m2.index + 1, rs.index + 1)
        .some(
            (bar, k) =>
                sign * (bar.close - lineValueAt(neckline, m2.index + 1 + k)) <
                -BOUNDARY_CONTAINMENT_ATR * ctx.atr
        );
    if (brokeEarly) return null;

    return {
        id,
        startIndex: ls.index,
        endIndex: rs.index,
        pivots: window,
        shape: {
            kind: 'head_and_shoulders',
            neckline,
            breakoutIndex: necklineBreakIndex(ctx, neckline, rs.index, sign),
        },
        touches: window.length,
    };
}

/**
 * Whether the head is the extreme of the whole move: price advanced into
 * the left shoulder (a prior trend toward the head, `priorTrend`) and no bar
 * from `PRIOR_TREND_BARS` before the left shoulder to the right shoulder
 * goes beyond the head by more than the containment slack. A wedge or
 * triangle's three inner swings otherwise read as an H&S inside a trend
 * running the other way.
 */
function headTopsItsAdvance(
    ctx: QualifyContext,
    ls: PivotPoint,
    head: PivotPoint,
    rs: PivotPoint,
    sign: number
): boolean {
    if (priorTrend(ctx, ls.index) !== (sign === 1 ? 'up' : 'down'))
        return false;
    const slack = BOUNDARY_CONTAINMENT_ATR * ctx.atr;
    return ctx.bars
        .slice(Math.max(0, ls.index - PRIOR_TREND_BARS), rs.index + 1)
        .every(bar =>
            sign === 1
                ? bar.high <= head.price + slack
                : bar.low >= head.price - slack
        );
}

/** First bar after the right shoulder whose close crossed the neckline, else the last bar. */
function necklineBreakIndex(
    ctx: QualifyContext,
    neckline: PatternLine,
    rightShoulderIndex: number,
    sign: number
): number {
    for (let i = rightShoulderIndex + 1; i <= ctx.lastIndex; i++) {
        if (sign * (ctx.bars[i].close - lineValueAt(neckline, i)) < 0) return i;
    }
    return ctx.lastIndex;
}
