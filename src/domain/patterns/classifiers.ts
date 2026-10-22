import type {
    Bar,
    ChartPatternId,
    PatternCandidate,
    PivotKind,
    PivotPoint,
} from '@/domain/types';
import {
    CHANNEL_PARALLEL_ATR_PER_BAR,
    CURVATURE_VERTEX_MID_HI,
    CURVATURE_VERTEX_MID_LO,
    CUP_HANDLE_MAX_DEPTH_RATIO,
    EXTREME_MATCH_ATR_MULT,
    FLAG_CHANNEL_MAX_RANGE_ATR,
    FLAG_CONSOLIDATION_MAX_BARS,
    FLAG_POLE_LOOKBACK_BARS,
    FLAG_POLE_MIN_ATR,
    FLAT_SLOPE_ATR_PER_BAR,
    HS_HEAD_MIN_ATR,
    HS_SHOULDER_TOLERANCE,
    HTF_FLAG_MAX_RETRACE,
    HTF_FLAG_MIN_BARS,
    HTF_POLE_MAX_BARS,
    HTF_POLE_MIN_GAIN,
    ROUNDING_MIN_DEPTH_ATR_MULT,
    SINGULAR_MATRIX_DET_EPSILON,
    TRENDLINE_PIVOT_WINDOW,
} from '@/domain/patterns/constants';

/** @internal An `(x, y)` sample for the least-squares fits below. */
export interface Point {
    x: number;
    y: number;
}

/**
 * Ordinary least-squares slope of `y` over `x`. Returns `0` for fewer than 2
 * points or a degenerate (zero-variance) `x` series — a flat/undefined slope
 * is the conservative (non-triggering) default for the trendline family.
 */
function leastSquaresSlope(points: readonly Point[]): number {
    const n = points.length;
    if (n < 2) return 0;

    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;
    for (const { x, y } of points) {
        sumX += x;
        sumY += y;
        sumXY += x * y;
        sumXX += x * x;
    }

    const denom = n * sumXX - sumX * sumX;
    if (denom === 0) return 0;
    return (n * sumXY - sumX * sumY) / denom;
}

type SlopeShape = 'flat' | 'rising' | 'falling';

/** Classifies an ATR-normalized slope as flat/rising/falling against `FLAT_SLOPE_ATR_PER_BAR`. */
function classifySlope(normalizedSlope: number): SlopeShape {
    if (Math.abs(normalizedSlope) <= FLAT_SLOPE_ATR_PER_BAR) return 'flat';
    return normalizedSlope > 0 ? 'rising' : 'falling';
}

/**
 * Fits independent least-squares trendlines through `highs`/`lows` and
 * classifies each slope as flat/rising/falling (ATR-normalized), alongside
 * the raw normalized slope values (needed to break ties between the two
 * "both rising"/"both falling" wedge shapes, which the flat/rising/falling
 * category alone can't distinguish). Shared by the trendline-pair family
 * (Group 3) and the flag/pennant channel check (Group 4) — both need this
 * exact "slope of the highs vs. slope of the lows" shape over a pivot
 * window.
 */
function classifyHighLowSlopes(
    highs: readonly PivotPoint[],
    lows: readonly PivotPoint[],
    atr: number
): { high: SlopeShape; low: SlopeShape; slopeHigh: number; slopeLow: number } {
    const slopeHigh =
        leastSquaresSlope(highs.map(p => ({ x: p.index, y: p.price }))) / atr;
    const slopeLow =
        leastSquaresSlope(lows.map(p => ({ x: p.index, y: p.price }))) / atr;
    return {
        high: classifySlope(slopeHigh),
        low: classifySlope(slopeLow),
        slopeHigh,
        slopeLow,
    };
}

/**
 * @internal
 * A pattern shape matcher — the pre-screener building block that turns
 * extracted pivots (+ the raw bars/ATR they came from) into zero or more
 * {@link PatternCandidate} hits.
 *
 * Recall-biased by design: this is a PRE-screener that selects which pattern
 * skill docs to inject into an AI prompt, not the final judge. A false
 * positive costs a few KB of wasted prompt; a false negative costs the AI
 * never seeing a relevant doc. When a rule is ambiguous, the looser
 * interpretation wins — so classifiers return `[]` only when the geometry
 * genuinely does not fit, never as a tie-breaker.
 *
 * Callers (the screening facade) are expected to pass pivots extracted with
 * `includeProvisional: true` so classifiers can see the still-forming
 * extreme at the right edge of the chart — patterns must be recognizable in
 * what is on the chart *now*, not merely somewhere in history.
 *
 * @param pivots - Confirmed (+ optionally provisional) pivots, ascending by
 * bar index, alternating high/low kind.
 * @param bars - The same OHLCV bars the pivots were extracted from.
 * @param atr - Average True Range for the same bars (scale reference).
 * @returns Zero or more candidates; some groups intentionally emit more than
 * one (e.g. a triple top also emits its trailing double top).
 */
export type PatternClassifier = (
    pivots: readonly PivotPoint[],
    bars: readonly Bar[],
    atr: number
) => PatternCandidate[];

// ─── Group 1: extreme matching (double/triple top-bottom) ─────────────────

/**
 * Builds the extreme-matching classifier shared by top/bottom variants.
 *
 * double: the last 2 same-kind pivots are within `EXTREME_MATCH_ATR_MULT *
 * atr` of each other AND at least one opposite-kind pivot lies strictly
 * between them (the neckline). triple: the last 3 same-kind pivots are
 * pairwise within tolerance with opposite-kind pivots interleaved between
 * each consecutive pair — and when a triple matches, its trailing pair
 * (which is exactly the double check on the same data) is emitted too, so a
 * triple always implies a double (recall-biased: both skill docs relevant).
 */
function extremeMatchClassifier(
    extremeKind: PivotKind,
    doubleId: ChartPatternId,
    tripleId: ChartPatternId
): PatternClassifier {
    return (pivots, _bars, atr) => {
        if (atr <= 0) return [];

        const same = pivots.filter(p => p.kind === extremeKind);
        const opposite = pivots.filter(p => p.kind !== extremeKind);
        if (same.length < 2) return [];

        const closeEnough = (a: PivotPoint, b: PivotPoint) =>
            Math.abs(a.price - b.price) <= EXTREME_MATCH_ATR_MULT * atr;
        const hasBetween = (a: PivotPoint, b: PivotPoint) =>
            opposite.some(o => o.index > a.index && o.index < b.index);

        const results: PatternCandidate[] = [];

        // The exact pivots between (and including) two same-kind extremes,
        // in original ascending order — both the extremes themselves and
        // every opposite-kind pivot the neckline is drawn from. Numeric
        // index bounds rather than array-position slicing: `same`/`opposite`
        // are separately-filtered views, not contiguous sub-arrays of `pivots`.
        const windowBetween = (a: PivotPoint, b: PivotPoint): PivotPoint[] =>
            pivots.filter(p => p.index >= a.index && p.index <= b.index);

        if (same.length >= 3) {
            const [p1, p2, p3] = same.slice(-3);
            if (
                closeEnough(p1, p2) &&
                closeEnough(p2, p3) &&
                closeEnough(p1, p3) &&
                hasBetween(p1, p2) &&
                hasBetween(p2, p3)
            ) {
                results.push({
                    id: tripleId,
                    startIndex: p1.index,
                    endIndex: p3.index,
                    pivots: windowBetween(p1, p3),
                });
            }
        }

        const [q1, q2] = same.slice(-2);
        if (closeEnough(q1, q2) && hasBetween(q1, q2)) {
            results.push({
                id: doubleId,
                startIndex: q1.index,
                endIndex: q2.index,
                pivots: windowBetween(q1, q2),
            });
        }

        return results;
    };
}

/** @internal double_top / triple_top over the most recent high pivots. */
export const classifyDoubleTripleTop: PatternClassifier =
    extremeMatchClassifier('high', 'double_top', 'triple_top');

/** @internal double_bottom / triple_bottom over the most recent low pivots. */
export const classifyDoubleTripleBottom: PatternClassifier =
    extremeMatchClassifier('low', 'double_bottom', 'triple_bottom');

// ─── Group 2: five-pivot head & shoulders ──────────────────────────────────

/**
 * Builds the 5-pivot H&S classifier shared by the regular (peaks = highs)
 * and inverse (peaks = lows) variants.
 *
 * Scans the last 5 pivots, and — to tolerate one extra pivot forming after
 * the right shoulder/foot — the 5 pivots ending one before that, for the
 * alternating [peak, trough, peak, trough, peak] sequence. Requires the head
 * to clear both shoulders by `HS_HEAD_MIN_ATR * atr` and the shoulders to be
 * level within `HS_SHOULDER_TOLERANCE` of the head-to-neckline height.
 */
function fivePivotHeadAndShouldersClassifier(
    peakKind: PivotKind,
    id: ChartPatternId
): PatternClassifier {
    const troughKind: PivotKind = peakKind === 'high' ? 'low' : 'high';

    return (pivots, _bars, atr) => {
        if (atr <= 0 || pivots.length < 5) return [];

        const windows: PivotPoint[][] = [pivots.slice(-5)];
        if (pivots.length >= 6) windows.push(pivots.slice(-6, -1));

        for (const window of windows) {
            if (window.length !== 5) continue;
            const [ls, m1, head, m2, rs] = window;
            const kindsOk =
                ls.kind === peakKind &&
                m1.kind === troughKind &&
                head.kind === peakKind &&
                m2.kind === troughKind &&
                rs.kind === peakKind;
            if (!kindsOk) continue;

            const neckline = (m1.price + m2.price) / 2;
            const headExtra =
                peakKind === 'high'
                    ? head.price - Math.max(ls.price, rs.price)
                    : Math.min(ls.price, rs.price) - head.price;
            if (headExtra < HS_HEAD_MIN_ATR * atr) continue;

            const height =
                peakKind === 'high'
                    ? head.price - neckline
                    : neckline - head.price;
            if (Math.abs(ls.price - rs.price) > HS_SHOULDER_TOLERANCE * height)
                continue;

            return [
                {
                    id,
                    startIndex: ls.index,
                    endIndex: rs.index,
                    pivots: window,
                },
            ];
        }

        return [];
    };
}

/** @internal head_and_shoulders — peaks on highs, neckline through the two lows. */
export const classifyHeadAndShoulders: PatternClassifier =
    fivePivotHeadAndShouldersClassifier('high', 'head_and_shoulders');

/** @internal inverse_head_and_shoulders — peaks on lows, neckline through the two highs. */
export const classifyInverseHeadAndShoulders: PatternClassifier =
    fivePivotHeadAndShouldersClassifier('low', 'inverse_head_and_shoulders');

// ─── Group 3: trendline pairs (triangles / wedges / channels / rectangle) ─

/**
 * Splits a same-direction trendline pair (both rising or both falling):
 * parallel within `CHANNEL_PARALLEL_ATR_PER_BAR` → channel, lows steeper than
 * highs by more than that → converging wedge, otherwise (diverging) neither.
 */
function sameDirectionPairShape(
    slopeHigh: number,
    slopeLow: number,
    channelId: ChartPatternId,
    wedgeId: ChartPatternId
): ChartPatternId | null {
    if (Math.abs(slopeHigh - slopeLow) <= CHANNEL_PARALLEL_ATR_PER_BAR)
        return channelId;
    if (slopeLow - slopeHigh > CHANNEL_PARALLEL_ATR_PER_BAR) return wedgeId;
    return null;
}

/**
 * @internal
 * Fits independent least-squares trendlines through the last
 * `TRENDLINE_PIVOT_WINDOW` pivots' highs and lows and classifies the pair by
 * the flat/rising/falling classification table. Emits at most one
 * candidate — the nine shapes are mutually exclusive by construction: the
 * slope categories pick the row, and within the both-rising / both-falling
 * rows the channel (parallel) and wedge (converging) conditions cannot both
 * hold.
 */
export const classifyTrendlinePatterns: PatternClassifier = (
    pivots,
    _bars,
    atr
) => {
    if (atr <= 0) return [];

    const window = pivots.slice(-TRENDLINE_PIVOT_WINDOW);
    const highs = window.filter(p => p.kind === 'high');
    const lows = window.filter(p => p.kind === 'low');
    if (highs.length < 2 || lows.length < 2) return [];

    const {
        high: cH,
        low: cL,
        slopeHigh: sH,
        slopeLow: sL,
    } = classifyHighLowSlopes(highs, lows, atr);

    let id: ChartPatternId | null = null;
    if (cH === 'flat' && cL === 'rising') id = 'ascending_triangle';
    else if (cH === 'falling' && cL === 'flat') id = 'descending_triangle';
    else if (cH === 'falling' && cL === 'rising') id = 'symmetrical_triangle';
    else if (cH === 'rising' && cL === 'falling') id = 'broadening_formation';
    else if (cH === 'rising' && cL === 'rising')
        id = sameDirectionPairShape(
            sH,
            sL,
            'ascending_channel',
            'ascending_wedge'
        );
    else if (cH === 'falling' && cL === 'falling')
        id = sameDirectionPairShape(
            sH,
            sL,
            'descending_channel',
            'descending_wedge'
        );
    else if (cH === 'flat' && cL === 'flat') id = 'rectangle';

    if (id === null) return [];
    return [
        {
            id,
            startIndex: window[0].index,
            endIndex: window[window.length - 1].index,
            pivots: window,
        },
    ];
};

/** Solves a 3x3 linear system `M·[a,b,c] = v` via Cramer's rule; `null` when singular. */
function solve3x3(
    m: readonly (readonly [number, number, number])[],
    v: readonly [number, number, number]
): [number, number, number] | null {
    const det3 = (rows: readonly (readonly [number, number, number])[]) =>
        rows[0][0] * (rows[1][1] * rows[2][2] - rows[1][2] * rows[2][1]) -
        rows[0][1] * (rows[1][0] * rows[2][2] - rows[1][2] * rows[2][0]) +
        rows[0][2] * (rows[1][0] * rows[2][1] - rows[1][1] * rows[2][0]);

    const determinant = det3(m);
    // Epsilon rather than exact-zero — see SINGULAR_MATRIX_DET_EPSILON JSDoc.
    if (Math.abs(determinant) < SINGULAR_MATRIX_DET_EPSILON) return null;

    const withColumn = (col: 0 | 1 | 2): [number, number, number][] =>
        m.map((row, i) => {
            // Cast exists because spreading a `readonly [number, number, number]`
            // widens to `number[]` (TS cannot track that a spread of a
            // fixed-length tuple preserves its length). Safe at runtime: `row`
            // is always exactly 3 elements (it is one of `m`'s rows, which are
            // themselves `readonly [number, number, number]`), so `[...row]`
            // always yields a length-3 array — the annotation just restores
            // the tuple type TS already guaranteed structurally.
            const replaced = [...row] as [number, number, number];
            replaced[col] = v[i];
            return replaced;
        });

    return [
        det3(withColumn(0)) / determinant,
        det3(withColumn(1)) / determinant,
        det3(withColumn(2)) / determinant,
    ];
}

/**
 * @internal
 * Least-squares quadratic fit `y = a*x^2 + b*x + c` via the normal
 * equations. `null` for fewer than 3 points or a singular system (e.g. all
 * points share the same `x`). Exported for the rounding qualifier
 * (`qualify/curves.ts`), which fits the closes between two rims.
 */
export function fitQuadratic(
    points: readonly Point[]
): { a: number; b: number; c: number } | null {
    if (points.length < 3) return null;

    const n = points.length;
    let s1 = 0;
    let s2 = 0;
    let s3 = 0;
    let s4 = 0;
    let t0 = 0;
    let t1 = 0;
    let t2 = 0;
    for (const { x, y } of points) {
        const x2 = x * x;
        s1 += x;
        s2 += x2;
        s3 += x2 * x;
        s4 += x2 * x2;
        t0 += y;
        t1 += x * y;
        t2 += x2 * y;
    }

    const solved = solve3x3(
        [
            [s4, s3, s2],
            [s3, s2, s1],
            [s2, s1, n],
        ],
        [t2, t1, t0]
    );
    if (!solved) return null;
    const [a, b, c] = solved;
    return { a, b, c };
}

// ─── Group 4: flags / pennant ───────────────────────────────────────────────

interface FlagContext {
    consolidationStartIndex: number;
    consolidationEndIndex: number;
    poleMove: number;
    consolidationBars: readonly Bar[];
    consolidationPivots: readonly PivotPoint[];
}

/**
 * Shared pole+consolidation geometry for the flag/pennant family.
 *
 * Consolidation = the bar range covered by the last `TRENDLINE_PIVOT_WINDOW`
 * pivots (bounded to `FLAG_CONSOLIDATION_MAX_BARS`). Pole = the
 * `FLAG_POLE_LOOKBACK_BARS` bars immediately before the consolidation start,
 * required to move at least `FLAG_POLE_MIN_ATR * atr`. Consolidation must
 * additionally stay inside a `FLAG_CHANNEL_MAX_RANGE_ATR * atr`-tall
 * high/low channel. Returns `null` when any of these fail — the geometry
 * doesn't support a flag/pennant at all, regardless of direction.
 */
function buildFlagContext(
    pivots: readonly PivotPoint[],
    bars: readonly Bar[],
    atr: number
): FlagContext | null {
    // Defensive: `bars.length < 2` is unreachable via legitimate call paths —
    // pivots are always extracted from these same bars (extractPivots itself
    // requires bars.length >= 2 to emit any pivot), so pivots.length >= 2
    // already implies bars.length >= 2. Kept in case a caller ever passes a
    // mismatched pivots/bars pair directly.
    if (atr <= 0 || pivots.length < 2 || bars.length < 2) return null;

    const window = pivots.slice(-TRENDLINE_PIVOT_WINDOW);
    // Defensive: pivots.length >= 2 is already guaranteed above and
    // TRENDLINE_PIVOT_WINDOW >= 2, so `slice(-TRENDLINE_PIVOT_WINDOW)` always
    // yields at least 2 elements — window.length < 2 cannot happen in
    // practice.
    if (window.length < 2) return null;

    const consolidationStartIndex = window[0].index;
    const consolidationEndIndex = window[window.length - 1].index;
    const consolidationLength =
        consolidationEndIndex - consolidationStartIndex + 1;
    // Defensive: pivots are strictly ascending by index (see extractPivots),
    // so with window.length >= 2, consolidationEndIndex is always strictly
    // greater than consolidationStartIndex — consolidationLength is always
    // >= 2 in practice. The `> FLAG_CONSOLIDATION_MAX_BARS` half below is the
    // real (reachable) rejection.
    if (
        consolidationLength < 2 ||
        consolidationLength > FLAG_CONSOLIDATION_MAX_BARS
    )
        return null;

    const poleStartIndex = Math.max(
        0,
        consolidationStartIndex - FLAG_POLE_LOOKBACK_BARS
    );
    if (poleStartIndex >= consolidationStartIndex) return null;

    const poleMove =
        bars[consolidationStartIndex].close - bars[poleStartIndex].close;
    if (Math.abs(poleMove) < FLAG_POLE_MIN_ATR * atr) return null;

    const consolidationBars = bars.slice(
        consolidationStartIndex,
        consolidationEndIndex + 1
    );
    // Defensive: consolidationLength >= 2 (see above) and, in legitimate call
    // paths, bars covers every index the pivots reference (pivots were
    // extracted from these same bars), so this slice is never empty.
    if (consolidationBars.length === 0) return null;
    const range =
        Math.max(...consolidationBars.map(b => b.high)) -
        Math.min(...consolidationBars.map(b => b.low));
    if (range > FLAG_CHANNEL_MAX_RANGE_ATR * atr) return null;

    return {
        consolidationStartIndex,
        consolidationEndIndex,
        poleMove,
        consolidationBars,
        consolidationPivots: window,
    };
}

/** Index of the first bar in `[from, to]` whose `pick` value beats every earlier one under `better`. */
function extremeIndex(
    bars: readonly Bar[],
    from: number,
    to: number,
    pick: (bar: Bar) => number,
    better: (candidate: number, best: number) => boolean
): number {
    let best = from;
    for (let i = from + 1; i <= to; i++) {
        if (better(pick(bars[i]), pick(bars[best]))) best = i;
    }
    return best;
}

/** @internal The two anchors of a high tight flag's pole. */
export interface HighTightFlagAnchors {
    base: PivotPoint;
    top: PivotPoint;
}

/**
 * @internal
 * High tight flag over the right edge of the chart, from bars alone (a
 * percentage rule — no pivots, no ATR).
 *
 * Pole top = the highest high among the last `FLAG_CONSOLIDATION_MAX_BARS + 1`
 * bars (the flag is a flag-length pause, not a base), followed by at least
 * `HTF_FLAG_MIN_BARS` bars and not exceeded by any bar in its own pole
 * lookback. Pole base = the lowest low within `HTF_POLE_MAX_BARS` bars before
 * the top; the top must stand at least `HTF_POLE_MIN_GAIN` above it. Flag =
 * every bar after the top, which may give back at most `HTF_FLAG_MAX_RETRACE`
 * of the top.
 *
 * Exported for the high-tight-flag qualifier (`qualify/flags.ts`), which applies
 * the same rule and then requires the top to be a confirmed pivot.
 *
 * @returns The pole's base (`low`) and top (`high`), or `null`.
 */
export function detectHighTightFlagAnchors(
    bars: readonly Bar[]
): HighTightFlagAnchors | null {
    const lastIndex = bars.length - 1;
    const peakIndex = extremeIndex(
        bars,
        Math.max(0, lastIndex - FLAG_CONSOLIDATION_MAX_BARS),
        lastIndex,
        bar => bar.high,
        (candidate, best) => candidate > best
    );
    if (lastIndex - peakIndex < HTF_FLAG_MIN_BARS) return null;

    const peakHigh = bars[peakIndex].high;
    const poleStart = Math.max(0, peakIndex - HTF_POLE_MAX_BARS);
    // A higher high earlier in the pole lookback means this bar is a lower
    // high inside a longer consolidation, not the top of a pole.
    if (bars.slice(poleStart, peakIndex).some(bar => bar.high > peakHigh))
        return null;

    const baseIndex = extremeIndex(
        bars,
        poleStart,
        peakIndex,
        bar => bar.low,
        (candidate, best) => candidate < best
    );
    const baseLow = bars[baseIndex].low;
    if (!(baseLow > 0) || (peakHigh - baseLow) / baseLow < HTF_POLE_MIN_GAIN)
        return null;

    const flagLow = Math.min(...bars.slice(peakIndex + 1).map(bar => bar.low));
    if ((peakHigh - flagLow) / peakHigh > HTF_FLAG_MAX_RETRACE) return null;

    return {
        base: { index: baseIndex, price: baseLow, kind: 'low' },
        top: { index: peakIndex, price: peakHigh, kind: 'high' },
    };
}

/**
 * {@link detectHighTightFlagAnchors} as a pre-screener candidate spanning
 * base to the last bar; the attached `pivots` are the two anchors.
 */
function detectHighTightFlag(bars: readonly Bar[]): PatternCandidate | null {
    const anchors = detectHighTightFlagAnchors(bars);
    if (anchors === null) return null;
    return {
        id: 'high_tight_flag',
        startIndex: anchors.base.index,
        endIndex: bars.length - 1,
        pivots: [anchors.base, anchors.top],
    };
}

/**
 * @internal
 * high_tight_flag / bull_flag / bear_flag / pennant.
 *
 * high_tight_flag is checked first and, when it matches, is the ONLY
 * candidate emitted — the same right-edge pause would otherwise also read as
 * a bull flag or pennant, and the high-tight-flag doc is the specific one
 * (the same way cup_and_handle replaces rounding_bottom).
 *
 * Otherwise, over the shared pole+consolidation geometry: not mutually
 * exclusive by construction (a flat, converging consolidation after an
 * up-pole can plausibly read as both a bull flag and a pennant) —
 * recall-biased, so both are emitted when both fit.
 *
 * bull_flag: up pole + consolidation closes drifting flat-or-down. bear_flag:
 * down pole + consolidation closes drifting flat-or-up (mirrored). pennant:
 * either-direction pole + converging high/low trendlines inside the
 * consolidation (reuses the Group-3 slope classification), with at least one
 * side actually sloping (both flat is a rectangle, not a pennant).
 */
export const classifyFlagsAndPennants: PatternClassifier = (
    pivots,
    bars,
    atr
) => {
    if (atr <= 0) return [];
    const highTightFlag = detectHighTightFlag(bars);
    if (highTightFlag) return [highTightFlag];

    const ctx = buildFlagContext(pivots, bars, atr);
    if (!ctx) return [];

    const results: PatternCandidate[] = [];
    const range = {
        startIndex: ctx.consolidationStartIndex,
        endIndex: ctx.consolidationEndIndex,
    };

    const closeSlope =
        leastSquaresSlope(
            ctx.consolidationBars.map((b, i) => ({
                x: ctx.consolidationStartIndex + i,
                y: b.close,
            }))
        ) / atr;

    if (ctx.poleMove > 0 && closeSlope <= FLAT_SLOPE_ATR_PER_BAR) {
        results.push({ id: 'bull_flag', ...range });
    }
    if (ctx.poleMove < 0 && closeSlope >= -FLAT_SLOPE_ATR_PER_BAR) {
        results.push({ id: 'bear_flag', ...range });
    }

    const highs = ctx.consolidationPivots.filter(p => p.kind === 'high');
    const lows = ctx.consolidationPivots.filter(p => p.kind === 'low');
    if (highs.length >= 2 && lows.length >= 2) {
        const { high: cH, low: cL } = classifyHighLowSlopes(highs, lows, atr);
        const highOk = cH === 'falling' || cH === 'flat';
        const lowOk = cL === 'rising' || cL === 'flat';
        const bothFlat = cH === 'flat' && cL === 'flat';
        if (highOk && lowOk && !bothFlat) {
            results.push({ id: 'pennant', ...range });
        }
    }

    return results;
};

// ─── Group 5: curvature (rounding bottom / top, cup & handle) ─────────────

interface RoundingFit {
    startIndex: number;
    endIndex: number;
    depth: number;
}

/** Which way the fitted arc must curve: a bottom is convex (U), a top concave (dome). */
type RoundingShape = 'bottom' | 'top';

/**
 * Fits a quadratic through the given pivots — low pivots for a bottom, high
 * pivots for a top — and checks the rounding shape conditions: convex
 * (`a > 0`) for a bottom or concave (`a < 0`) for a top, vertex within the
 * middle half of the index span, and rim-to-extreme depth of at least
 * `ROUNDING_MIN_DEPTH_ATR_MULT * atr`. `null` when fewer than 4 points or any
 * condition fails.
 */
function fitRounding(
    points: readonly PivotPoint[],
    atr: number,
    shape: RoundingShape
): RoundingFit | null {
    if (points.length < 4) return null;

    const fit = fitQuadratic(points.map(p => ({ x: p.index, y: p.price })));
    if (!fit || (shape === 'bottom' ? fit.a <= 0 : fit.a >= 0)) return null;

    const startIndex = points[0].index;
    const endIndex = points[points.length - 1].index;
    const span = endIndex - startIndex;
    // Defensive: pivots are strictly ascending by index and `points.length >= 4`
    // is already guarded above, so `span` is always > 0 in practice. Kept as
    // an explicit guard rather than an assumption baked into the division below.
    if (span <= 0) return null;

    const vertexX = -fit.b / (2 * fit.a);
    const lo = startIndex + span * CURVATURE_VERTEX_MID_LO;
    const hi = startIndex + span * CURVATURE_VERTEX_MID_HI;
    if (vertexX < lo || vertexX > hi) return null;

    // Symmetric for both shapes: the rim is the extreme opposite the vertex.
    const prices = points.map(p => p.price);
    const depth = Math.max(...prices) - Math.min(...prices);
    if (depth < ROUNDING_MIN_DEPTH_ATR_MULT * atr) return null;

    return { startIndex, endIndex, depth };
}

/**
 * rounding_bottom / cup_and_handle over the low pivots (>= 4 required,
 * including a provisional trailing low if the caller extracted pivots with
 * `includeProvisional: true`).
 *
 * When >= 5 lows are available, first tries cup_and_handle: fit the cup on
 * all lows except the last (the handle's low), then require the handle low
 * to stay in the cup's upper half — no deeper than
 * `CUP_HANDLE_MAX_DEPTH_RATIO * cup depth` below the highest cup low (the
 * cup-and-handle skill: the handle forms in the upper half of the cup). A
 * handle usually sits ABOVE the cup's last low, so the earlier rule that
 * required it to sit below that low rejected textbook cups. If that succeeds, ONLY cup_and_handle is emitted — the cup doc
 * already covers the base, so re-emitting rounding_bottom would be redundant,
 * not extra recall. Otherwise falls back to a plain rounding_bottom fit over
 * all the lows.
 */
function classifyRoundedBase(
    lows: readonly PivotPoint[],
    atr: number
): PatternCandidate[] {
    if (lows.length < 4) return [];

    if (lows.length >= 5) {
        const cupLows = lows.slice(0, -1);
        const handleLow = lows[lows.length - 1];
        const cup = fitRounding(cupLows, atr, 'bottom');
        if (cup) {
            const cupTop = Math.max(...cupLows.map(p => p.price));
            if (
                handleLow.price >=
                cupTop - CUP_HANDLE_MAX_DEPTH_RATIO * cup.depth
            ) {
                return [
                    {
                        id: 'cup_and_handle',
                        startIndex: cup.startIndex,
                        endIndex: handleLow.index,
                        pivots: lows,
                    },
                ];
            }
        }
    }

    const rounding = fitRounding(lows, atr, 'bottom');
    if (!rounding) return [];
    return [
        {
            id: 'rounding_bottom',
            startIndex: rounding.startIndex,
            endIndex: rounding.endIndex,
            pivots: lows,
        },
    ];
}

/**
 * @internal
 * Curvature group: rounding_bottom / cup_and_handle over the low pivots (see
 * `classifyRoundedBase`) plus rounding_top over the high pivots — the mirror
 * fit (concave dome, same vertex and depth rules). The two read disjoint
 * pivot sets, so a rounding_top is emitted independently of whatever the
 * lows produced.
 */
export const classifyCurvaturePatterns: PatternClassifier = (
    pivots,
    _bars,
    atr
) => {
    if (atr <= 0) return [];

    const base = classifyRoundedBase(
        pivots.filter(p => p.kind === 'low'),
        atr
    );
    const highs = pivots.filter(p => p.kind === 'high');
    const top = fitRounding(highs, atr, 'top');
    if (!top) return base;
    return [
        ...base,
        {
            id: 'rounding_top',
            startIndex: top.startIndex,
            endIndex: top.endIndex,
            pivots: highs,
        },
    ];
};

// ─── Facade ─────────────────────────────────────────────────────────────────

/**
 * @internal
 * All pattern classifiers, one entry per detection group. The screening
 * facade runs pivots (extracted with `includeProvisional: true`) through
 * every classifier here and flattens the results.
 */
export const CLASSIFIERS: readonly PatternClassifier[] = [
    classifyDoubleTripleTop,
    classifyDoubleTripleBottom,
    classifyHeadAndShoulders,
    classifyInverseHeadAndShoulders,
    classifyTrendlinePatterns,
    classifyFlagsAndPennants,
    classifyCurvaturePatterns,
];
