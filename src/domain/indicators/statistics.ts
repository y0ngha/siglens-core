/**
 * @internal Sample variance (Bessel-corrected, divisor n−1) of a numeric array.
 *
 * Returns `null` when fewer than two observations are present (n−1 ≤ 0 →
 * variance undefined). Shared by Yang-Zhang and Variance Ratio so the n−1
 * convention is defined in exactly one place.
 */
export function sampleVariance(values: number[]): number | null {
    const n = values.length;
    if (n < 2) return null;
    const mean = values.reduce((sum, v) => sum + v, 0) / n;
    const sumSq = values.reduce((sum, v) => sum + (v - mean) ** 2, 0);
    return sumSq / (n - 1);
}
