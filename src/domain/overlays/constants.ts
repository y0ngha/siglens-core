import type {
    ElliottStructure,
    OverlayKind,
    StrategyOverlayKind,
} from '@/domain/types';

// ─── Strategy slots ─────────────────────────────────────────────────────────
// Record<StrategyOverlayKind, true> makes the compiler reject a missing or an
// unknown kind, so adding a strategy kind to the union cannot silently leave
// the loader dropping it.
const STRATEGY_OVERLAY_KIND_FLAGS: Record<StrategyOverlayKind, true> = {
    divergence: true,
    fibonacci: true,
    elliott: true,
};
/**
 * The overlay kinds a strategy card may draw — the `overlay_kind` frontmatter
 * whitelist (core's loader, and consumers that parse skills themselves) and
 * the resolver's slot when no strategy skills are passed. Public so a
 * consumer's own skill loader/validator uses this list instead of a copy.
 */
// (a) Keys of STRATEGY_OVERLAY_KIND_FLAGS are exactly StrategyOverlayKind (the
// Record's exhaustive key type above). (b) Object.keys' generic-erased
// string[] return type is what forces this cast.
export const STRATEGY_OVERLAY_KINDS: readonly StrategyOverlayKind[] =
    Object.keys(STRATEGY_OVERLAY_KIND_FLAGS) as StrategyOverlayKind[];

/**
 * `ChartOverlay.sourceRef` of a strategy-kind drawing that no card of the
 * analysis owns: a Fibonacci leg, divergence or Elliott count the model cited
 * only from a card of another kind (or with no card of its kind in the
 * analysis). It is drawn under its kind — the way every trendline shares the
 * `'trendlines'` sourceRef — instead of under the citing card (a mislabel:
 * "Elliott wave" showing a Fibonacci ladder) or not at all. Consumers label
 * these with the kind's name. No card id can collide: card ids end in `_<n>`.
 */
export const STRATEGY_KIND_SOURCE_REF: Readonly<{
    [K in StrategyOverlayKind]: `kind:${K}`;
}> = {
    divergence: 'kind:divergence',
    fibonacci: 'kind:fibonacci',
    elliott: 'kind:elliott',
};

// ─── Candidate ids ──────────────────────────────────────────────────────────
/**
 * @internal
 * The prefix each overlay kind's candidate id starts with (`pattern:…`,
 * `tl:…`, `div:…`, `fib:…`, `ew:…`). The builders write these literals; the
 * overlay tests pin that every built id starts with its kind's prefix. Read
 * by {@link overlayKindOfId} — a pattern card citing a `tl:` id is citing a
 * trendline, not a pattern.
 */
export const OVERLAY_ID_PREFIX: Readonly<Record<OverlayKind, string>> = {
    pattern: 'pattern:',
    trendline: 'tl:',
    divergence: 'div:',
    fibonacci: 'fib:',
    elliott: 'ew:',
};

/** @internal The overlay kind a candidate id belongs to by its prefix, or `undefined` for any other string. */
export function overlayKindOfId(id: string): OverlayKind | undefined {
    // Keys of OVERLAY_ID_PREFIX are exactly OverlayKind (exhaustive Record);
    // Object.keys erases that to string[].
    return (Object.keys(OVERLAY_ID_PREFIX) as OverlayKind[]).find(kind =>
        id.startsWith(OVERLAY_ID_PREFIX[kind])
    );
}

// ─── Level labels ───────────────────────────────────────────────────────────
/**
 * `OverlayLevel.label` values core emits, so consumers localize them without
 * copying strings. A ratio-qualified target reads `target 161.8%` (an A–B–C's
 * C projections); a Fibonacci ladder's labels are its ratios and are not
 * listed here.
 */
export const OVERLAY_LEVEL_LABELS = {
    /** A pattern's neckline / boundary the breakout crosses. */
    breakout: 'breakout',
    /** Past this price the pattern or count is wrong. */
    invalidation: 'invalidation',
    /** The measured move / thrust target the structure projects. */
    target: 'target',
    /** A contracting diagonal's wave 5 must end inside this price. */
    wave5Cap: 'wave5_cap',
} as const;

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
/**
 * @internal Upper bound on elliott candidates in one prompt. 5 (was 3) leaves
 * room for the best count of each structure kind (spec 2026-10-02).
 */
export const ELLIOTT_CANDIDATE_LIMIT = 5;
/**
 * @internal At most this many candidates of one structure kind. Equal to the
 * pre-2026-10-02 total limit, so a chart where only impulse counts exist is
 * offered exactly the three it was offered before.
 */
export const ELLIOTT_PER_STRUCTURE_LIMIT = 3;
/**
 * @internal Structures offered to the model: only those passing the
 * synthetic gate (`scripts/elliottGate/run.ts`: recall ≥ 80% at noise 0.1 and
 * ≥ 60% at 0.25, random-walk false positives ≤ 5%, confusion ≤ 10%; checked
 * in CI by `elliottGate.test.ts`). `combination` and the standalone `abc`
 * are implemented but stay off — combinations are confused with overlapping
 * diagonals/triangles on 9–14% of samples, and random walks offer a
 * standalone A–B–C on ~100% of charts (2026-10-02 runs).
 */
export const ELLIOTT_ENABLED_STRUCTURES: readonly ElliottStructure[] = [
    'impulse',
    'diagonal',
    'triangle',
];
/** @internal Guideline band for wave 2's retracement of wave 1. */
export const EW_WAVE2_RETRACE_MIN = 0.382;
/** @internal Upper end of the scored wave-2 retracement band (see EW_WAVE2_RETRACE_MIN). */
export const EW_WAVE2_RETRACE_MAX = 0.786;
/** @internal Wave 3 at or beyond this multiple of wave 1 scores full marks. */
export const EW_WAVE3_EXTENSION = 1.618;
/** @internal Guideline band for wave 4's retracement of wave 3. */
export const EW_WAVE4_RETRACE_MIN = 0.236;
/** @internal Upper end of the scored wave-4 retracement band (see EW_WAVE4_RETRACE_MIN). */
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
/**
 * @internal Smallest in-progress impulse: 0–4 with wave 4 forming. A count
 * with only wave 3 forming (4 pivots) is any up-down-up swing and was offered
 * on most random walks, so it is no longer counted (2026-10-02 gate).
 */
export const EW_MIN_PARTIAL_PIVOTS = 5;
/**
 * @internal Hard bands (beyond the scored guideline bands above) for the
 * share of wave 1 that wave 2 retraces and of wave 3 that wave 4 retraces.
 * A forming wave 4 is only held to the upper bound.
 */
export const EW_WAVE2_RETRACE_LIMIT_MIN = 0.236;
/** @internal Hard upper bound of wave 2's retracement of wave 1. */
export const EW_WAVE2_RETRACE_LIMIT_MAX = 0.886;
/** @internal Hard lower bound of wave 4's retracement of wave 3 (not applied while wave 4 forms). */
export const EW_WAVE4_RETRACE_LIMIT_MIN = 0.146;
/** @internal Hard upper bound of wave 4's retracement of wave 3. */
export const EW_WAVE4_RETRACE_LIMIT_MAX = 0.618;
/**
 * @internal Every finished wave of an impulse or combination spans at least
 * this many ATR — a swing barely past the 1.5-ATR pivot reversal is noise at
 * the count's degree. A forming last wave is exempt. (In the synthetic gate
 * the templates' smallest legs are ~2.3–3 ATR, so the recall figures assume
 * waves of at least that size.)
 */
export const EW_MIN_WAVE_ATR = 2.5;
/**
 * @internal A correction corrects a trend: over the bars before its start
 * (as many as its first simple correction takes), its start is the extreme
 * and price came from at least this many times its first leg away.
 */
export const EW_PRIOR_TREND_MIN = 1;
/** @internal A prior trend this many times the first leg scores full marks. */
export const EW_PRIOR_TREND_FULL = 2;
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

// ─── Elliott A–B–C types (zigzag / flat) ────────────────────────────────────
/**
 * @internal B retracing at most this share of A makes a zigzag (with C past
 * A's end). 78.6% — the upper end of the textbook 38.2–78.6% band — rather
 * than 61.8%: pivots sit on wick extremes, which inflate a 50–60% B to 62–69%
 * on synthetic zigzags and failed most of them.
 */
export const EW_ZIGZAG_B_MAX = 0.786;
/** @internal B retracing at least this share of A makes a flat. */
export const EW_FLAT_B_MIN = 0.9;
/** @internal B retracing beyond this share of A has run past A's start (expanded / running flat). */
export const EW_FLAT_B_BEYOND_START = 1.05;
/** @internal B retracing beyond this share of A is no B wave — the move reversed. */
export const EW_ABC_B_MAX = 1.382;
/**
 * @internal Dead band, as a share of A, around A's end for C: past it by more
 * than this is "beyond A's end" (expanded), short of it by more is "short of
 * A's end" (running); inside it the flat type is not called.
 */
export const EW_FLAT_C_TOLERANCE = 0.1;
/** @internal A regular flat's C runs at most this share of A past A's end. */
export const EW_REGULAR_FLAT_C_MAX = 0.382;
/** @internal C/A ratios a correction's C commonly lands on (scored). */
export const EW_ABC_C_TARGETS = [0.618, 1, 1.618] as const;
/** @internal C/A ratios printed as C targets (projected from B) — the two most common of EW_ABC_C_TARGETS. */
export const EW_ABC_C_PROJECTIONS = [1, 1.618] as const;
/** @internal Decimals of the percentages in elliott prompt facts (`61.8%`). */
export const EW_RATIO_DECIMALS = 1;
/** @internal Decimals of an elliott candidate's `score` in its prompt line. */
export const EW_SCORE_DECIMALS = 2;
/** @internal C within this relative distance of a target ratio counts as a match. */
export const EW_ABC_C_TOLERANCE = 0.15;
/**
 * @internal A standalone A–B–C (no impulse before it) scores this fraction of
 * its raw score — it is the weaker hypothesis, so it starts below counts
 * anchored on an impulse.
 */
export const EW_STANDALONE_ABC_SCORE_FACTOR = 0.8;
/** @internal Pivot count of a standalone A–B–C (start, A, B, C). */
export const EW_ABC_STANDALONE_PIVOTS = 4;
/**
 * @internal Fewest pivots any elliott structure can use (a standalone A–B–C)
 * — the builder's early return. Not the impulse minimum: that would silently
 * drop a shorter structure once it is enabled. Each builder still checks
 * its own pivot count.
 */
export const EW_MIN_STRUCTURE_PIVOTS = EW_ABC_STANDALONE_PIVOTS;

/**
 * @internal Shortest / longest leg duration of a triangle or diagonal at
 * least this (a leg still forming at the right edge is left out): the legs of
 * these channel-bound shapes take comparable time, where random swings that
 * happen to fit the price rules mix 3-bar and 20-bar legs. The strongest
 * single filter against random-walk false positives in the synthetic gate.
 */
export const EW_TIME_BALANCE_MIN = 1 / 3;

// ─── Elliott triangles ──────────────────────────────────────────────────────
/** @internal Pivot count of a complete triangle (start, A–E ends). */
export const EW_TRIANGLE_PIVOTS = 6;
/** @internal Smallest in-progress triangle: start + A–D with D forming. */
export const EW_TRIANGLE_MIN_PIVOTS = 5;
/**
 * @internal A leg may be this much longer (share of the previous leg) and
 * still count as contracting — a flat (barrier) boundary's equal touches.
 */
export const EW_TRI_LEG_TOLERANCE = 0.05;
/** @internal E may end this many ATR beyond the A–C boundary line. */
export const EW_TRI_E_OVERSHOOT = 1;
/**
 * @internal Pivots after a complete triangle's E that mark its thrust as
 * over (the thrust's end, then a turn): its target is no longer projected.
 */
export const EW_TRI_THRUST_DONE_PIVOTS = 2;
/**
 * @internal A contracting triangle moves sideways: each leg retraces at least
 * this share of the leg before it.
 */
export const EW_TRI_LEG_RATIO_MIN = 0.5;
/** @internal E covers at least this share of the way from D's end to the A–C line. */
export const EW_TRI_E_MIN_REACH = 0.6;
/**
 * @internal Wave A starts outside the triangle: its start lies beyond the B–D
 * line extended back, give or take this many ATR.
 */
export const EW_TRI_A_START_TOLERANCE_ATR = 0.5;

// ─── Elliott diagonals ──────────────────────────────────────────────────────
/** @internal Wave may be this much longer (share of the earlier wave) and still count as contracting. */
export const EW_DIAG_WAVE_TOLERANCE = 0.05;
/** @internal Diagonal waves 2 and 4 typically retrace this band of the prior wave. */
export const EW_DIAG_RETRACE_MIN = 0.5;
/** @internal Upper end of the scored diagonal wave 2/4 retracement band (see EW_DIAG_RETRACE_MIN). */
export const EW_DIAG_RETRACE_MAX = 0.886;
/**
 * @internal The swing before the count must differ from wave 0 by at least
 * this many ATR to call a prior trend (ending vs leading diagonal); less is
 * reported as "leading or ending".
 */
export const EW_DIAG_TREND_MIN_ATR = 1;
/**
 * @internal The wedge holds its ends: wave 0 lies within this share of wave 1
 * of the 2–4 line extended back, and a complete wave 5 ends within it of the
 * 1–3 line (a throw-over or a slight shortfall). A forming wave 5 is only
 * checked for running too far past the line.
 */
export const EW_DIAG_LINE_TOLERANCE = 0.2;
/**
 * @internal
 * Slack of the spent-count check (`isSpentCount`), in ATR: an invalidation
 * is passed only by more than this, and a target counts as reached within
 * it. Price reacts in a zone, not at the exact computed price, and the count's
 * own pivots are bar extremes picked at 1.5 ATR sensitivity — a wick a few
 * ticks past a level is noise. Same scale as TRENDLINE_TOUCH_ATR_MULT.
 */
export const EW_SPENT_SLACK_ATR = 0.25;

// ─── Elliott combinations ───────────────────────────────────────────────────
/** @internal Pivots per simple correction in a combination (start, a, b, c). */
export const EW_COMBO_SIMPLE_PIVOTS = 4;
/** @internal X retraces less than this share of the preceding simple's net move. */
export const EW_COMBO_X_MAX_RETRACE = 1;
/** @internal Preferred X retracement band (scored, not required). */
export const EW_COMBO_X_PREFERRED_MIN = 0.382;
/** @internal Upper end of the preferred X retracement band (see EW_COMBO_X_PREFERRED_MIN). */
export const EW_COMBO_X_PREFERRED_MAX = 0.786;
/** @internal Y (and Z) net move as a multiple of W's. */
export const EW_COMBO_Y_TO_W_MIN = 0.618;
/** @internal Most Y (and Z) may run, as a multiple of W (see EW_COMBO_Y_TO_W_MIN). */
export const EW_COMBO_Y_TO_W_MAX = 1.618;
