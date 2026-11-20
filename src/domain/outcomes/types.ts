import type {
    EntryRecommendation,
    PatternBreakoutDirection,
    RiskLevel,
    Trend,
} from '@/domain/types';
import type { OUTCOME_SUBJECT_VERSION } from '@/domain/outcomes/constants';

/**
 * Where a key level sits relative to the price at capture. `poc` is resolved to a side
 * when labelled.
 */
export type OutcomeLevelRole = 'support' | 'resistance' | 'poc';

/**
 * What an analysis claimed, copied at capture time so a label can still be computed after
 * the analysis row is pruned. Prices are in the basis of the bars the analysis saw;
 * `labelAnalysisOutcome` rescales them to the window's basis.
 */
export interface OutcomeSubject {
    v: typeof OUTCOME_SUBJECT_VERSION;
    /** `result.dataAsOf`; `null` on rows stored before it existed. */
    anchor: { barTime: number; close: number } | null;
    trend: Trend;
    riskLevel: RiskLevel;
    /** `null` when the result carried no `actionRecommendation`. */
    plan: {
        recommendation: EntryRecommendation | null;
        entryLow: number | null;
        entryHigh: number | null;
        /** The effective stop; `null` when missing or rejected by core. Never a guessed value. */
        stop: number | null;
        /** Effective targets, finite, above the zone, unique and ascending. */
        targets: number[];
        /** `reconciledLevels` was present on the result. */
        reconciled: boolean;
    } | null;
    levels: {
        role: OutcomeLevelRole;
        price: number;
        /** Labels of the prompt's Market Reference levels at this price; `[]` without a prompt. */
        refLabels: string[];
    }[];
    scenarioTargets: { side: 'bullish' | 'bearish'; price: number }[];
    patterns: {
        name: string;
        candidateId: string | null;
        breakout: number;
        extreme: number;
        direction: PatternBreakoutDirection;
        invalidation: number | null;
    }[];
}

/** One bar as `[time (seconds), open, high, low, close]`. */
export type OutcomeBarTuple = readonly [
    time: number,
    open: number,
    high: number,
    low: number,
    close: number,
];

/**
 * The bars a label is computed from, JSON-serialisable and stored next to the label so it
 * can be recomputed offline. Every price is in the basis of the bars at build time.
 */
export interface OutcomeWindow {
    /** The price the analysis is measured from (C0). */
    referencePrice: number;
    /**
     * Multiplier from the prices the analysis saw to the window's basis: `1` unless a split
     * or dividend adjusted the anchor bar after the analysis.
     */
    adjFactor: number;
    /**
     * The anchor bar was still forming at analysis time; its rest was not observed and the
     * factor is unverifiable.
     */
    anchorForming: boolean;
    /**
     * How the anchor bar was found. `prompt_bar`: the analysis named it (`dataAsOf.barTime`),
     * so `referencePrice` is a price the analysis saw. `generated_at`: the named bar was
     * unknown and the bar the generation time falls in was used (a degraded fallback for
     * rows whose prompt is gone), so `referencePrice` is that bar's **final** close, not a
     * price the analysis saw. Statistics should exclude or separate `generated_at` rows.
     */
    anchorSource: OutcomeAnchorSource;
    /**
     * ATR(14) at the anchor bar, computed from the `OUTCOME_PRE_BARS` bars up to the anchor
     * only (not the whole history); `null` without enough bars.
     */
    atr: number | null;
    /**
     * Closes up to and including the anchor (at most `OUTCOME_PRE_BARS`); the last equals
     * `referencePrice`.
     */
    preCloses: readonly number[];
    /**
     * The anchor bar as the bars file holds it now (its final range and close). For a
     * forming anchor this is more than the analysis saw; `referencePrice` is the close it saw.
     */
    anchorBar: OutcomeBarTuple;
    /** The `OUTCOME_WINDOW_BARS` bars after the anchor, oldest first. */
    forward: readonly OutcomeBarTuple[];
}

/** See `OutcomeWindow.anchorSource`. */
export type OutcomeAnchorSource = 'prompt_bar' | 'generated_at';

/** Which bar an analysis belongs to: the one it names, or the one its generation time falls in. */
export type OutcomeAnchor =
    | {
          barTime: number;
          closeAtAnalysis: number;
          /**
           * The bar was closed when the analysis ran, so its close can be compared with today's.
           */
          closedAtAnalysis: boolean;
      }
    | { generatedAtMs: number };

export type OutcomeWindowResult =
    | { status: 'ok'; window: OutcomeWindow }
    | { status: 'anchor_missing' }
    /** `factor` is `null` when the ratio is not a finite number (`NaN` does not survive JSON). */
    | { status: 'anchor_mismatch'; factor: number | null }
    | { status: 'insufficient_forward'; have: number; need: number };

/** Plain return of one horizon, next to the same symbol's mean return over the same horizon. */
export interface ForwardReturnLabel {
    /** Horizon in bars. */
    h: number;
    /**
     * Close at offset `h` against the reference price, in percent; `null` when the window
     * does not reach `h`.
     */
    returnPct: number | null;
    /**
     * Mean `h`-bar return of the symbol over the window's closes; `null` below
     * `BASELINE_MIN_SAMPLES`.
     */
    baselinePct: number | null;
    /** Number of `h`-bar returns behind `baselinePct`. */
    baselineN: number;
}

export type PlanOutcome =
    | 'no_plan'
    | 'not_triggered'
    | 'void_at_entry'
    | 'target_first'
    | 'stop_first'
    | 'ambiguous'
    | 'open_at_horizon';

/** Why a plan was not evaluated (`no_plan`) or voided at the fill (`void_at_entry`). */
export type PlanReason =
    | 'none'
    | 'avoid'
    | 'no_entry'
    | 'no_stop'
    | 'no_target'
    | 'stop_inside_zone'
    /** `gap_below_stop`: a gap from above the zone low jumped the zone and the stop; `gap_below_zone`: it jumped the zone only. */
    | 'gap_below_stop'
    | 'gap_below_zone'
    | 'no_target_above_fill';

/**
 * Where the reference price sat against the zone; for stratification, the fill follows
 * where each bar opens.
 */
export type PlanApproach = 'from_above' | 'from_below' | 'inside';

/** Outcome of a long-only plan; fields that do not apply to the outcome are `null`. */
export interface PlanOutcomeLabel {
    /**
     * The verdict of the plan (`wait` plans are evaluated too); `null` when the plan had
     * none. Always split statistics by it.
     */
    recommendation: EntryRecommendation | null;
    outcome: PlanOutcome;
    reason: PlanReason | null;
    approach: PlanApproach | null;
    /**
     * Forward offset (1-based) of the bar that filled the entry (`void_at_entry` with
     * `gap_below_stop` or `gap_below_zone`: of the gap bar, with no fill).
     */
    entryOffset: number | null;
    /**
     * Offset of the bar the plan resolved on (`ambiguous`: the bar both levels were touched
     * on).
     */
    exitOffset: number | null;
    /** Always inside the planned zone: a fill is never recorded outside it. */
    fill: number | null;
    /**
     * The target the plan was measured against: the nearest target above the fill (the
     * first one the plan would exit on); `null` when there was no fill, and also on a filled
     * `void_at_entry` / `no_target_above_fill` row (a fill with no target above it). A
     * later bar that opens beyond the target or the stop exits at that open, as a resting
     * order would, so a return can exceed the target's return or be worse than the stop's.
     */
    target: number | null;
    /**
     * `true` when the anchor bar was still forming at analysis time and its final range
     * overlaps the zone (`low ≤ zone high` and `high ≥ zone low`): the plan may have filled
     * in the part of the anchor bar the labeller cannot see. Exclude or separate these rows
     * in statistics.
     */
    anchorBarUnobserved: boolean;
    /**
     * Exit price: the stop, the target, a gap open, or the close at the horizon. `null` for
     * `ambiguous`.
     */
    exit: number | null;
    /** The exit was a gap open through the level, not the level itself. */
    gap: boolean | null;
    /** `(exit / fill − 1) × 100` for `target_first`, `stop_first`, `open_at_horizon`. */
    returnPct: number | null;
    /** Bars from the entry bar to the exit bar, both inclusive. */
    holdBars: number | null;
    /**
     * Probability a driftless random walk from the fill reaches the target before the stop,
     * with **no horizon**. It is comparable to the `target_first` share only over **all**
     * triggered plans (the denominator includes `open_at_horizon`, `ambiguous` and
     * `stop_first`), never over resolved trades only.
     */
    rwNullTargetFirst: number | null;
    /** Mean same-symbol return over `holdBars` bars: the exposure-matched baseline. */
    baselineSameLengthPct: number | null;
    baselineN: number | null;
    /** Return from the close before the entry bar to the close of the exit bar. */
    sameWindowHoldPct: number | null;
}

export type LevelOutcome =
    | 'skipped'
    | 'untouched'
    | 'broken'
    | 'respected'
    | 'inconclusive'
    | 'touched_late';

export type LevelSkipReason = 'no_atr' | 'wrong_side' | 'at_price';

/**
 * One placebo: the level moved `shiftAtr` ATRs (`+` farther from the reference price, `−`
 * closer). Compare a real level with its placebo only on rows where both were evaluated
 * (neither `skipped`).
 */
export interface LevelPlaceboLabel {
    shiftAtr: number;
    outcome: LevelOutcome;
    skipReason: LevelSkipReason | null;
    touchOffset: number | null;
}

export interface LevelOutcomeLabel {
    outcome: LevelOutcome;
    skipReason: LevelSkipReason | null;
    /** `|price − reference| / atr`; `null` without a usable ATR. */
    distanceAtr: number | null;
    touchOffset: number | null;
    /** Offset the touch resolved on (`broken` or `respected`). */
    resolveOffset: number | null;
    /** The break was an open beyond the barrier, not a close. */
    gap: boolean;
    placebo: LevelPlaceboLabel[];
}

/** A subject level with its label; `price` is in the basis of the subject. */
export interface LevelOutcomeEntry extends LevelOutcomeLabel {
    role: OutcomeLevelRole;
    price: number;
}

export interface ScenarioTargetLabel {
    side: 'bullish' | 'bearish';
    /** In the basis of the subject. */
    price: number;
    /** `|price − reference| / atr`; `null` for a wrong-side target or without a usable ATR. */
    distanceAtr: number | null;
    touched: boolean;
    touchOffset: number | null;
}

export type PatternOutcome =
    | 'skipped'
    | 'no_breakout'
    | 'invalidated_before_breakout'
    | 'target_first'
    | 'invalidation_first'
    | 'ambiguous'
    | 'open_at_horizon';

export interface PatternOutcomeLabel {
    name: string;
    candidateId: string | null;
    direction: PatternBreakoutDirection;
    outcome: PatternOutcome;
    /**
     * `geometry_invalid`: the target is not past the breakout or the invalidation is on the
     * wrong side. `target_reached`: the reference price was already at or past the target
     * when the analysis was made. `target_reached_on_breakout`: the breakout bar itself
     * closed at or past it; count it apart from `target_reached`.
     */
    skipReason:
        | 'geometry_invalid'
        | 'target_reached'
        | 'target_reached_on_breakout'
        | null;
    /** The reference price was already past the breakout level. */
    alreadyBroken: boolean;
    /** Offset of the breakout bar (`0`: already broken at the reference). */
    breakoutOffset: number | null;
    resolveOffset: number | null;
    gap: boolean | null;
    /** Measured-move target in the basis of the window. */
    measuredTarget: number | null;
    /**
     * Random-walk probability of the target before the invalidation from the start price,
     * with no horizon (same comparability rule as `PlanOutcomeLabel.rwNullTargetFirst`);
     * `null` without an invalidation.
     */
    rwNullTargetFirst: number | null;
}

export interface AnalysisOutcomeLabels {
    /** `OUTCOME_LABEL_VERSION` the labels were computed under. */
    v: number;
    /** Forward bars actually scanned (`OUTCOME_WINDOW_BARS` for a window the builder produced). */
    windowBars: number;
    referencePrice: number;
    adjFactor: number;
    anchorForming: boolean;
    /** From the window; `generated_at` rows must not feed published statistics. */
    anchorSource: OutcomeAnchorSource;
    atr: number | null;
    forward: ForwardReturnLabel[];
    plan: PlanOutcomeLabel;
    levels: LevelOutcomeEntry[];
    scenarioTargets: ScenarioTargetLabel[];
    patterns: PatternOutcomeLabel[];
}

/** A side a level can be tested from; a `poc` level takes the side it sits on. */
export type LevelSide = 'support' | 'resistance';

// ---------------------------------------------------------------------------
// Internal shapes shared by the labelling modules (not exported from the entrypoints).
// ---------------------------------------------------------------------------

/** @internal One forward bar by name. */
export interface ForwardBar {
    readonly open: number;
    readonly high: number;
    readonly low: number;
    readonly close: number;
}

/** @internal The plan of an {@link OutcomeSubject}. */
export type OutcomePlanSubject = NonNullable<OutcomeSubject['plan']>;

/** @internal One detected pattern of an {@link OutcomeSubject}. */
export type OutcomePatternSubject = OutcomeSubject['patterns'][number];

/** @internal A plan that passed every `no_plan` check: all prices present and ordered. */
export interface EvaluablePlan {
    readonly low: number;
    readonly high: number;
    readonly stop: number;
    readonly targets: readonly number[];
}

/**
 * @internal
 * How the entry bar filled: `open` (it opened inside the zone), `from_above` (it opened
 * above and fell to the zone high) or `from_below` (it opened below and rose to the zone low).
 */
export type PlanFillVia = 'open' | 'from_above' | 'from_below';

/** @internal Result of looking for the bar that fills a plan. */
export type PlanEntry =
    | {
          readonly kind: 'filled';
          readonly offset: number;
          readonly fill: number;
          readonly via: PlanFillVia;
      }
    | {
          readonly kind: 'void';
          readonly offset: number;
          readonly reason: 'gap_below_stop' | 'gap_below_zone';
      };

/** @internal Where a plan stopped, with the price it exited at (`null` for `ambiguous`). */
export interface PlanResolution {
    readonly kind: 'target_first' | 'stop_first' | 'ambiguous';
    readonly offset: number;
    readonly price: number | null;
    readonly gap: boolean;
}

/** @internal The label of one level before its placebo is attached. */
export type LevelCore = Omit<LevelOutcomeLabel, 'placebo'>;

/** @internal What one bar of a touch does to a level. */
export type LevelBarEvent =
    { outcome: 'broken'; gap: boolean } | { outcome: 'respected' };

/** @internal Where a pattern broke out. */
export interface PatternBreakout {
    readonly alreadyBroken: boolean;
    /** Offset of the breakout bar; `0` when the reference price is already past the level. */
    readonly offset: number;
    /** Price the race starts from. */
    readonly start: number;
}

/** @internal How a pattern race ended. */
export type PatternRaceResult = Pick<
    PatternOutcomeLabel,
    'outcome' | 'resolveOffset' | 'gap'
>;
