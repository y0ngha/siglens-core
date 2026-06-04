import type { ForwardDirection, ForwardReturnStats } from '@/domain/types';

/**
 * @internal Directional forward return at index `i` over `horizon` bars.
 * Returns null when the window runs out of range or the base price is
 * non-positive. For `'down'` signals the sign is flipped so a positive result
 * always means "price moved as the signal predicts".
 */
export function forwardReturn(
    closes: readonly number[],
    i: number,
    horizon: number,
    direction: ForwardDirection
): number | null {
    const j = i + horizon;
    if (i < 0 || j >= closes.length) return null;
    const base = closes[i];
    if (!(base > 0)) return null;
    const r = (closes[j] - base) / base;
    return direction === 'up' ? r : -r;
}

/**
 * @internal Directional forward returns over `indices`, dropping out-of-range
 * or degenerate samples. The single source of forward-return collection, so
 * `forwardReturn` runs exactly once per index across the whole harness.
 */
export function collectValidReturns(
    closes: readonly number[],
    indices: readonly number[],
    horizon: number,
    direction: ForwardDirection
): number[] {
    return indices
        .map(i => forwardReturn(closes, i, horizon, direction))
        .filter((r): r is number => r !== null);
}

/** @internal Aggregate already-collected directional returns into hit-rate / mean. */
export function statsFromReturns(
    returns: readonly number[]
): ForwardReturnStats {
    const count = returns.length;
    if (count === 0) return { count: 0, hitRate: 0, meanReturn: 0 };
    const hits = returns.filter(r => r > 0).length;
    const meanReturn = returns.reduce((sum, r) => sum + r, 0) / count;
    return { count, hitRate: hits / count, meanReturn };
}

/** @internal Collect + aggregate directional forward returns over the given indices. */
export function aggregateForwardReturns(
    closes: readonly number[],
    indices: readonly number[],
    horizon: number,
    direction: ForwardDirection
): ForwardReturnStats {
    return statsFromReturns(
        collectValidReturns(closes, indices, horizon, direction)
    );
}

/** @internal Unconditional baseline over every eligible index `[0, n - horizon)`. */
export function computeBaseline(
    closes: readonly number[],
    horizon: number,
    direction: ForwardDirection
): ForwardReturnStats {
    const eligible = Array.from(
        { length: Math.max(0, closes.length - horizon) },
        (_, i) => i
    );
    return aggregateForwardReturns(closes, eligible, horizon, direction);
}
