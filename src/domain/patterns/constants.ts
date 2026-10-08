import type { Timeframe } from '@/domain/types';

// ─── Pivot extraction ───────────────────────────────────────────────────────

/**
 * @internal
 * Pivot confirmation threshold: minimum retracement from the running extreme,
 * expressed as a multiple of ATR, required to confirm a zigzag pivot. This is
 * the key to scale invariance — a fixed price/percent threshold would over-fire
 * on high-volatility names and under-fire on low-volatility ones, whereas an
 * ATR-relative threshold adapts to each symbol's/timeframe's own noise floor.
 */
export const PIVOT_REVERSAL_ATR_MULT = 1.5;

// ─── Screening window ───────────────────────────────────────────────────────

/**
 * @internal
 * Lookback window (bars) the screener scans for pattern candidates. Chosen to
 * stay comfortably inside `TIMEFRAME_BARS_LIMIT` (200~500 depending on
 * timeframe) so the screener never needs more history than the chart already
 * fetches.
 */
export const SCREEN_LOOKBACK_BARS = 120;

// ─── Head & Shoulders ───────────────────────────────────────────────────────

/**
 * @internal
 * H&S: maximum allowed height difference between the left and right shoulders,
 * expressed as a fraction of the head-to-neckline height. Real-world shoulders
 * are rarely perfectly level, so some slack is required — but too much slack
 * would match arbitrary 3-peak noise.
 */
export const HS_SHOULDER_TOLERANCE = 0.35;

/**
 * @internal
 * H&S: minimum amount (in ATR multiples) the head must exceed both shoulders
 * by. Guards against flagging a flat 3-peak cluster as a head & shoulders when
 * the "head" is not meaningfully more extreme than the shoulders.
 */
export const HS_HEAD_MIN_ATR = 1.0;

// ─── Double / triple tops & bottoms ─────────────────────────────────────────

/**
 * @internal
 * Double/triple top-bottom: maximum allowed price difference between repeated
 * extremes, expressed as a multiple of ATR. Extremes within this band are
 * treated as "the same level" for pattern-matching purposes.
 */
export const EXTREME_MATCH_ATR_MULT = 1.0;

// ─── Trendline-based patterns (triangles / wedges / channels / rectangle) ──

/**
 * @internal
 * Trendline family: the regression-slope threshold (as a fraction of ATR per
 * bar) below which a fitted trendline is considered "flat" rather than rising
 * or falling. Used to distinguish, e.g., a horizontal resistance line
 * (ascending triangle) from a descending one (symmetrical triangle/wedge).
 */
export const FLAT_SLOPE_ATR_PER_BAR = 0.05;

/**
 * @internal
 * Trendline family: number of most-recent pivots examined when fitting the
 * high/low trendlines. A fixed, small window keeps the fit focused on the
 * "what is on the chart right now" shape instead of averaging over pivots
 * far outside any plausible triangle/wedge/rectangle boundary.
 */
export const TRENDLINE_PIVOT_WINDOW = 8;

/**
 * @internal
 * Trendline family: maximum difference between the ATR-normalized high and
 * low slopes (ATR per bar) for a same-direction pair to count as parallel —
 * a channel rather than a wedge. A wedge must converge by more than this, so
 * a nearly parallel pair no longer reads as a wedge: the siglens wedge skill
 * already rejected those as channels ("convergence under 15% is a channel").
 */
export const CHANNEL_PARALLEL_ATR_PER_BAR = 0.02;

// ─── Flags / pennants ───────────────────────────────────────────────────────

/**
 * @internal
 * Flag/pennant: minimum size of the preceding "pole" move, expressed as a
 * multiple of ATR. A flag/pennant is only meaningful as a continuation pattern
 * after a sufficiently sharp directional move — small drifts should not
 * qualify as a pole.
 */
export const FLAG_POLE_MIN_ATR = 3.0;

/**
 * @internal
 * Flag/pennant: lookback window (bars), measured immediately before the
 * consolidation range, searched for the qualifying pole move. Bounds how far
 * back the screener looks for the sharp directional move a flag/pennant must
 * follow — a "pole" found further back is no longer connected to the current
 * consolidation.
 */
export const FLAG_POLE_LOOKBACK_BARS = 20;

/**
 * @internal
 * Flag/pennant: maximum length (bars) the consolidation range may span.
 * Flags/pennants are short-lived continuation pauses — a longer sideways
 * range is a different pattern (e.g. a rectangle), not a flag.
 */
export const FLAG_CONSOLIDATION_MAX_BARS = 30;

/**
 * @internal
 * Flag: maximum height of the consolidation channel, expressed as a multiple
 * of ATR. Keeps the "flag" tight and channel-like rather than matching any
 * broad, choppy sideways range after a pole move.
 */
export const FLAG_CHANNEL_MAX_RANGE_ATR = 3.0;

// ─── High tight flag ────────────────────────────────────────────────────────
// A bar-count approximation of Bulkowski's definition (a 90%+ rise within
// about two months, then a pause giving back no more than 20–25%). Daily bars
// are the only timeframe where a 90% run inside 40 bars is plausible, so on
// intraday charts the classifier effectively never fires.

/** @internal High tight flag: minimum pole rise, base low → pole high, as a fraction (0.9 = +90%). */
export const HTF_POLE_MIN_GAIN = 0.9;

/** @internal High tight flag: maximum bars from the pole's base low to its high. */
export const HTF_POLE_MAX_BARS = 40;

/** @internal High tight flag: maximum pullback below the pole high during the flag, as a fraction of that high. */
export const HTF_FLAG_MAX_RETRACE = 0.25;

/** @internal High tight flag: minimum bars after the pole high before the flag counts. */
export const HTF_FLAG_MIN_BARS = 3;

// ─── Cup & handle / rounding ────────────────────────────────────────────────

/**
 * @internal
 * Cup and handle: maximum allowed handle pullback depth, expressed as a
 * fraction of the cup's own depth. Loose on purpose (recall-biased) — a
 * handle that retraces up to half the cup's depth is still plausibly a
 * handle, not a fresh downtrend.
 */
export const CUP_HANDLE_MAX_DEPTH_RATIO = 0.5;

/**
 * @internal
 * Rounding bottom / top, cup & handle: lower bound (fraction of span) within
 * which the quadratic-fit vertex must fall to count as a genuine bottom (or
 * top) rather than an edge-hugging arc (a vertex right at the start of the
 * window is a partial curve, not a rounded shape).
 */
export const CURVATURE_VERTEX_MID_LO = 0.25;

/**
 * @internal
 * Rounding bottom / top, cup & handle: upper bound (fraction of span) within
 * which the quadratic-fit vertex must fall to count as a genuine bottom (or
 * top) rather than an edge-hugging arc (a vertex right at the end of the
 * window is a partial curve, not a rounded shape).
 */
export const CURVATURE_VERTEX_MID_HI = 0.75;

/**
 * @internal
 * Rounding bottom / top: minimum depth between the rim and the extreme of the
 * fitted pivots, as an ATR multiple, per the design doc's literal "2*atr"
 * rule — shallower curves are treated as noise rather than a meaningful
 * rounding formation.
 */
export const ROUNDING_MIN_DEPTH_ATR_MULT = 2;

// ─── Linear-algebra helpers ─────────────────────────────────────────────────

/**
 * @internal
 * `solve3x3`: determinant magnitude below which a 3x3 system is treated as
 * singular rather than exactly zero. A near-singular matrix implies an
 * unreliable/unstable fit (huge, noise-amplified coefficients), and rejecting
 * it here is recall-safe — a garbage fit would just get rejected by the
 * downstream shape checks anyway, so being slightly more conservative costs
 * nothing.
 */
export const SINGULAR_MATRIX_DET_EPSILON = 1e-9;

/**
 * @internal
 * Slack of the spent-pattern check (`isSpentPattern`), in ATR: a bar within
 * it of the measured target has fulfilled the pattern (and an undirected one
 * is spent a full height minus this beyond a boundary). Price reacts in a
 * zone, not at the exact computed level — the same scale as the Elliott spent
 * check. The invalidation level gets no slack (see `isSpentPattern`).
 */
export const PATTERN_SPENT_SLACK_ATR = 0.25;

// ─── Qualification (drawing) — spec 2026-10-07 ─────────────────────────────
// The pre-screener above stays loose (it only picks skill docs). Everything
// below gates what may be DRAWN and printed with numbers: `qualify/`.

/**
 * @internal
 * Containment slack ε, in ATR: a boundary is accepted only when no bar of the
 * pattern pokes through it by more than this (`high ≤ line + ε` for the upper
 * boundary, `low ≥ line − ε` for the lower one).
 */
export const BOUNDARY_CONTAINMENT_ATR = 0.25;

/** @internal Touch tolerance τ, in ATR: a point within this distance of a boundary touches it. */
export const BOUNDARY_TOUCH_ATR = 0.35;

/** @internal Touches each boundary needs (triangles, channels, rectangle, flag channels). */
export const BOUNDARY_MIN_TOUCHES = 2;

/** @internal Touches each wedge boundary needs (wedge skill docs: three per side). */
export const WEDGE_MIN_TOUCHES = 3;

/**
 * @internal
 * Touches each rectangle boundary needs. The spec's two per side is raised to
 * three: three flat highs over two flat lows is a triple top (and the mirror
 * a triple bottom), and with only two per side every such range would draw
 * as a rectangle over the reversal pattern it is.
 */
export const RECTANGLE_MIN_TOUCHES = 3;

/** @internal Broadening formation: total touches over both boundaries. */
export const BROADENING_MIN_TOTAL_TOUCHES = 5;

/** @internal Broadening formation: touches the better-touched boundary needs. */
export const BROADENING_MIN_SIDE_TOUCHES = 3;

/**
 * @internal
 * A boundary whose total move over the pattern span is at most
 * `min(FLAT_DRIFT_ATR·ATR, FLAT_DRIFT_PRICE_PCT·price)` is flat.
 */
export const FLAT_DRIFT_ATR = 0.75;

/** @internal See {@link FLAT_DRIFT_ATR}. */
export const FLAT_DRIFT_PRICE_PCT = 0.01;

/**
 * @internal
 * The rectangle's looser price share for "flat" (rectangle skill doc: slope
 * < 1.5%). It only ever decides a pair whose two lines both sit in the
 * general flat class or the dead band: a rising/falling line moves at least
 * `SLOPED_DRIFT_ATR`·ATR, beyond any flat bound (`FLAT_DRIFT_ATR`·ATR caps
 * it), so a pair with a sloped line is classified (or rejected) by the
 * triangle/wedge/channel rows first and never reaches the rectangle test.
 */
export const RECTANGLE_FLAT_DRIFT_PRICE_PCT = 0.015;

/**
 * @internal
 * A boundary moving at least this many ATR over the pattern span is rising or
 * falling. Between the flat bound and this one is a dead band where the
 * pattern is not drawn, so one pivot cannot flip a triangle into a wedge.
 */
export const SLOPED_DRIFT_ATR = 1.5;

/** @internal Triangles and wedges: end width at most this share of the start width. */
export const CONVERGING_MAX_WIDTH_RATIO = 0.7;

/** @internal Channels and flags: end-to-start width ratio lower bound (parallel). */
export const PARALLEL_MIN_WIDTH_RATIO = 0.85;

/** @internal Channels and flags: end-to-start width ratio upper bound (parallel). */
export const PARALLEL_MAX_WIDTH_RATIO = 1.15;

/** @internal Broadening formation: end width at least this multiple of the start width. */
export const BROADENING_MIN_WIDTH_RATIO = 1.3;

/**
 * @internal
 * Fewest confirmed pivots a boundary-pair window is tried with. Five, not
 * four: the two boundaries must interleave (each keeps two touches from the
 * other's first touch on), which alternating pivots only satisfy from five.
 */
export const TRENDLINE_MIN_WINDOW_PIVOTS = 5;

/**
 * @internal
 * Most confirmed pivots a boundary-pair window grows back to once a window
 * of at most `TRENDLINE_PIVOT_WINDOW` pivots qualifies. A maturing pattern
 * keeps its first touches as newer pivots confirm; the cap bounds the extra
 * fits (each O(k²·n)).
 */
export const TRENDLINE_MAX_WINDOW_PIVOTS = 16;

/** @internal Triangles, wedges, rectangles, channels, broadening formations: fewest bars spanned. */
export const LINE_PATTERN_MIN_BARS = 15;

/**
 * @internal
 * Head & shoulders: fewest bars from the left to the right shoulder. Fifteen,
 * not the spec's twenty: real daily H&S with clean, level shoulders span
 * 15–19 bars (a 17-bar inverse H&S in the 2026-10-08 recall diagnosis), and
 * the shoulder-match, shoulder-clearance, head-clearance, prior-trend and
 * height rules already keep a short noise cluster out. A triple top/bottom needs no span rule of its
 * own: two gaps of `EXTREME_MIN_GAP_BARS` make it at least 21 bars.
 */
export const HS_MIN_BARS = 15;

/** @internal Double/triple tops and bottoms: fewest bars between consecutive extremes. */
export const EXTREME_MIN_GAP_BARS = 10;

/**
 * @internal
 * Double top/bottom: the trough (peak) between the two extremes sits within
 * this share of the span from either extreme — in the middle half. A trough
 * two bars after the first peak followed by a slow climb to the second is a
 * rising leg, not two tops (2026-10-08 sweep, judged on real charts).
 */
export const DOUBLE_NECKLINE_EDGE_SHARE = 0.25;

/** @internal Double/triple: repeated extremes match within `min(EXTREME_MATCH_ATR_MULT·ATR, this·price)`. */
export const EXTREME_MATCH_MAX_PRICE_PCT = 0.03;

/** @internal Head & shoulders: the shoulders match within this share of price. */
export const HS_SHOULDER_MAX_PRICE_PCT = 0.05;

/**
 * @internal
 * Head & shoulders: each shoulder stands at least this many ATR on the
 * pattern's side of the neckline (above it for a top). A right "shoulder"
 * at or through the neckline is the breakdown already under way (2026-10-08
 * sweep: an H&S drawn with its right shoulder under the neckline), and a
 * left one a hair above its trough is a pause in the leg to the head.
 */
export const HS_SHOULDER_MIN_CLEARANCE_ATR = 1;

/**
 * @internal
 * Head & shoulders: confirmed pivots allowed after the right shoulder. The
 * pattern stays drawable while price works through the neckline break
 * instead of vanishing two legs later; the spent check retires it.
 */
export const HS_MAX_PIVOTS_AFTER_RIGHT_SHOULDER = 2;

/**
 * @internal
 * Recency: a double/triple's last extreme and a rounding base's right rim may
 * be at most `max(PATTERN_MAX_AGE_MIN_BARS, PATTERN_MAX_AGE_SPAN_SHARE ·
 * span)` bars before the last bar. The floor matches the handle and flag
 * windows (`HANDLE_MAX_BARS`, `FLAG_MAX_BARS`); the span share lets a long
 * base take proportionally longer to break out. Older patterns describe the
 * past even when price never reached their target or invalidation. Boundary
 * pairs, H&S, flags, cups and high tight flags are already bounded (they end
 * at the last confirmed pivots or within a fixed window).
 */
export const PATTERN_MAX_AGE_MIN_BARS = 20;

/** @internal See {@link PATTERN_MAX_AGE_MIN_BARS}. */
export const PATTERN_MAX_AGE_SPAN_SHARE = 0.5;

/** @internal Minimum pattern height, in ATR (the other floor is a share of price, by timeframe). */
export const PATTERN_MIN_HEIGHT_ATR = 2.5;

/**
 * @internal
 * Minimum pattern height as a share of price, by timeframe. A fixed 3% would
 * erase every intraday drawing: a 5-minute bar rarely spans a 3% range.
 */
export const PATTERN_MIN_HEIGHT_PRICE_PCT: Readonly<Record<Timeframe, number>> =
    {
        '5Min': 0.005,
        '15Min': 0.005,
        '30Min': 0.005,
        '1Hour': 0.01,
        '4Hour': 0.01,
        '1Day': 0.03,
    };

/** @internal Prior trend: bars before the pattern start whose close change sets the direction. */
export const PRIOR_TREND_BARS = 20;

/** @internal Prior trend: close change, in ATR, that counts as a trend. */
export const PRIOR_TREND_MIN_ATR = 2;

/** @internal Flag pole: most bars from the base pivot to the top pivot. */
export const FLAG_POLE_MAX_BARS = 20;

/** @internal Flag/pennant: fewest bars after the pole top. */
export const FLAG_MIN_BARS = 5;

/**
 * @internal
 * Flag/pennant: most bars from the pole top to the flag's last bar (the end
 * of the fitted channel — not the chart's last bar, so a flag that just
 * broke out is still drawn until it is spent or no longer recent).
 */
export const FLAG_MAX_BARS = 20;

/**
 * @internal
 * Flag/pennant: no flag bar goes beyond the pole's end (above a bull pole's
 * top, below a bear pole's bottom) by more than this many ATR. A
 * consolidation that rises over the pole top is a new leg, not a flag
 * (2026-10-08 sweep: a daily "pennant" whose channel ran past its pole).
 */
export const FLAG_MAX_BEYOND_POLE_ATR = 0.5;

/**
 * @internal
 * Flag/pennant: the channel is at most this share of the pole tall where
 * it starts. A flag is a tight pause after the pole; a channel half the
 * pole wide is a range of its own.
 */
export const FLAG_MAX_START_WIDTH_POLE_SHARE = 0.5;

/**
 * @internal
 * Flag/pennant: counted touches on one channel line are at least this many
 * bars apart. Two adjacent bars resting on one line are one test of it, not
 * two (2026-10-08 sweep: an intraday pennant whose "touches" were
 * neighbouring bars).
 */
export const FLAG_MIN_TOUCH_SPACING_BARS = 2;

/** @internal Flag/pennant: deepest pullback from the pole top, as a share of the pole. */
export const FLAG_MAX_RETRACE = 0.5;

/** @internal Rounding bottom / top: rims match within this share of price. */
export const RIM_MATCH_MAX_PRICE_PCT = 0.05;

/**
 * @internal
 * Cup & handle: rims match within this share of price — looser than
 * {@link RIM_MATCH_MAX_PRICE_PCT}. A cup's right rim often recovers short of
 * the left one before the handle forms; on a deep cup a 6% gap is still a
 * small share of the depth, and `CUP_RIM_MAX_DEPTH_SHARE` keeps a shallow
 * base with that gap out. The handle rules bound the rest. Rounding bases stay at 5%: there the
 * looser match turned a W-shaped base into a "rounding bottom".
 */
export const CUP_RIM_MATCH_MAX_PRICE_PCT = 0.07;

/**
 * @internal
 * Cup & handle and rounding: the two rims differ by at most this share of
 * the base's depth (the lower rim's height over the extreme), on top of the
 * price-share match. A staircase of rising highs — each one 5% over the
 * last on a shallow dip — passed the price-share rule alone and drew as a
 * "cup" (2026-10-08 real-chart sweep: 8 of 16 drawn cups and rounding bases
 * judged false). A cup's rims stand at about the same level relative to
 * its own depth.
 */
export const CUP_RIM_MAX_DEPTH_SHARE = 0.25;

/**
 * @internal
 * Cup & handle: the left rim must be the highest high of the bars before it,
 * over this share of the rim-to-rim span — a cup forms after an advance into
 * the left rim. Without it, a dip inside a falling market read as a cup.
 */
export const CUP_PRIOR_ADVANCE_SPAN_SHARE = 0.5;

/** @internal Cup & handle and rounding: fewest bars from rim to rim. */
export const CUP_MIN_BARS = 30;

/** @internal Cup & handle: fewest bars after the right rim. */
export const HANDLE_MIN_BARS = 5;

/** @internal Cup & handle: most bars after the right rim. */
export const HANDLE_MAX_BARS = 20;

/** @internal U check: the band next to the extreme, as a share of the depth. */
export const U_EXTREME_BAND = 1 / 3;

/**
 * @internal
 * U check: share of the closes between the rims that must sit in the band
 * next to the extreme. The spec's 25% does not reject a V: price on a
 * straight-sided V spends a third of its bars in the bottom third of the
 * depth, and a parabola about 58%. 0.4 sits between the two.
 */
export const U_EXTREME_MIN_SHARE = 0.4;

/** @internal Rounding: the quadratic fitted on the closes between the rims explains at least this share of their variance. */
export const ROUNDING_MIN_R2 = 0.6;

/** @internal Rounding: evenly spaced points of the drawn arc (the extreme's bar is added to them). */
export const ROUNDING_ARC_SAMPLES = 10;

/**
 * @internal
 * Arbitration: two qualified hits sharing at least this many confirmed pivots
 * overlap. One, not the spec's three: a swing that plays a role in two
 * patterns is counted twice when both are drawn — a head & shoulders' right
 * shoulder reused as a later double top's first peak touches the H&S span at
 * that one bar only, so neither the span rule nor a three-pivot rule caught it.
 */
export const ARBITRATION_MIN_SHARED_PIVOTS = 1;

/** @internal Arbitration: two qualified hits whose spans overlap by more than this share of the shorter one overlap. */
export const ARBITRATION_MAX_SPAN_OVERLAP = 0.5;
