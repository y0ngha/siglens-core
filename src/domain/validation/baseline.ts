import type { ForwardReturnStats } from '@/domain/types';

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
    direction: 'up' | 'down'
): number | null {
    const j = i + horizon;
    if (i < 0 || j >= closes.length) return null;
    const base = closes[i];
    if (!(base > 0)) return null;
    const r = (closes[j] - base) / base;
    return direction === 'up' ? r : -r;
}

/** @internal Aggregate directional forward returns over the given indices. */
export function aggregateForwardReturns(
    closes: readonly number[],
    indices: readonly number[],
    horizon: number,
    direction: 'up' | 'down'
): ForwardReturnStats {
    const returns: number[] = [];
    for (const i of indices) {
        const r = forwardReturn(closes, i, horizon, direction);
        if (r !== null) returns.push(r);
    }
    const count = returns.length;
    if (count === 0) return { count: 0, hitRate: 0, meanReturn: 0 };
    const hits = returns.filter(r => r > 0).length;
    const meanReturn = returns.reduce((sum, r) => sum + r, 0) / count;
    return { count, hitRate: hits / count, meanReturn };
}

/** @internal Unconditional baseline over every eligible index `[0, n - horizon)`. */
export function computeBaseline(
    closes: readonly number[],
    horizon: number,
    direction: 'up' | 'down'
): ForwardReturnStats {
    const eligible: number[] = [];
    for (let i = 0; i + horizon < closes.length; i++) eligible.push(i);
    return aggregateForwardReturns(closes, eligible, horizon, direction);
}
