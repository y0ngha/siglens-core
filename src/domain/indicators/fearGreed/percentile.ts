/**
 * Returns the percentile of `value` within `sample` as a number in [0, 100].
 *
 * Definition (mid-rank / "fractional ranking"): (count strictly less than value +
 * 0.5 * count equal to value) / sample size. Empty sample → 50 (neutral fallback).
 *
 * Mid-rank, not strict-less: several factors feed this function with a value that
 * legitimately ties the whole sample (e.g. buy/sell imbalance is exactly 0 when no
 * volume data is available, or a flat close gives volumeZ = 0 for every zero-return
 * session). Strict-less would rank every one of those ties at the very bottom (0),
 * which reads as "maximally fearful" even though a tie carries no directional
 * information. Mid-rank places ties at the middle of the tied group instead, so a
 * fully-tied sample scores neutral (50) rather than the worst possible score.
 *
 * When no sample element equals `value` (the usual case for continuous factors —
 * walk-forward samples exclude the current observation), `equal` is 0 and the
 * result is identical to the strict-less definition.
 *
 * Pure function, single O(n) pass, no sort. No look-ahead bias mitigation here —
 * caller is responsible for passing a sample that excludes the current observation
 * when walk-forward is desired.
 *
 * @internal Used internally by composition.ts for self-normalization. Not part of the public API.
 */
export function percentile(value: number, sample: number[]): number {
    if (sample.length === 0) return 50;
    let below = 0;
    let equal = 0;
    for (const v of sample) {
        if (v < value) below++;
        else if (v === value) equal++;
    }
    return ((below + 0.5 * equal) / sample.length) * 100;
}
