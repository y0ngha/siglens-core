// ─── Trendlines ─────────────────────────────────────────────────────────────
/** @internal A same-kind pivot within this many ATR of the line counts as a touch. */
export const TRENDLINE_TOUCH_ATR_MULT = 0.25;
/** @internal A close beyond the line by more than this many ATR counts as a break bar. */
export const TRENDLINE_BREAK_ATR_MULT = 0.5;
/** @internal Break bars at or above this count invalidate the line. */
export const TRENDLINE_MAX_BREAK_BARS = 2;
/** @internal Best lines kept per side (support / resistance). */
export const TRENDLINE_CANDIDATES_PER_SIDE = 3;

// ─── Fibonacci ──────────────────────────────────────────────────────────────
/**
 * @internal Retracement + extension ratios drawn. 1.0 is left off — the 100%
 * extension equals the leg's end anchor, a duplicate line. 2.0/2.618 are left
 * off — they sit far off-chart.
 */
export const FIB_OVERLAY_RATIOS = [
    0.236, 0.382, 0.5, 0.618, 0.786, 1.272, 1.618,
] as const;
/** @internal ABC projections draw only the near extensions. */
export const FIB_ABC_OVERLAY_RATIOS = [1.0, 1.272, 1.618] as const;
/** @internal Upper bound on fibonacci candidates in one prompt. */
export const FIB_CANDIDATE_LIMIT = 4;

// ─── Elliott ────────────────────────────────────────────────────────────────
/** @internal Upper bound on elliott candidates in one prompt. */
export const ELLIOTT_CANDIDATE_LIMIT = 3;
/** @internal Guideline band for wave 2's retracement of wave 1. */
export const EW_WAVE2_RETRACE_MIN = 0.382;
export const EW_WAVE2_RETRACE_MAX = 0.786;
/** @internal Wave 3 at or beyond this multiple of wave 1 scores full marks. */
export const EW_WAVE3_EXTENSION = 1.618;
/** @internal Guideline band for wave 4's retracement of wave 3. */
export const EW_WAVE4_RETRACE_MIN = 0.236;
export const EW_WAVE4_RETRACE_MAX = 0.5;
/** @internal Wave 5 within this relative distance of a target ratio counts as a match. */
export const EW_WAVE5_TOLERANCE = 0.2;
/** @internal Wave 5 target as a fraction of the 0→3 span. */
export const EW_WAVE5_OF_ZERO_TO_THREE = 0.618;
/** @internal Minimum |retrace2 − retrace4| to count as alternation. */
export const EW_ALTERNATION_MIN_DIFF = 0.15;
/** @internal Neutral score for a guideline that cannot be judged yet (wave not formed). */
export const EW_UNJUDGED_SCORE = 0.5;
/** @internal Bonus when wave C runs past wave A's end. */
export const EW_ABC_C_BEYOND_A_BONUS = 0.1;
/** @internal Pivot count of a complete impulse (0–5). */
export const EW_IMPULSE_PIVOTS = 6;
/** @internal Smallest in-progress impulse: 0–3 with wave 3 forming. */
export const EW_MIN_PARTIAL_PIVOTS = 4;
/** @internal Pivots after wave 5 that close an A–B–C correction. */
export const EW_ABC_PIVOTS = 3;
/**
 * @internal Minimum bars between consecutive wave pivots. The zigzag can mark a
 * wide bar's high AND low as pivots on the same index — a zero-length "wave"
 * that is noise, not structure, and cannot be drawn as a line.
 */
export const EW_MIN_WAVE_BARS = 2;
/** @internal Minimum bars from wave 0 to the count's last pivot; shorter counts are sub-degree noise. */
export const EW_MIN_IMPULSE_SPAN_BARS = 10;
