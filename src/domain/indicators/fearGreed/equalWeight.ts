import {
    FEAR_GREED_CONFIDENCE_THRESHOLDS,
    scoreToLabel,
} from '@/domain/indicators/fearGreed/composition';
import { percentile } from '@/domain/indicators/fearGreed/percentile';
import type {
    FearGreedConfidence,
    FearGreedHistoryPoint,
    FearGreedLabel,
} from '@/domain/indicators/fearGreed/types';

/**
 * Raw factor values for one session, keyed by factor key.
 *
 * @internal Shared by the market-wide and crypto Fear & Greed indices.
 */
export type FactorBundle<K extends string> = Record<K, number>;

/**
 * Equal-weight composite of per-factor walk-forward percentiles — the shape
 * shared by the market-wide and crypto snapshots, minus the session date.
 *
 * @internal Shared by the market-wide and crypto Fear & Greed indices.
 */
export interface EqualWeightComposition<K extends string> {
    /** Equal-weight mean of the factor percentiles, in [0, 100]. */
    score: number;
    /** Five-stage label derived from `score`. */
    label: FearGreedLabel;
    /** Per-factor breakdown, in the key order passed to the composer. */
    factors: Array<{ key: K; rawValue: number; percentile: number }>;
    /** `'normal'` at ≥ NORMAL prior samples, else `'limited'`. */
    confidence: Exclude<FearGreedConfidence, 'insufficient'>;
    /** Number of valid prior factor samples used to compute percentiles. */
    sampleSize: number;
}

/**
 * Compose an index score from the current raw factors and the walk-forward
 * sample of prior sessions.
 *
 * Each factor is self-normalised into a percentile against its own history, so
 * factors measured in different units (a moving-average distance, a return
 * spread, a share of coins) combine on one comparable 0..100 scale. The
 * composite is their equal-weight mean — the same weighting CNN applies to its
 * own inputs.
 *
 * @param keys - Factor keys, in display order. Also fixes the summation order,
 *   so the score is reproducible bit-for-bit.
 * @param current - Raw factor values for the session being scored.
 * @param sample - Raw factor values from strictly earlier sessions.
 * @returns The composition, or `null` when the sample is below the LIMITED
 *   confidence threshold and percentile ranks would be noise.
 *
 * @internal Shared by the market-wide and crypto Fear & Greed indices.
 */
export function composeEqualWeightSnapshot<K extends string>(
    keys: readonly K[],
    current: FactorBundle<K>,
    sample: FactorBundle<K>[]
): EqualWeightComposition<K> | null {
    const sampleSize = sample.length;
    if (sampleSize < FEAR_GREED_CONFIDENCE_THRESHOLDS.LIMITED) return null;

    const factors = keys.map(key => ({
        key,
        rawValue: current[key],
        percentile: percentile(
            current[key],
            sample.map(s => s[key])
        ),
    }));

    const score =
        factors.reduce((sum, f) => sum + f.percentile, 0) / factors.length;

    return {
        score,
        label: scoreToLabel(score),
        factors,
        confidence:
            sampleSize >= FEAR_GREED_CONFIDENCE_THRESHOLDS.NORMAL
                ? 'normal'
                : 'limited',
        sampleSize,
    };
}

/**
 * Walk-forward snapshot for the last session of a factor time series.
 *
 * The distribution is every valid factor bundle strictly before the last
 * session — the current session is never part of its own ranking.
 *
 * @param keys - Factor keys, in display order.
 * @param dates - ISO session dates, ascending, index-aligned to `factorTS`.
 * @param factorTS - Raw factor bundle per session, `null` where uncomputable.
 * @returns The composition stamped with the last session's date, or `null`
 *   when there is no session, the last bundle is `null`, or the prior sample
 *   is below the LIMITED threshold.
 *
 * @internal Shared by the market-wide and crypto Fear & Greed indices.
 */
export function walkForwardSnapshot<K extends string>(
    keys: readonly K[],
    dates: string[],
    factorTS: Array<FactorBundle<K> | null>
): (EqualWeightComposition<K> & { asOf: string }) | null {
    if (dates.length === 0) return null;

    const t = dates.length - 1;
    const current = factorTS[t];
    if (!current) return null;

    const sample = factorTS
        .slice(0, t)
        .filter((f): f is FactorBundle<K> => f !== null);

    const composition = composeEqualWeightSnapshot(keys, current, sample);
    if (!composition) return null;

    return { ...composition, asOf: dates[t] };
}

/**
 * Walk-forward score history, one point per session.
 *
 * For each session `t` the distribution is the valid factor bundles in
 * `[0, t)`, so appending later sessions never changes an earlier point. A
 * `null` bundle, or a prior sample below the LIMITED threshold, yields
 * `score: null` (rendered as a gap).
 *
 * @param keys - Factor keys, in display order.
 * @param dates - ISO session dates, ascending, index-aligned to `factorTS`.
 * @param factorTS - Raw factor bundle per session, `null` where uncomputable.
 * @returns One `{ date, score, label }` point per session.
 *
 * @internal Shared by the market-wide and crypto Fear & Greed indices.
 */
export function walkForwardHistory<K extends string>(
    keys: readonly K[],
    dates: string[],
    factorTS: Array<FactorBundle<K> | null>
): FearGreedHistoryPoint[] {
    const sample: FactorBundle<K>[] = [];
    const out: FearGreedHistoryPoint[] = new Array(dates.length);

    // Sequential, not a `.map` — each session's percentile ranks depend on the
    // sample accumulated by the sessions before it.
    for (let t = 0; t < dates.length; t++) {
        const date = dates[t];
        const current = factorTS[t];

        if (!current) {
            out[t] = { date, score: null, label: null };
            continue;
        }

        const composition = composeEqualWeightSnapshot(keys, current, sample);
        out[t] = composition
            ? { date, score: composition.score, label: composition.label }
            : { date, score: null, label: null };
        sample.push(current);
    }

    return out;
}
