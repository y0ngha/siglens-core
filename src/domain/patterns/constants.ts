// ─── Pivot extraction ───────────────────────────────────────────────────────

/**
 * Pivot confirmation threshold: minimum retracement from the running extreme,
 * expressed as a multiple of ATR, required to confirm a zigzag pivot. This is
 * the key to scale invariance — a fixed price/percent threshold would over-fire
 * on high-volatility names and under-fire on low-volatility ones, whereas an
 * ATR-relative threshold adapts to each symbol's/timeframe's own noise floor.
 */
export const PIVOT_REVERSAL_ATR_MULT = 1.5;

// ─── Screening window ───────────────────────────────────────────────────────

/**
 * Lookback window (bars) the screener scans for pattern candidates. Chosen to
 * stay comfortably inside `TIMEFRAME_BARS_LIMIT` (200~500 depending on
 * timeframe) so the screener never needs more history than the chart already
 * fetches.
 */
export const SCREEN_LOOKBACK_BARS = 120;

// ─── Head & Shoulders ───────────────────────────────────────────────────────

/**
 * H&S: maximum allowed height difference between the left and right shoulders,
 * expressed as a fraction of the head-to-neckline height. Real-world shoulders
 * are rarely perfectly level, so some slack is required — but too much slack
 * would match arbitrary 3-peak noise.
 */
export const HS_SHOULDER_TOLERANCE = 0.35;

/**
 * H&S: minimum amount (in ATR multiples) the head must exceed both shoulders
 * by. Guards against flagging a flat 3-peak cluster as a head & shoulders when
 * the "head" is not meaningfully more extreme than the shoulders.
 */
export const HS_HEAD_MIN_ATR = 1.0;

// ─── Double / triple tops & bottoms ─────────────────────────────────────────

/**
 * Double/triple top-bottom: maximum allowed price difference between repeated
 * extremes, expressed as a multiple of ATR. Extremes within this band are
 * treated as "the same level" for pattern-matching purposes.
 */
export const EXTREME_MATCH_ATR_MULT = 1.0;

// ─── Trendline-based patterns (triangles / wedges / rectangle) ─────────────

/**
 * Trendline family: the regression-slope threshold (as a fraction of ATR per
 * bar) below which a fitted trendline is considered "flat" rather than rising
 * or falling. Used to distinguish, e.g., a horizontal resistance line
 * (ascending triangle) from a descending one (symmetrical triangle/wedge).
 */
export const FLAT_SLOPE_ATR_PER_BAR = 0.05;

/**
 * Trendline family: number of most-recent pivots examined when fitting the
 * high/low trendlines. A fixed, small window keeps the fit focused on the
 * "what is on the chart right now" shape instead of averaging over pivots
 * far outside any plausible triangle/wedge/rectangle boundary.
 */
export const TRENDLINE_PIVOT_WINDOW = 8;

// ─── Flags / pennants ───────────────────────────────────────────────────────

/**
 * Flag/pennant: minimum size of the preceding "pole" move, expressed as a
 * multiple of ATR. A flag/pennant is only meaningful as a continuation pattern
 * after a sufficiently sharp directional move — small drifts should not
 * qualify as a pole.
 */
export const FLAG_POLE_MIN_ATR = 3.0;

/**
 * Flag/pennant: lookback window (bars), measured immediately before the
 * consolidation range, searched for the qualifying pole move. Bounds how far
 * back the screener looks for the sharp directional move a flag/pennant must
 * follow — a "pole" found further back is no longer connected to the current
 * consolidation.
 */
export const FLAG_POLE_LOOKBACK_BARS = 20;

/**
 * Flag/pennant: maximum length (bars) the consolidation range may span.
 * Flags/pennants are short-lived continuation pauses — a longer sideways
 * range is a different pattern (e.g. a rectangle), not a flag.
 */
export const FLAG_CONSOLIDATION_MAX_BARS = 30;

/**
 * Flag: maximum height of the consolidation channel, expressed as a multiple
 * of ATR. Keeps the "flag" tight and channel-like rather than matching any
 * broad, choppy sideways range after a pole move.
 */
export const FLAG_CHANNEL_MAX_RANGE_ATR = 3.0;

// ─── Cup & handle / rounding ────────────────────────────────────────────────

/**
 * Cup and handle: maximum allowed handle pullback depth, expressed as a
 * fraction of the cup's own depth. Loose on purpose (recall-biased) — a
 * handle that retraces up to half the cup's depth is still plausibly a
 * handle, not a fresh downtrend.
 */
export const CUP_HANDLE_MAX_DEPTH_RATIO = 0.5;
