import type {
    ChartPatternId,
    PatternLine,
    PivotKind,
    PivotPoint,
    QualifiedPattern,
} from '@/domain/types';
import { fitBoundaryLine, lineValueAt } from '@/domain/patterns/boundaryLines';
import {
    EXTREME_MATCH_ATR_MULT,
    EXTREME_MATCH_MAX_PRICE_PCT,
    EXTREME_MIN_GAP_BARS,
    HS_HEAD_MIN_ATR,
    HS_MAX_PIVOTS_AFTER_RIGHT_SHOULDER,
    HS_SHOULDER_MAX_PRICE_PCT,
    LONG_REVERSAL_MIN_BARS,
} from '@/domain/patterns/constants';
import {
    type QualifyContext,
    minHeight,
    extremePoint,
    isLower,
    isHigher,
    isRecent,
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
 * apart (so a triple spans more than `LONG_REVERSAL_MIN_BARS`), and stand
 * at least the height floor away from the neckline. Confirmed pivots
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
    // A triple's LONG_REVERSAL_MIN_BARS span follows from two gaps of
    // EXTREME_MIN_GAP_BARS (21 bars at least), so it needs no check of its own.
    if (!gapsOk) return null;
    if (!isRecent(ctx, last.index, last.index - first.index)) return null;

    const window = ctx.pivots.filter(
        p => p.index >= first.index && p.index <= last.index
    );
    const neckline = extremePoint(
        window.filter(p => p.kind !== kind),
        kind === 'high' ? isLower : isHigher
    );
    if (Math.abs(average - neckline.price) < minHeight(ctx, average))
        return null;

    return {
        id,
        startIndex: first.index,
        endIndex: last.index,
        pivots: window,
        shape: { kind: 'extreme', neckline },
        touches: extremes.length,
    };
}

// ─── Head & shoulders (§3.3) ────────────────────────────────────────────────

/**
 * @internal
 * Five consecutive confirmed pivots [shoulder, trough, head, trough,
 * shoulder] whose right shoulder is one of the last
 * `HS_MAX_PIVOTS_AFTER_RIGHT_SHOULDER + 1` confirmed pivots (the most recent
 * match wins). The neckline is the boundary through the two troughs; the
 * spec's checks are span, level shoulders, a head clearing both shoulders by
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
    if (rs.index - ls.index + 1 < LONG_REVERSAL_MIN_BARS) return null;
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
