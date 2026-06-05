import type { ForwardDirection } from '@/domain/types';

/**
 * @internal Indices where `fast` crosses above (`'up'`) or below (`'down'`)
 * `slow`. Causal: index `i` is evaluated using only bars `i-1` and `i`. Bars
 * with a `null` on either series (at `i` or `i-1`) are skipped.
 */
export function findCrossIndices(
    fast: readonly (number | null)[],
    slow: readonly (number | null)[],
    direction: ForwardDirection
): number[] {
    const n = Math.min(fast.length, slow.length);
    // Candidate indices 1..n-1; keep only those where a directional cross occurs.
    return Array.from({ length: Math.max(0, n - 1) }, (_, k) => k + 1).filter(
        i => {
            const f = fast[i];
            const s = slow[i];
            const fp = fast[i - 1];
            const sp = slow[i - 1];
            if (f === null || s === null || fp === null || sp === null) {
                return false;
            }
            return direction === 'up' ? fp <= sp && f > s : fp >= sp && f < s;
        }
    );
}

/**
 * @internal Indices where `values` crosses the constant `threshold` upward
 * (`'up'`) or downward (`'down'`). Causal: index `i` is evaluated using only
 * bars `i-1` and `i`. Bars with a `null` on either side (at `i` or `i-1`) are
 * skipped. `'up'` requires `values[i-1] <= threshold && values[i] > threshold`;
 * `'down'` requires `values[i-1] >= threshold && values[i] < threshold`.
 */
export function findThresholdCrossIndices(
    values: readonly (number | null)[],
    threshold: number,
    direction: ForwardDirection
): number[] {
    const n = values.length;
    // Candidate indices 1..n-1; keep only those where a directional cross occurs.
    return Array.from({ length: Math.max(0, n - 1) }, (_, k) => k + 1).filter(
        i => {
            const v = values[i];
            const vp = values[i - 1];
            if (v === null || vp === null) {
                return false;
            }
            return direction === 'up'
                ? vp <= threshold && v > threshold
                : vp >= threshold && v < threshold;
        }
    );
}

/**
 * @internal Indices where `states` flips INTO the target state `to`. Causal:
 * index `i` is evaluated using only bars `i-1` and `i`. A flip requires
 * `states[i] === to` AND a non-null `states[i-1]` that is `!== to`. A `to`
 * value that is the first non-null entry (or sits at index 0) is not a flip
 * and is excluded.
 */
export function findFlipIndices<T>(
    states: readonly (T | null)[],
    to: T
): number[] {
    const n = states.length;
    // Candidate indices 1..n-1; keep only genuine flips into `to`.
    return Array.from({ length: Math.max(0, n - 1) }, (_, k) => k + 1).filter(
        i => {
            const prev = states[i - 1];
            return states[i] === to && prev !== null && prev !== to;
        }
    );
}
