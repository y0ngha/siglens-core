/**
 * Five-stage label that classifies a Fear & Greed score into a qualitative
 * sentiment bucket. Maps to the spec §4.4 cutoffs (EXTREME_FEAR < 25 ≤ FEAR <
 * 45 ≤ NEUTRAL < 55 ≤ GREED < 75 ≤ EXTREME_GREED).
 */
export type FearGreedLabel =
    | 'EXTREME_FEAR'
    | 'FEAR'
    | 'NEUTRAL'
    | 'GREED'
    | 'EXTREME_GREED';

/**
 * Confidence bucket derived from the walk-forward sample size:
 * - `normal`  — sample ≥ 60 bars (full distribution available)
 * - `limited` — sample ∈ [10, 60) bars (UI should show a reduced-confidence badge)
 * - `insufficient` — sample < 10 bars (snapshot is suppressed)
 */
export type FearGreedConfidence = 'normal' | 'limited' | 'insufficient';

/**
 * Spec §4.5 self-norm warning. `null` when neither chronic regime is detected.
 * `CHRONIC_WEAKNESS` flags a long-term bearish cycle, `CHRONIC_STRENGTH` a
 * long-term bullish cycle. UI surfaces a warning badge so users do not
 * over-interpret the score for chronically weak/strong instruments.
 */
export type FearGreedWarning = 'CHRONIC_WEAKNESS' | 'CHRONIC_STRENGTH' | null;

/**
 * Discriminator for the five raw factors that compose the Fear & Greed score.
 * Three live in the Flow group (`volume_z`, `buysell_imbalance`,
 * `poc_distance`); two in the Trend group (`ma200_distance`, `range_position`).
 */
export type FearGreedFactorKey =
    | 'volume_z'
    | 'buysell_imbalance'
    | 'poc_distance'
    | 'ma200_distance'
    | 'range_position';

/**
 * @internal
 * Group label for the two-tier composition. The final score is the equal-weight
 * average of the Flow and Trend group scores.
 */
export type FearGreedGroupName = 'Flow' | 'Trend';

/**
 * @internal
 * A single factor's raw value and its walk-forward percentile rank.
 */
export interface FearGreedFactor {
    /** Discriminator identifying which factor this entry represents. */
    key: FearGreedFactorKey;
    /** Pre-percentile raw value computed from bars / buy-sell volume. */
    rawValue: number;
    /** Percentile rank in [0, 100]; the GREED side maps to 100. */
    percentile: number;
}

/** A factor group (Flow or Trend) with its score and member factor breakdown. */
export interface FearGreedGroup {
    /** Group label — 'Flow' (volume / order flow) or 'Trend' (price structure). */
    name: FearGreedGroupName;
    /** Equal-weight average of member factor percentiles, in [0, 100]. */
    score: number;
    /** Member factors that compose this group's score. */
    factors: FearGreedFactor[];
}

/**
 * Latest-bar Fear & Greed snapshot returned by `computeFearGreedIndex`. The
 * `confidence` field excludes 'insufficient' because the public API returns
 * `null` (rather than a snapshot) when the sample size is below the LIMITED
 * threshold.
 */
export interface FearGreedSnapshot {
    /** Composite score in [0, 100]; equal-weight average of the two group scores. */
    score: number;
    /** Five-stage label derived from `score`. */
    label: FearGreedLabel;
    /** Per-group breakdown — one entry for Flow, one for Trend. */
    groups: FearGreedGroup[];
    /**
     * Confidence bucket derived from the walk-forward sample size. Narrowed
     * to exclude `'insufficient'` because the API returns `null` instead of
     * a snapshot when the sample is below the LIMITED threshold.
     */
    confidence: Exclude<FearGreedConfidence, 'insufficient'>;
    /** Number of valid prior factor samples used to compute percentiles. */
    sampleSize: number;
    /** Spec §4.5 chronic regime flag, or `null` when neither regime applies. */
    warning: FearGreedWarning;
}

/** A single point in a walk-forward Fear & Greed history series. */
export interface FearGreedHistoryPoint {
    /** ISO `YYYY-MM-DD` calendar date corresponding to `bars[t].time`. */
    date: string;
    /** Score in [0, 100], or `null` during warm-up / when sample is insufficient. */
    score: number | null;
    /** Label derived from `score`, or `null` when `score` is `null`. */
    label: FearGreedLabel | null;
}

/**
 * @internal
 * Optional configuration for the public `computeFearGreedIndex` / `computeFearGreedHistory` APIs.
 */
export interface ComputeFearGreedOptions {
    /** Volume Profile window (in bars) used to derive POC for the POC-distance factor. Defaults to 60. */
    pocWindow?: number;
}

/** @internal Helper — 5-factor raw value bundle used by factors, composition, and walkForward modules only. */
export interface FactorValues {
    volumeZ: number;
    buySellImb: number;
    pocDist: number;
    ma200Dist: number;
    rangePosition: number;
}
