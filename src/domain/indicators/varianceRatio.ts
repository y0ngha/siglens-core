import { sampleVariance } from './statistics';
import { VR_Q, VR_WINDOW } from './constants';

/**
 * @internal Lo-MacKinlay Variance Ratio (overlapping estimator).
 *
 * Over a trailing window of `window` one-period log-returns `r`:
 *   var1 = sampleVariance(r)                         (Bessel-corrected, n−1)
 *   r^q_t = Σ_{j=0}^{q−1} r_{t−j}  (overlapping q-period sums)
 *   varQ = sampleVariance(r^q)                       (Bessel-corrected, n−1)
 *   VR   = varQ / (q · var1)        when var1 > 0, else null
 *
 * Interpretation: VR ≈ 1 → random walk; VR > 1 → trending/positive serial
 * correlation; VR < 1 → mean-reverting/negative serial correlation.
 *
 * Returns `null` until `window` returns are available, and `null` when the
 * window is flat (var1 = 0 → division undefined). Non-positive closes inside a
 * window invalidate that bar (`ln` undefined → null).
 */
export function calculateVarianceRatio(
    closes: number[],
    q = VR_Q,
    window = VR_WINDOW
): (number | null)[] {
    const n = closes.length;
    if (n === 0) return [];

    // One-period log-returns; returns[0] is null (no prior close).
    // A window of `window` returns needs `window + 1` closes → first valid output
    // at index = window.
    const returns: (number | null)[] = closes.map((c, i) => {
        if (i === 0) return null;
        const prev = closes[i - 1];
        if (prev <= 0 || c <= 0) return null; // guard ln of non-positive
        return Math.log(c / prev);
    });

    return closes.map((_, i) => {
        if (i < window) return null;

        // Trailing window of `window` returns: indices [i-window+1 .. i].
        const windowReturns = returns.slice(i - window + 1, i + 1);
        if (windowReturns.some(r => r === null)) return null;
        const r = windowReturns as number[];

        const var1 = sampleVariance(r);
        if (var1 === null || var1 <= 0) return null;

        // Overlapping q-period sums: r^q_t = sum of q consecutive returns.
        // Valid for t = q-1 .. window-1 → (window - q + 1) sums.
        if (r.length < q) return null;
        const qSums = Array.from({ length: r.length - q + 1 }, (_, t) =>
            r.slice(t, t + q).reduce((sum, v) => sum + v, 0)
        );

        const varQ = sampleVariance(qSums);
        if (varQ === null) return null;

        return varQ / (q * var1);
    });
}
