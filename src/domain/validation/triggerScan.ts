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
