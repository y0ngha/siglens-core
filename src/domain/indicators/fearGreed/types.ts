/**
 * Five-stage label that classifies a Fear & Greed score into a qualitative
 * sentiment bucket. Maps to the spec §4.4 cutoffs (EXTREME_FEAR < 25 ≤ FEAR <
 * 45 ≤ NEUTRAL < 55 ≤ GREED < 75 ≤ EXTREME_GREED).
 */
export type FearGreedLabel =
    'EXTREME_FEAR' | 'FEAR' | 'NEUTRAL' | 'GREED' | 'EXTREME_GREED';

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
 * Group label for the two-tier composition. The final score is the equal-weight
 * average of the Flow and Trend group scores.
 */
export type FearGreedGroupName = 'Flow' | 'Trend';

/**
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

/**
 * A single point in a walk-forward Fear & Greed history series. `date` is the
 * ISO `YYYY-MM-DD` calendar date of `bars[t].time`. Same shape as
 * {@link FearGreedReading}, aliased so the two cannot drift apart.
 */
export type FearGreedHistoryPoint = FearGreedReading;

/**
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

/**
 * Minimal reading shape shared by the instrument and market-wide history
 * points (`FearGreedHistoryPoint`, `MarketFearGreedHistoryPoint`).
 */
export interface FearGreedReading {
    /** ISO `YYYY-MM-DD` session date. */
    date: string;
    /** Score in [0, 100], or `null` during warm-up / insufficient sample. */
    score: number | null;
    /** Label derived from `score`, or `null` when `score` is `null`. */
    label: FearGreedLabel | null;
}

/** A label change between two adjacent labelled sessions. */
export interface FearGreedLabelTransition {
    /** ISO date of the session that carries the new label. */
    date: string;
    /** Label on the previous session. */
    from: FearGreedLabel;
    /** Label on `date`. */
    to: FearGreedLabel;
}

/** The two extreme labels whose entries are aggregated. */
export type ExtremeFearGreedZone = 'EXTREME_FEAR' | 'EXTREME_GREED';

/** Close-to-close change after zone entries over one forward horizon. */
export interface ForwardChangeStat {
    /** Forward horizon in trading sessions. */
    horizon: number;
    /** Number of entries that had `horizon` sessions of data after them. */
    sampleSize: number;
    /** Median change in percent, or `null` when `sampleSize` is below the minimum. */
    median: number | null;
}

/** Past aggregate for one extreme zone. Descriptive only — not a forecast. */
export interface ExtremeZoneOutcome {
    /** The extreme zone this outcome describes. */
    zone: ExtremeFearGreedZone;
    /** Times the history entered the zone from a different labelled session. */
    entryCount: number;
    /** `'insufficient_sample'` when `entryCount` is below the minimum sample. */
    status: 'ok' | 'insufficient_sample';
    /** One entry per requested horizon, in the requested order. */
    forward: ForwardChangeStat[];
}

/** Options for `summarizeExtremeZoneOutcomes`. */
export interface ExtremeZoneOutcomeOptions {
    /** Forward horizons in trading sessions. Defaults to 5, 20, 60. */
    horizons?: readonly number[];
    /** Minimum sample before a median is reported. Defaults to 5. */
    minSample?: number;
    /**
     * Sessions that must pass after leaving a zone before a return counts as a
     * new entry. Defaults to 20. `0` counts every move into the zone.
     */
    reentryGap?: number;
}

/**
 * One stay in an extreme zone: from the entry session to the last session
 * spent in the zone before the next entry. Quick returns within the re-entry
 * gap belong to the same episode.
 */
export interface ExtremeZoneEpisode {
    /** ISO date of the entry session. */
    startDate: string;
    /** ISO date of the last session in the episode that carried the zone label. */
    endDate: string;
    /**
     * Sessions in the episode that carried the zone label. Sessions that briefly
     * left the zone between `startDate` and `endDate` are not counted, nor are
     * zone sessions after a warm-up gap that belong to no episode.
     */
    sessionsInZone: number;
    /**
     * Most extreme score in the episode — lowest for fear, highest for greed.
     * `null` only for malformed input where no zone session carries a score.
     */
    peakScore: number | null;
    /**
     * `true` when the history's last session is in the zone and in this
     * episode. A last session that follows a warm-up gap belongs to no episode,
     * so it leaves every episode `false`.
     */
    ongoing: boolean;
}

/** Episode record for one extreme zone. Descriptive only — not a forecast. */
export interface ExtremeZoneEpisodeSummary {
    /** The extreme zone these episodes describe. */
    zone: ExtremeFearGreedZone;
    /** Times the history entered the zone (equals `episodes.length`). */
    entryCount: number;
    /** Median of `sessionsInZone` across episodes, or `null` with no episodes. */
    medianSessionsInZone: number | null;
    /** Episodes, newest first. */
    episodes: ExtremeZoneEpisode[];
}

/** Options for `summarizeExtremeZoneEpisodes`. */
export interface ExtremeZoneEpisodeOptions {
    /**
     * Sessions that must pass after leaving a zone before a return counts as a
     * new entry. Defaults to 20. `0` counts every move into the zone.
     */
    reentryGap?: number;
}

/** Same-session gap between an instrument score and the market score. */
export interface FearGreedScoreGap {
    /** ISO date both scores describe. */
    date: string;
    /** The instrument's score on `date`. */
    symbolScore: number;
    /** The market-wide score on `date`. */
    marketScore: number;
    /** `symbolScore - marketScore`. Positive = instrument reads greedier than the market. */
    gap: number;
}
