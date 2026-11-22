/**
 * @internal
 * The seeded week-cluster bootstrap shared by the outcome record aggregator and the replay
 * scripts (`scripts/replay`): a 32-bit generator, resamples of clusters drawn with
 * replacement as multiplicity vectors, the resampled mean of a pool and the interpolated
 * quantile that turns replicates into a percentile interval. Pure; not on the public API.
 * Scripts import this file; `src` never imports `scripts`.
 */

/**
 * @internal
 * mulberry32: a 32-bit seeded generator returning floats in `[0, 1)`.
 */
export function mulberry32(seed: number): () => number {
    const state = { a: seed >>> 0 };
    return () => {
        state.a = (state.a + 0x6d2b79f5) >>> 0;
        const t1 = Math.imul(state.a ^ (state.a >>> 15), 1 | state.a);
        const t2 = (t1 + Math.imul(t1 ^ (t1 >>> 7), 61 | t1)) ^ t1;
        return ((t2 ^ (t2 >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * @internal
 * Quantile `p` (0..1) with linear interpolation between the closest ranks; `null` for
 * no values.
 */
export function quantile(values: readonly number[], p: number): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const position = (sorted.length - 1) * p;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/**
 * @internal
 * Per-cluster sums and counts of a pool, aligned with a sorted cluster list.
 */
export interface WeekAggregate {
    sums: readonly number[];
    counts: readonly number[];
}

/**
 * @internal
 * `replicates` resamples of `weekCount` clusters drawn with replacement, as multiplicity
 * vectors. Shared by every pool of one comparison, so a difference of two pools is taken
 * inside the same resample.
 */
export function resampleMultiplicities(
    weekCount: number,
    replicates: number,
    rand: () => number
): number[][] {
    return Array.from({ length: replicates }, () => {
        const multiplicity = Array.from({ length: weekCount }, () => 0);
        Array.from({ length: weekCount }).forEach(() => {
            multiplicity[Math.floor(rand() * weekCount)] += 1;
        });
        return multiplicity;
    });
}

/**
 * @internal
 * The pool's mean in one resample; `null` when the resample holds no observation.
 */
export function resampledMean(
    aggregate: WeekAggregate,
    multiplicity: readonly number[]
): number | null {
    const total = multiplicity.reduce(
        (acc, m, i) => ({
            sum: acc.sum + m * aggregate.sums[i],
            n: acc.n + m * aggregate.counts[i],
        }),
        { sum: 0, n: 0 }
    );
    return total.n === 0 ? null : total.sum / total.n;
}
