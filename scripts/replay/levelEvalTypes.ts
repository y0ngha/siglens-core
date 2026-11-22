/**
 * Shapes and pre-registered constants of the price-level evaluation (`levelEval.ts`,
 * WP-18 core-0): the placebo-controlled measurement of whether the levels a prompt prints
 * ("held" after a touch) carry information, and whether any score built from their features
 * would. Every number the instrument uses lives here so `run.json` can record it.
 *
 * The instrument's thresholds and the outcome definition are its own copy, independent of
 * the arm under test: a checkout that changes `labelLevelOutcome` or a level feature must
 * not change how it is judged. `levelEval.ts` counts how often its own evaluator and
 * `labelLevelOutcome` disagree on the real levels (`labelAgreement`) so a drift shows up.
 */
import type { LevelOutcome } from '@/domain/outcomes/types';
import {
    LEVEL_BARRIER_ATR,
    LEVEL_FOLLOW_BARS,
    LEVEL_MIN_DISTANCE_ATR,
    LEVEL_TOUCH_BAND_ATR,
    OUTCOME_WINDOW_BARS,
    PLACEBO_SHIFT_ATR,
} from '@/domain/outcomes/constants';
import type { EvalMarket } from './engineEvalTypes';

export const LEVEL_EVAL_SEED = 20261122;

export const LEVEL_EVAL_CONSTANTS = {
    seed: LEVEL_EVAL_SEED,
    /** Every `step`-th bar from `firstBar` with `forwardBars` bars after it is a study day. */
    defaultStep: 3,
    firstBar: 300,
    forwardBars: 20,
    /** The production daily window the reference is computed on. */
    windowBars: 500,
    /** Two printed levels within this many ATR count as one coinciding group (confluence). */
    clusterAtr: 0.25,
    /** Bars looked back for touches, reactions and volume density. */
    lookbackBars: 120,
    /** A past bar whose range reaches within this many ATR of the level is a touch. */
    touchBandAtr: 0.1,
    /** Touches closer than this many bars are one episode. */
    episodeGapBars: 5,
    /** A reaction: a close this many ATR away on the level's side within `reactionBars`. */
    reactionAtr: 1,
    reactionBars: 5,
    /** The outcome definition (WP-06 `labelLevelOutcome`), the instrument's own copy. */
    minDistanceAtr: 0.25,
    barrierAtr: 0.5,
    followBars: 10,
    /** Date-transplant placebo: other sampled days of the same symbol within this many bars. */
    transplantCount: 3,
    transplantRadiusBars: 250,
    /** A partner day this close shares the real level's outcome window (20 forward + 10 follow bars). */
    transplantExcludeBars: 30,
    /** The score is fitted on days before `splitTime` minus the embargo and scored from it. */
    splitTime: Date.UTC(2022, 0, 1) / 1000,
    embargoSeconds: 20 * 86_400 * 1.45,
    /** The test period is cut into two halves here (its midpoint) for the L-gate. */
    testHalfSplitTime: Date.UTC(2024, 6, 1) / 1000,
    /** Logistic fit. */
    l2: 1,
    maxIterations: 50,
    /** A level feature the band tables are cut with. */
    scoreBands: 5,
    /** Robustness: barriers swept and the share of levels (`hash % n === 0`) it is run on. */
    robustBarriersAtr: [0.5, 1],
    robustSampleModulus: 5,
    robustMinN: 500,
    /** Held-rate table groups: kinds and episodes saturate here. */
    kindsCap: 4,
    episodesCap: 5,
    reactionsCap: 3,
    distanceCapAtr: 3,
    bootstrapReplicates: 2000,
} as const;

/** The core definitions the instrument's own copy must equal; recorded beside the constants. */
export const LEVEL_EVAL_CORE_DERIVED = {
    labelMinDistanceAtr: LEVEL_MIN_DISTANCE_ATR,
    labelTouchBandAtr: LEVEL_TOUCH_BAND_ATR,
    labelBarrierAtr: LEVEL_BARRIER_ATR,
    labelFollowBars: LEVEL_FOLLOW_BARS,
    labelWindowBars: OUTCOME_WINDOW_BARS,
    labelPlaceboShiftAtr: PLACEBO_SHIFT_ATR,
} as const;

/**
 * WP-18 §1 / §8.3 L0: what the instrument must reproduce on set B at step 3 within
 * `tolerance` (0.2 pp; the AUC is compared on the same absolute scale). The figures are the
 * amended measurement: the date transplant leaves out partner days within 30 bars of the real
 * level (§1 had transplant 49.70% and top minus transplant -0.6 pp before that exclusion).
 */
export const L0_REFERENCE = {
    /** `barsFingerprint` of `replay-sets/v1` (set B). */
    setFingerprint:
        '0ba4d6a50b731f880777cd867c6e472903d9c7311b2a2476fc588a3d87ec9f0e',
    step: 3,
    held: 0.4965,
    transplantHeld: 0.4967,
    auc: 0.5147,
    topMinusTransplant: -0.0048,
    tolerance: 0.002,
} as const;

/** The families the per-kind tables group the reference level kinds into. */
export const KIND_FAMILY: Readonly<Record<string, string>> = {
    fib_retracement: 'fib',
    fib_extension: 'fib',
    fib_abc_extension: 'fib',
    vp_poc: 'vp',
    vp_vah: 'vp',
    vp_val: 'vp',
    swing_high: 'swing',
    swing_low: 'swing',
    ma: 'ma',
    ema: 'ma',
    round: 'round',
    pivot_standard: 'pivot',
    pivot_camarilla: 'pivot',
    pivot_fibonacci: 'pivot',
    pivot_woodie: 'pivot',
    pivot_demark: 'pivot',
    ichimoku: 'ichimoku',
    donchian: 'band',
    bollinger: 'band',
    keltner: 'band',
    supertrend: 'supertrend',
    vwap: 'vwap',
    avwap: 'avwap',
};

/** The R:R anchor table keeps the two pivot kinds apart (the audit's grouping). */
export const ANCHOR_FAMILY: Readonly<Record<string, string>> = {
    ...KIND_FAMILY,
    pivot_standard: 'pivot_standard',
    pivot_camarilla: 'pivot_camarilla',
    pivot_fibonacci: 'pivot_fibonacci',
    pivot_woodie: 'pivot_woodie',
    pivot_demark: 'pivot_demark',
};

export type LevelSideName = 'support' | 'resistance';

/** The outcomes a held-rate reads: a resolved touch is `respected` or `broken`. */
export type HeldOutcome = LevelOutcome | 'skipped';

/** What the structural R:R block would have anchored on, from the market reference alone. */
export interface RrAnchors {
    horizon: 'short' | 'medium' | 'long';
    upKind: string;
    downKind: string;
    ratio: number | null;
    upAtr: number;
    downAtr: number;
}

/** Non-positive prices a day's reference carries, by where they surface (G42). */
export interface NonPositiveCounts {
    /** Levels of the three horizons. */
    horizons: number;
    /** Levels `printedLevelsOnSide` returns (the prompt lines and the stop candidates). */
    printed: number;
    /** Levels of the Fibonacci overlay candidates. */
    fibOverlay: number;
    /** `horizon:label:price` of the horizon levels, for the examples. */
    labels: readonly string[];
}

/** Features of one printed level, computed from bars up to and including `t` only. */
export interface LevelFeatures {
    side: LevelSideName;
    rank: number;
    kind: string;
    family: string;
    price: number;
    /** Distance from the close in ATR(14). */
    dAtr: number;
    /** Distinct kind families within `clusterAtr` of the level (itself included). */
    kinds: number;
    /** Printed levels within `clusterAtr` (itself included). */
    nearN: number;
    /** Touch episodes in the look-back. */
    episodes: number;
    /** Episodes followed by a reaction of at least `reactionAtr` ATR. */
    reactions: number;
    /** Bars since the last touch; `null` when none. */
    lastTouchAgo: number | null;
    /** Volume density at the level against the window's mean; `null` without volume. */
    volRatio: number | null;
}

/** One study day: the reference at bar `t` and its printed levels. */
export interface DayFeatures {
    symbol: string;
    market: EvalMarket;
    /** Index of the bar in the symbol's bars. */
    t: number;
    time: number;
    close: number;
    atr: number;
    rr: RrAnchors | null;
    nonPositive: NonPositiveCounts;
    levels: readonly LevelFeatures[];
}

/** A level with its labels: the unit every table counts. */
export interface LevelRow extends LevelFeatures {
    symbol: string;
    market: EvalMarket;
    t: number;
    time: number;
    week: string;
    outcome: HeldOutcome;
    /** The labeller's placebos: the level moved 0.5 ATR farther, and closer. */
    shift: readonly [HeldOutcome, HeldOutcome];
    /** The date-transplant placebo outcomes (empty when the day has too few partners). */
    transplant: readonly HeldOutcome[];
}

/** A day with the ten and twenty session returns the R:R check reads. */
export type DayRow = Omit<DayFeatures, 'levels'> & {
    ret10: number | null;
    ret20: number | null;
};

export const isResolved = (outcome: HeldOutcome): boolean =>
    outcome === 'respected' || outcome === 'broken';
