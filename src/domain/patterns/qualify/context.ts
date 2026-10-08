/**
 * Shared context and small helpers for the chart-pattern qualifiers (spec
 * 2026-10-07). Each family lives in its own file next to this one; the facade
 * is `qualifyPatterns.ts`.
 */
import type { Bar, PatternPoint, PivotPoint } from '@/domain/types';
import {
    PATTERN_MAX_AGE_MIN_BARS,
    PATTERN_MAX_AGE_SPAN_SHARE,
    PATTERN_MIN_HEIGHT_ATR,
} from '@/domain/patterns/constants';

/**
 * @internal
 * Everything a family qualifier reads. `pivots` are CONFIRMED pivots only
 * (spec 2026-10-07 §2.1): the still-forming extreme moves every day, and a
 * line, level or overlay id built on it moved with it.
 */
export interface QualifyContext {
    bars: readonly Bar[];
    pivots: readonly PivotPoint[];
    atr: number;
    lastIndex: number;
    minHeightPricePct: number;
}

/** @internal `max(PATTERN_MIN_HEIGHT_ATR·ATR, pct·price)` — the §2.4 height floor. */
export function minHeight(ctx: QualifyContext, price: number): number {
    return Math.max(
        PATTERN_MIN_HEIGHT_ATR * ctx.atr,
        ctx.minHeightPricePct * price
    );
}

/** @internal The point among `points` that `better` prefers (the first on a tie). */
export function extremePoint<T extends PatternPoint>(
    points: readonly T[],
    better: (candidate: number, best: number) => boolean
): T {
    return points.reduce((best, p) => (better(p.price, best.price) ? p : best));
}

/** @internal `extremePoint` comparator: the lower price wins. */
export const isLower = (candidate: number, best: number): boolean =>
    candidate < best;
/** @internal `extremePoint` comparator: the higher price wins. */
export const isHigher = (candidate: number, best: number): boolean =>
    candidate > best;

/** @internal Bar lows (or highs) of `bars[from..to]` as index/price points. */
export function barPoints(
    bars: readonly Bar[],
    from: number,
    to: number,
    pick: (bar: Bar) => number
): PatternPoint[] {
    return bars
        .slice(from, to + 1)
        .map((bar, k) => ({ index: from + k, price: pick(bar) }));
}

/** @internal `barPoints` picker: the bar's low. */
export const barLow = (bar: Bar): number => bar.low;
/** @internal `barPoints` picker: the bar's high. */
export const barHigh = (bar: Bar): number => bar.high;

/**
 * @internal
 * The lowest confirmed swing low after `index`, or `null` before one has
 * formed. A flag or handle low read from the raw bars would follow a falling
 * current leg down day by day, so a close could never get below it.
 */
export function lowestConfirmedLowAfter(
    ctx: QualifyContext,
    index: number
): PivotPoint | null {
    const lows = ctx.pivots.filter(p => p.kind === 'low' && p.index > index);
    return lows.length > 0 ? extremePoint(lows, isLower) : null;
}

/**
 * @internal
 * Whether a pattern spanning `span` bars and ending at `lastIndex` is still
 * current — see `PATTERN_MAX_AGE_MIN_BARS`.
 */
export function isRecent(
    ctx: QualifyContext,
    lastIndex: number,
    span: number
): boolean {
    return (
        ctx.lastIndex - lastIndex <=
        Math.max(PATTERN_MAX_AGE_MIN_BARS, PATTERN_MAX_AGE_SPAN_SHARE * span)
    );
}
