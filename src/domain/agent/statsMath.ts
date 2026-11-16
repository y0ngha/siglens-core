/** Shared rounding and median for the agent's precomputed statistics (theme snapshot, index history). */

/** Rounds to 2 decimals; a rounded zero is always `+0` (never `-0`, which `Object.is` and some serialisers keep). */
export function round2(value: number): number {
    return Math.round(value * 100) / 100 || 0;
}

/** Median of an ascending-sorted list (mean of the two middle values for an even count), or `null` when empty. */
export function medianOfSorted(sorted: readonly number[]): number | null {
    if (sorted.length === 0) return null;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
        ? sorted[mid]!
        : round2((sorted[mid - 1]! + sorted[mid]!) / 2);
}
