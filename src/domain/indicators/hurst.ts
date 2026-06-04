import {
    HURST_WINDOW,
    HURST_SUBWINDOW_DIVISOR_QUARTER,
    HURST_SUBWINDOW_DIVISOR_HALF,
    HURST_SUBWINDOW_DIVISOR_FULL,
    HURST_MIN_SUBWINDOWS,
    HURST_MIN,
    HURST_MAX,
} from './constants';

/**
 * @internal A single (log n, log R/S) observation for the Hurst regression.
 */
interface RescaledRangePoint {
    logN: number;
    logRs: number;
}

/**
 * @internal Rescaled range (R/S) of one contiguous return chunk.
 *
 * R = range (max − min) of the cumulative mean-adjusted deviations.
 * S = population standard deviation of the chunk.
 * Returns `null` when S = 0 (flat chunk → R/S undefined; guards divide-by-zero).
 */
function rescaledRange(chunk: number[]): number | null {
    const len = chunk.length;
    if (len < 2) return null;

    const mean = chunk.reduce((sum, v) => sum + v, 0) / len;
    const variance = chunk.reduce((sum, v) => sum + (v - mean) ** 2, 0) / len;
    const s = Math.sqrt(variance);
    if (s === 0) return null;

    // Cumulative mean-adjusted deviation profile; R is its peak-to-trough range.
    const deviations = chunk.map(v => v - mean);
    let cumulative = 0;
    let min = 0;
    let max = 0;
    // O(len) prefix-sum scan: each cumulative term depends on the prior one,
    // so a sequential accumulator is the only single-pass option (no O(len²)).
    const count = deviations.length;
    for (let i = 0; i < count; i++) {
        cumulative += deviations[i];
        if (cumulative < min) min = cumulative;
        if (cumulative > max) max = cumulative;
    }
    const r = max - min;
    return r / s;
}

/**
 * @internal Mean rescaled range over all non-overlapping chunks of length `n`
 * within `returns`. Skips flat chunks (R/S undefined); returns `null` if no
 * chunk yields a valid R/S.
 */
function meanRescaledRange(returns: number[], n: number): number | null {
    const chunkCount = Math.floor(returns.length / n);
    if (chunkCount === 0) return null;

    const values = Array.from({ length: chunkCount }, (_, c) =>
        rescaledRange(returns.slice(c * n, c * n + n))
    ).filter((v): v is number => v !== null);

    if (values.length === 0) return null;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * @internal Least-squares slope of `logRs` on `logN` across the R/S points.
 */
function rsSlope(points: RescaledRangePoint[]): number {
    const k = points.length;
    const sumX = points.reduce((sum, p) => sum + p.logN, 0);
    const sumY = points.reduce((sum, p) => sum + p.logRs, 0);
    const sumXY = points.reduce((sum, p) => sum + p.logN * p.logRs, 0);
    const sumX2 = points.reduce((sum, p) => sum + p.logN * p.logN, 0);
    return (k * sumXY - sumX * sumY) / (k * sumX2 - sumX * sumX);
}

/**
 * @internal Hurst exponent via rolling rescaled-range (R/S) analysis.
 *
 * For each bar with ≥ `window` prior closes, take the window's log-returns
 * (window−1 of them after differencing the `window` trailing closes... here we
 * use the `window` returns from `window+1` closes). For each sub-length
 * `n ∈ {window/4, window/2, window}` compute the mean R/S over non-overlapping
 * chunks of length `n`, then fit Hurst = slope of log(R/S) vs log(n) by least
 * squares. The result is clamped to [0, 1].
 *
 * Interpretation: H > 0.5 → persistent/trending; H < 0.5 → mean-reverting;
 * H ≈ 0.5 → random walk.
 *
 * Returns `null` until `window` returns are available, and `null` for any bar
 * whose window is degenerate (every sub-length flat → fewer than
 * HURST_MIN_SUBWINDOWS valid R/S points to regress).
 *
 * Cost: O(window) per bar (the chunk scans touch each return a constant number
 * of times across the fixed sub-length set).
 */
export function calculateHurst(
    closes: number[],
    window = HURST_WINDOW
): (number | null)[] {
    const n = closes.length;
    if (n === 0) return [];

    // Log-returns between consecutive closes; returns[i] derives from closes[i],closes[i+1].
    // returns.length = n - 1. A window of `window` returns needs `window + 1` closes.
    const returns: (number | null)[] = closes.map((c, i) => {
        if (i === 0) return null;
        const prev = closes[i - 1];
        if (prev <= 0 || c <= 0) return null; // guard ln of non-positive
        return Math.log(c / prev);
    });

    // Sub-lengths to sample (deduped + valid: ≥2 and ≤ window).
    const subLengths = Array.from(
        new Set([
            Math.floor(window / HURST_SUBWINDOW_DIVISOR_QUARTER),
            Math.floor(window / HURST_SUBWINDOW_DIVISOR_HALF),
            Math.floor(window / HURST_SUBWINDOW_DIVISOR_FULL),
        ])
    ).filter(len => len >= 2 && len <= window);

    return closes.map((_, i) => {
        // Window of `window` returns ending at bar i: returns indices [i-window+1 .. i].
        // returns[i-window+1] must be a valid number → requires i >= window.
        if (i < window) return null;

        const windowReturns = returns.slice(i - window + 1, i + 1);
        if (windowReturns.some(r => r === null)) return null;
        const valid = windowReturns as number[];

        const points: RescaledRangePoint[] = subLengths
            .map(len => {
                const rs = meanRescaledRange(valid, len);
                return rs !== null && rs > 0
                    ? { logN: Math.log(len), logRs: Math.log(rs) }
                    : null;
            })
            .filter((p): p is RescaledRangePoint => p !== null);

        if (points.length < HURST_MIN_SUBWINDOWS) return null;

        const slope = rsSlope(points);
        if (!Number.isFinite(slope)) return null;

        return Math.min(HURST_MAX, Math.max(HURST_MIN, slope));
    });
}
