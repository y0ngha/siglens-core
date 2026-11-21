/**
 * Shapes and pre-registered constants of the engine evaluation (`engineEval.ts`): the
 * placebo-controlled measurement of the candle and chart-pattern engines. Every number the
 * instrument uses lives here so `run.json` can record it and two arms are provably measured
 * with the same rules.
 *
 * Only the WP-17 thresholds are the instrument's own copy, deliberately independent of the
 * arm under test (an arm that changes a definition must not change how it is judged).
 * Everything the engine itself defines (the 500-bar production window, the detection window,
 * the pivot reversal multiple) is read from core, never copied.
 */
import { CANDLE_PATTERN_DETECTION_BARS } from '@/domain/analysis/candle-detection';
import { TIMEFRAME_BARS_LIMIT } from '@/domain/constants/market';
import { OUTCOME_WINDOW_BARS } from '@/domain/outcomes/constants';
import type { PatternOutcome } from '@/domain/outcomes/types';
import {
    PIVOT_REVERSAL_ATR_MULT,
    SCREEN_LOOKBACK_BARS,
} from '@/domain/patterns/constants';

export const EVAL_SEED = 20261121;

/** The instrument's pre-registered thresholds (deliberately independent of the arm). */
export const EVAL_CONSTANTS = {
    seed: EVAL_SEED,
    /** Placebo dates drawn per event. */
    placeboCount: 20,
    /** An event with fewer eligible placebo dates is dropped and counted. */
    minPlacebo: 5,
    /** A placebo date lies within this many bars of the event bar. */
    placeboRadius: 250,
    /** Event and placebo bars need this many prior bars (as `buildSet`). */
    minPriorBars: 260,
    /** Prior-move rule of the candle definitions (WP-17 §2.1). */
    candlePriorTrendBars: 10,
    candlePriorTrendMinAtr: 1,
    candleSetupBodyAtr: 0.25,
    /** A body of at most this share of the range is a doji-sized bar. */
    dojiBodyRatio: 0.1,
    /** Robustness variants (WP-17 §7.4): reported, never used to pick the shipped values. */
    robustPriorMoveAtr: [0.5, 1.5],
    robustBodyFloorAtr: [0.1, 0.5],
    patternForwardBars: 60,
    /** Chart-pattern prior-trend bucket used to match placebo dates. */
    patternPriorTrendBars: 20,
    patternPriorTrendMinAtr: 2,
    /** Cluster bootstrap by ISO week; the block variant clusters this many weeks together. */
    bootstrapReplicates: 2000,
    blockWeeks: 13,
    /** A family is reported only from this many events. */
    minFamilyN: 100,
    /** Bars dated up to this year are the early time half. */
    earlyHalfLastYear: 2021,
    /** Relative tolerance when a printed level is compared with a recomputed one. */
    levelTolerance: 1e-9,
} as const;

/** What the arm's own engine defines; recorded in `run.json` so two runs are comparable. */
export const CORE_DERIVED = {
    /** The production bars window (`TIMEFRAME_BARS_LIMIT['1Day']`). */
    windowBars: TIMEFRAME_BARS_LIMIT['1Day'],
    candleDetectionBars: CANDLE_PATTERN_DETECTION_BARS,
    patternLookbackBars: SCREEN_LOOKBACK_BARS,
    pivotReversalAtrMult: PIVOT_REVERSAL_ATR_MULT,
    labelWindowBars: OUTCOME_WINDOW_BARS,
} as const;

export const HORIZONS = { h1: 1, h5: 5, h10: 10 } as const;
export type HorizonKey = keyof typeof HORIZONS;
export const HORIZON_KEYS: readonly HorizonKey[] = ['h1', 'h5', 'h10'];
export const PRIMARY_HORIZON: HorizonKey = 'h5';
export const MAX_HORIZON_BARS = 10;
export type PerHorizon<T> = Record<HorizonKey, T>;

export function perHorizon<T>(read: (key: HorizonKey) => T): PerHorizon<T> {
    return { h1: read('h1'), h5: read('h5'), h10: read('h10') };
}

export type PriorBucket = 'decline' | 'none' | 'advance';
export type PatternBucket = 'down' | 'none' | 'up';
export type EvalMarket = 'us' | 'kr';
export type EvalHalf = 'early' | 'late';

// ─── G1 ───────────────────────────────────────────────────────────────────────

/** One gate per PR: core-1 (candles), core-2 (pivots), core-3 (geometry). */
export const G1_GATES = ['c9', 'pivots', 'geometry'] as const;
export type G1Gate = (typeof G1_GATES)[number];

/** Violation codes of the G1 candle counters, recomputed from OHLC. */
export const CANDLE_VIOLATIONS = [
    'context',
    'setupBody',
    'dojiSetup',
    'tweezersClose',
] as const;
export type CandleViolation = (typeof CANDLE_VIOLATIONS)[number];

/** Every chart-pattern counter the walk-forward keeps (`metric` and `metric:id`). */
export const PATTERN_METRICS = [
    'days',
    'candidateDays',
    'directedDays',
    'undirectedDays',
    'wrongSideDays',
    'nonPositiveDays',
    'postBreakDays',
    'movingPostBreakDays',
    'statusPairs',
    'statusFlips',
    'unexplainedStatusFlips',
    'failedBreakoutDisagreeDays',
    'instances',
    'noForwardWindow',
    'noPlacebo',
    'pivots',
    'selfConfirmedPivots',
    'selfConfirmedNotCloseProvenPivots',
    'pivotRepaintChecks',
    'pivotRepaints',
] as const;
export type PatternMetric = (typeof PATTERN_METRICS)[number];

/** The chart-pattern counters that must be 0 after a fix. */
export const G1_PATTERN_KEYS = [
    'wrongSideDays',
    'nonPositiveDays',
    'movingPostBreakDays',
    'unexplainedStatusFlips',
    'failedBreakoutDisagreeDays',
    'selfConfirmedNotCloseProvenPivots',
    'pivotRepaints',
] as const satisfies readonly PatternMetric[];
export type G1PatternKey = (typeof G1_PATTERN_KEYS)[number];

/** The pattern counters each PR is scored on (core-1 scores candles only). */
export const G1_SCORED_PATTERN_KEYS: Record<
    Exclude<G1Gate, 'c9'>,
    readonly G1PatternKey[]
> = {
    pivots: ['selfConfirmedNotCloseProvenPivots', 'pivotRepaints'],
    geometry: [
        'wrongSideDays',
        'nonPositiveDays',
        'movingPostBreakDays',
        'unexplainedStatusFlips',
        'failedBreakoutDisagreeDays',
        'pivotRepaints',
    ],
};

// ─── Events ───────────────────────────────────────────────────────────────────

/** Mean outcome over the placebo dates of one event (the event's own direction applied). */
export interface PlaceboSummary {
    n: number;
    /** `d × (close[t'+h] − close[t']) / ATR14[t']`, averaged. */
    y: PerHorizon<number>;
    /** The same move in percent. */
    pct: PerHorizon<number>;
    /** Share of placebo dates with a positive `y`. */
    hit: PerHorizon<number>;
}

export type CandleEventStatus = 'tested' | 'neutral' | 'dropped';

/** What the robustness variants (WP-17 §7.4) say about one event; never gating. */
export interface CandleRobustness {
    /** Context violation under a 0.5 / 1.5 ATR prior move. */
    contextViolation: { a05: boolean; a15: boolean };
    /** Setup-body violation under a 0.1 / 0.5 ATR floor. */
    setupBodyViolation: { f01: boolean; f05: boolean };
    /** The matched placebo re-drawn under the alternative prior-move thresholds. */
    matched: { a05: PlaceboSummary | null; a15: PlaceboSummary | null };
}

export interface CandleEvent {
    kind: 'candle';
    symbol: string;
    market: EvalMarket;
    /** Index of the pattern's last bar in the symbol's bars. */
    index: number;
    date: string;
    week: string;
    half: EvalHalf;
    pattern: string;
    patternType: 'single' | 'multi';
    barCount: number;
    /** `+1` bullish, `-1` bearish, `0` neutral (reported, not tested). */
    direction: 1 | -1 | 0;
    /** Prior-move bucket read before the pattern's first bar. */
    bucket: PriorBucket;
    violations: CandleViolation[];
    robust: CandleRobustness;
    status: CandleEventStatus;
    /** Direction-signed outcomes; `null` unless `status === 'tested'`. */
    y: PerHorizon<number> | null;
    pct: PerHorizon<number> | null;
    matched: PlaceboSummary | null;
    unmatched: PlaceboSummary | null;
}

export type PatternOutcomeKind = 'hit' | 'inval' | 'open';

/** WP-06 `labelPatternOutcome` on the instance (20 bars); a secondary outcome. */
export interface PatternLabel {
    outcome: PatternOutcome;
    skipReason: string | null;
    rwNullTargetFirst: number | null;
}

export interface PatternEvent {
    kind: 'pattern';
    symbol: string;
    market: EvalMarket;
    /** Index of the first-appearance day (the window's last bar) in the symbol's bars. */
    index: number;
    date: string;
    week: string;
    half: EvalHalf;
    id: string;
    direction: 'up' | 'down';
    bucket: PatternBucket;
    close: number;
    breakout: number;
    target: number;
    conservativeTarget: number;
    invalidation: number;
    /** Measured target / 50% target outcome within the forward window. */
    target60: PatternOutcomeKind;
    cons60: PatternOutcomeKind;
    /** Share of placebo dates whose transplanted target / 50% target was hit first. */
    placeboTargetHit: number;
    placeboConsHit: number;
    placeboN: number;
    label20: PatternLabel;
}

export type EvalEvent = CandleEvent | PatternEvent;

/** A weekly-clustered observation: one event's excess over its placebo. */
export interface Observation {
    week: string;
    value: number;
}
