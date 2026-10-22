import type {
    Bar,
    ChartPatternId,
    PatternLine,
    PatternPoint,
} from '@/domain/types';
import {
    BOUNDARY_CONTAINMENT_ATR,
    BOUNDARY_TOUCH_ATR,
    FLAT_DRIFT_ATR,
    FLAT_DRIFT_PRICE_PCT,
    SLOPED_DRIFT_ATR,
} from '@/domain/patterns/constants';

/**
 * @internal
 * Value of `line` at bar index `x` — the straight line through its start and
 * end points, extended beyond them when `x` lies outside.
 */
export function lineValueAt(line: PatternLine, x: number): number {
    const run = line.end.index - line.start.index;
    if (run === 0) return line.start.price;
    const slope = (line.end.price - line.start.price) / run;
    return line.start.price + slope * (x - line.start.index);
}

/** @internal Which side of the pattern a boundary bounds. */
export type BoundarySide = 'upper' | 'lower';

interface ScoredLine {
    line: PatternLine;
    distance: number;
}

/**
 * @internal
 * The boundary through a pattern's touches — the one
 * routine every line family uses (triangles, wedges, channels, rectangle,
 * broadening formation, the head & shoulders neckline, the flag channel).
 *
 * Every straight line through two of `points` is a candidate. A candidate is
 * kept only when it contains every bar in `[from, to]`: an upper boundary
 * with `high ≤ line + ε`, a lower one with `low ≥ line − ε`
 * (ε = `BOUNDARY_CONTAINMENT_ATR`·ATR). Among those, the line touching the
 * most points wins (a touch is a point within `BOUNDARY_TOUCH_ATR`·ATR), then
 * the one closest to all the points. A regression line is never used: it cuts
 * through the bars it is supposed to bound and inflates the height when one
 * pivot sits far from the others.
 *
 * Cost is O(k²·n) for k points over n bars — k is at most a pivot window or a
 * flag's bars, so this stays small.
 *
 * @param points - Candidate touch points for this side, ascending by index
 *   (a side's pivots, or a flag's bar highs/lows).
 * @param bars - The bar series the indices refer to.
 * @param side - Which side the line bounds.
 * @param from - First bar index the line must contain.
 * @param to - Last bar index the line must contain.
 * @param atr - Average True Range (scale of ε and τ).
 * @returns The chosen line, drawn from its first to its last touch, or
 *   `null` when no line through two points contains the bars.
 */
export function fitBoundaryLine(
    points: readonly PatternPoint[],
    bars: readonly Bar[],
    side: BoundarySide,
    from: number,
    to: number,
    atr: number
): PatternLine | null {
    const slack = BOUNDARY_CONTAINMENT_ATR * atr;
    const touchTolerance = BOUNDARY_TOUCH_ATR * atr;

    const scoreLine = (a: PatternPoint, b: PatternPoint): ScoredLine | null => {
        if (a.index === b.index) return null;
        const slope = (b.price - a.price) / (b.index - a.index);
        const valueAt = (x: number): number => a.price + slope * (x - a.index);
        if (!containsBars(bars, side, from, to, valueAt, slack)) return null;

        const touches = points.filter(
            p => Math.abs(p.price - valueAt(p.index)) <= touchTolerance
        );
        const distance = points.reduce(
            (sum, p) => sum + Math.abs(p.price - valueAt(p.index)),
            0
        );
        const first = touches[0];
        const last = touches[touches.length - 1];
        return {
            line: {
                start: { index: first.index, price: valueAt(first.index) },
                end: { index: last.index, price: valueAt(last.index) },
                touches,
            },
            distance,
        };
    };

    const candidates = points.flatMap((a, i) =>
        points.slice(i + 1).flatMap(b => {
            const scored = scoreLine(a, b);
            return scored === null ? [] : [scored];
        })
    );
    const best = candidates.reduce<ScoredLine | null>(
        (acc, candidate) =>
            acc === null || isBetter(candidate, acc) ? candidate : acc,
        null
    );
    return best?.line ?? null;
}

/**
 * @internal
 * The boundary parallel to `guide` on the `side` it does not bound — a
 * channel's second line drawn from its better-touched one (2026-10-08
 * real-chart recall diagnosis: a falling channel with four touches on its
 * upper line had no lower line through two lows that held every bar,
 * because its three lows do not sit on one straight line).
 *
 * The line has `guide`'s slope and passes through the point of `points`
 * farthest from `guide` on `side` — so no point lies beyond it — and is kept
 * only when it contains every bar in `[from, to]` by the same
 * `BOUNDARY_CONTAINMENT_ATR`·ATR slack as {@link fitBoundaryLine}. Touches use
 * the same `BOUNDARY_TOUCH_ATR`·ATR tolerance. Neither bound is loosened:
 * a wider slack or a band around the parallel re-admits channels a candle
 * really pierces.
 *
 * @returns The parallel, drawn from its first to its last touch, or `null`
 *   when `points` is empty or a bar pokes through it.
 */
export function parallelBoundaryLine(
    guide: PatternLine,
    points: readonly PatternPoint[],
    bars: readonly Bar[],
    side: BoundarySide,
    from: number,
    to: number,
    atr: number
): PatternLine | null {
    if (points.length === 0) return null;
    const sign = side === 'upper' ? 1 : -1;
    // How far beyond `guide`, on `side`, each point sits; the parallel runs
    // through the farthest one.
    const beyond = (p: PatternPoint): number =>
        sign * (p.price - lineValueAt(guide, p.index));
    const anchor = points.reduce((a, b) => (beyond(b) > beyond(a) ? b : a));
    const offset = anchor.price - lineValueAt(guide, anchor.index);
    const valueAt = (x: number): number => lineValueAt(guide, x) + offset;
    if (
        !containsBars(
            bars,
            side,
            from,
            to,
            valueAt,
            BOUNDARY_CONTAINMENT_ATR * atr
        )
    )
        return null;
    const touches = points.filter(
        p => Math.abs(p.price - valueAt(p.index)) <= BOUNDARY_TOUCH_ATR * atr
    );
    const first = touches[0];
    const last = touches[touches.length - 1];
    return {
        start: { index: first.index, price: valueAt(first.index) },
        end: { index: last.index, price: valueAt(last.index) },
        touches,
    };
}

function isBetter(candidate: ScoredLine, best: ScoredLine): boolean {
    const touchDiff = candidate.line.touches.length - best.line.touches.length;
    if (touchDiff !== 0) return touchDiff > 0;
    return candidate.distance < best.distance;
}

function containsBars(
    bars: readonly Bar[],
    side: BoundarySide,
    from: number,
    to: number,
    valueAt: (x: number) => number,
    slack: number
): boolean {
    for (let k = from; k <= to; k++) {
        const bar = bars[k];
        const limit = valueAt(k);
        if (
            side === 'upper'
                ? bar.high > limit + slack
                : bar.low < limit - slack
        )
            return false;
    }
    return true;
}

/** @internal How a boundary moves over the pattern span. */
export type LineDrift = 'flat' | 'rising' | 'falling' | 'ambiguous';

/**
 * @internal
 * Classifies a boundary by its total move `delta` over the pattern span —
 * not by a per-bar slope, which reads a +5% resistance over 50 bars as
 * "flat". Flat when `|delta| ≤ min(FLAT_DRIFT_ATR·ATR, flatPricePct·price)`,
 * rising/falling when `|delta| ≥ SLOPED_DRIFT_ATR·ATR`, and `ambiguous` in
 * between — a dead band the caller treats as "not drawable".
 *
 * @param flatPricePct - Price share of the flat bound; the rectangle passes
 *   its looser `RECTANGLE_FLAT_DRIFT_PRICE_PCT`.
 */
export function classifyLineDrift(
    delta: number,
    atr: number,
    price: number,
    flatPricePct: number = FLAT_DRIFT_PRICE_PCT
): LineDrift {
    const size = Math.abs(delta);
    if (size <= Math.min(FLAT_DRIFT_ATR * atr, flatPricePct * price))
        return 'flat';
    if (size >= SLOPED_DRIFT_ATR * atr) return delta > 0 ? 'rising' : 'falling';
    return 'ambiguous';
}

/**
 * @internal
 * Measured-move height of a boundary pair: the width
 * at the first touch — the widest point of a converging pattern, and the
 * same as anywhere else for parallel lines. A broadening formation widens, so
 * its height is the width at its last touch. Both points are fixed once the
 * touches are confirmed, unlike a width read at the last bar.
 */
export function trendlineHeight(
    id: ChartPatternId,
    upper: PatternLine,
    lower: PatternLine
): number {
    const x =
        id === 'broadening_formation'
            ? Math.max(upper.end.index, lower.end.index)
            : Math.min(upper.start.index, lower.start.index);
    return lineValueAt(upper, x) - lineValueAt(lower, x);
}
