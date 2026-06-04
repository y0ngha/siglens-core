/**
 * @internal Indices where `fast` crosses above (`'up'`) or below (`'down'`)
 * `slow`. Causal: index `i` is emitted using only bars `i-1` and `i`. Bars
 * with a `null` on either series (at `i` or `i-1`) are skipped.
 */
export function findCrossIndices(
    fast: readonly (number | null)[],
    slow: readonly (number | null)[],
    direction: 'up' | 'down'
): number[] {
    const out: number[] = [];
    const n = Math.min(fast.length, slow.length);
    for (let i = 1; i < n; i++) {
        const f = fast[i];
        const s = slow[i];
        const fp = fast[i - 1];
        const sp = slow[i - 1];
        if (f === null || s === null || fp === null || sp === null) continue;
        if (direction === 'up' && fp <= sp && f > s) out.push(i);
        if (direction === 'down' && fp >= sp && f < s) out.push(i);
    }
    return out;
}
