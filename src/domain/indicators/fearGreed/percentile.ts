/**
 * Returns the percentile of `value` within `sample` as a number in [0, 100].
 *
 * Definition: count of elements strictly less than `value`, divided by sample size.
 * Empty sample → 50 (neutral fallback).
 *
 * Pure function. No look-ahead bias mitigation here — caller is responsible for
 * passing a sample that excludes the current observation when walk-forward is desired.
 */
export function percentile(value: number, sample: number[]): number {
    if (sample.length === 0) return 50;
    let below = 0;
    for (const v of sample) {
        if (v < value) below++;
    }
    return (below / sample.length) * 100;
}
