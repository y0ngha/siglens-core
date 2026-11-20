/**
 * Outcome labelling constants. Every number here is part of a label definition: changing
 * any of them (or any rule in this directory) changes what a stored label means, so it
 * bumps `OUTCOME_LABEL_VERSION` and the consumer relabels from the stored subject and
 * window with no provider call.
 */

/**
 * Version of the label definitions in this directory. Stored next to every label so a
 * consumer can find the rows to recompute after a definition change.
 */
export const OUTCOME_LABEL_VERSION = 1;

/** Version of the `OutcomeSubject` shape written by `extractOutcomeSubject`. */
export const OUTCOME_SUBJECT_VERSION = 1;

/**
 * @internal
 * Forward bars every label looks at. Counted in **bars**, not days, on every timeframe:
 * bars already have session gaps removed, the reasoning of `PRIOR_ANALYSIS_WINDOW_BARS`.
 */
export const OUTCOME_WINDOW_BARS = 20;

/** @internal Closes before the anchor kept in a window: the baseline sample of the same symbol. */
export const OUTCOME_PRE_BARS = 60;

/** @internal Horizons (in bars) of the plain forward returns. */
export const OUTCOME_HORIZON_BARS: readonly number[] = [1, 5, 10, 20];

/** @internal A level closer than this to the reference price (in ATRs) is not a level to test. */
export const LEVEL_MIN_DISTANCE_ATR = 0.25;

/** @internal Distance past a level (in ATRs) that still counts as touching it. */
export const LEVEL_TOUCH_BAND_ATR = 0.1;

/** @internal A close beyond the level by this many ATRs resolves a touch (held or broken). */
export const LEVEL_BARRIER_ATR = 0.5;

/** @internal Bars from a touch (inclusive) in which the touch can resolve. */
export const LEVEL_FOLLOW_BARS = 10;

/** @internal Distance (in ATRs) a placebo level is moved from the real one. */
export const PLACEBO_SHIFT_ATR = 0.5;

/** @internal A close ratio this near 1 is rounding noise, not an adjustment. */
export const ADJ_FACTOR_EPSILON = 5e-4;

/**
 * @internal
 * Plausible range of a corporate-action adjustment factor; outside it the anchor is not
 * the analysed bar.
 */
export const ADJ_FACTOR_RANGE: readonly [min: number, max: number] = [0.02, 50];

/**
 * @internal
 * Loose band for the close ratio of an anchor bar that was still **forming** at analysis
 * time. The close seen then is not the final one, so an exact adjustment factor cannot be
 * measured and the factor stays 1; the band only catches a jump of price basis (a split)
 * that would otherwise be read as a price move. A small adjustment such as a ~0.6%
 * dividend stays inside the band and is not corrected for forming anchors.
 */
export const ANCHOR_FORMING_RANGE: readonly [min: number, max: number] = [
    0.67, 1.5,
];

/**
 * @internal
 * Tolerance for the close an analysis saw on a **forming** anchor bar against that bar's
 * final `[low, high]`: the seen close must lie inside the range widened by this fraction on
 * each side (`low × (1 − tol) ≤ close ≤ high × (1 + tol)`). A price outside it cannot have
 * been printed by this bar, which means a price-basis jump (a split) the loose
 * `ANCHOR_FORMING_RANGE` band is too wide to catch.
 */
export const ANCHOR_FORMING_REF_TOLERANCE = 0.01;

/** @internal Fewest samples a same-symbol baseline mean is reported from. */
export const BASELINE_MIN_SAMPLES = 20;
