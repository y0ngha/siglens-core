import type { Bar } from '@/domain/types';
import type {
    ChartPatternId,
    PatternCandidate,
    PivotPoint,
} from '@/domain/patterns/types';
import {
    CUP_HANDLE_MAX_DEPTH_RATIO,
    EXTREME_MATCH_ATR_MULT,
    FLAG_CHANNEL_MAX_RANGE_ATR,
    FLAG_CONSOLIDATION_MAX_BARS,
    FLAG_POLE_LOOKBACK_BARS,
    FLAG_POLE_MIN_ATR,
    FLAT_SLOPE_ATR_PER_BAR,
    HS_HEAD_MIN_ATR,
    HS_SHOULDER_TOLERANCE,
    TRENDLINE_PIVOT_WINDOW,
} from '@/domain/patterns/constants';

interface Point {
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
 * Callers (the Task-1.4 facade) are expected to pass pivots extracted with
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
    extremeKind: 'high' | 'low',
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
                });
            }
        }

        const [q1, q2] = same.slice(-2);
        if (closeEnough(q1, q2) && hasBetween(q1, q2)) {
            results.push({
                id: doubleId,
                startIndex: q1.index,
                endIndex: q2.index,
            });
        }

        return results;
    };
}

/** double_top / triple_top over the most recent high pivots. */
export const classifyDoubleTripleTop: PatternClassifier =
    extremeMatchClassifier('high', 'double_top', 'triple_top');

/** double_bottom / triple_bottom over the most recent low pivots. */
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
    peakKind: 'high' | 'low',
    id: ChartPatternId
): PatternClassifier {
    const troughKind: 'high' | 'low' = peakKind === 'high' ? 'low' : 'high';

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

            return [{ id, startIndex: ls.index, endIndex: rs.index }];
        }

        return [];
    };
}

/** head_and_shoulders — peaks on highs, neckline through the two lows. */
export const classifyHeadAndShoulders: PatternClassifier =
    fivePivotHeadAndShouldersClassifier('high', 'head_and_shoulders');

/** inverse_head_and_shoulders — peaks on lows, neckline through the two highs. */
export const classifyInverseHeadAndShoulders: PatternClassifier =
    fivePivotHeadAndShouldersClassifier('low', 'inverse_head_and_shoulders');

// ─── Group 3: trendline pairs (triangles / wedges / rectangle) ────────────

/**
 * Fits independent least-squares trendlines through the last
 * `TRENDLINE_PIVOT_WINDOW` pivots' highs and lows and classifies the pair by
 * the flat/rising/falling table in the design doc. Emits at most one
 * candidate — the six shapes are mutually exclusive by construction.
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

    const sH =
        leastSquaresSlope(highs.map(p => ({ x: p.index, y: p.price }))) / atr;
    const sL =
        leastSquaresSlope(lows.map(p => ({ x: p.index, y: p.price }))) / atr;
    const cH = classifySlope(sH);
    const cL = classifySlope(sL);

    let id: ChartPatternId | null = null;
    if (cH === 'flat' && cL === 'rising') id = 'ascending_triangle';
    else if (cH === 'falling' && cL === 'flat') id = 'descending_triangle';
    else if (cH === 'falling' && cL === 'rising') id = 'symmetrical_triangle';
    else if (cH === 'rising' && cL === 'rising' && sL > sH)
        id = 'ascending_wedge';
    else if (cH === 'falling' && cL === 'falling' && sH < sL)
        id = 'descending_wedge';
    else if (cH === 'flat' && cL === 'flat') id = 'rectangle';

    if (id === null) return [];
    return [
        {
            id,
            startIndex: window[0].index,
            endIndex: window[window.length - 1].index,
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
    if (determinant === 0) return null;

    const withColumn = (col: 0 | 1 | 2): [number, number, number][] =>
        m.map((row, i) => {
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
 * Least-squares quadratic fit `y = a*x^2 + b*x + c` via the normal
 * equations. `null` for fewer than 3 points or a singular system (e.g. all
 * points share the same `x`).
 */
function fitQuadratic(
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
    if (atr <= 0 || pivots.length < 2 || bars.length < 2) return null;

    const window = pivots.slice(-TRENDLINE_PIVOT_WINDOW);
    if (window.length < 2) return null;

    const consolidationStartIndex = window[0].index;
    const consolidationEndIndex = window[window.length - 1].index;
    const consolidationLength =
        consolidationEndIndex - consolidationStartIndex + 1;
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

/**
 * bull_flag / bear_flag / pennant over the shared pole+consolidation
 * geometry. Not mutually exclusive by construction (a flat, converging
 * consolidation after an up-pole can plausibly read as both a bull flag and
 * a pennant) — recall-biased, so both are emitted when both fit.
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
        const sH =
            leastSquaresSlope(highs.map(p => ({ x: p.index, y: p.price }))) /
            atr;
        const sL =
            leastSquaresSlope(lows.map(p => ({ x: p.index, y: p.price }))) /
            atr;
        const cH = classifySlope(sH);
        const cL = classifySlope(sL);
        const highOk = cH === 'falling' || cH === 'flat';
        const lowOk = cL === 'rising' || cL === 'flat';
        const bothFlat = cH === 'flat' && cL === 'flat';
        if (highOk && lowOk && !bothFlat) {
            results.push({ id: 'pennant', ...range });
        }
    }

    return results;
};

// ─── Group 5: curvature (rounding bottom, cup & handle) ───────────────────

/** Quadratic-fit vertex must sit within this fraction range of the [start,end] index span to count as a genuine "bottom", not an edge-hugging arc. */
const CURVATURE_VERTEX_MID_LO = 0.25;
const CURVATURE_VERTEX_MID_HI = 0.75;

/** Minimum cup depth (rim - bottom), as an ATR multiple, per the design doc's literal "2*atr" rule. */
const ROUNDING_BOTTOM_MIN_DEPTH_ATR_MULT = 2;

interface RoundingFit {
    startIndex: number;
    endIndex: number;
    depth: number;
}

/**
 * Fits a convex (`a > 0`) quadratic through the given low pivots and checks
 * the rounding-bottom shape conditions: vertex within the middle half of the
 * index span, and rim-to-bottom depth of at least
 * `ROUNDING_BOTTOM_MIN_DEPTH_ATR_MULT * atr`. `null` when fewer than 4
 * points or any condition fails.
 */
function fitRoundingBottom(
    points: readonly PivotPoint[],
    atr: number
): RoundingFit | null {
    if (points.length < 4) return null;

    const fit = fitQuadratic(points.map(p => ({ x: p.index, y: p.price })));
    if (!fit || fit.a <= 0) return null;

    const startIndex = points[0].index;
    const endIndex = points[points.length - 1].index;
    const span = endIndex - startIndex;
    if (span <= 0) return null;

    const vertexX = -fit.b / (2 * fit.a);
    const lo = startIndex + span * CURVATURE_VERTEX_MID_LO;
    const hi = startIndex + span * CURVATURE_VERTEX_MID_HI;
    if (vertexX < lo || vertexX > hi) return null;

    const prices = points.map(p => p.price);
    const rim = Math.max(...prices);
    const bottom = Math.min(...prices);
    const depth = rim - bottom;
    if (depth < ROUNDING_BOTTOM_MIN_DEPTH_ATR_MULT * atr) return null;

    return { startIndex, endIndex, depth };
}

/**
 * rounding_bottom / cup_and_handle over the low pivots (>= 4 required,
 * including a provisional trailing low if the caller extracted pivots with
 * `includeProvisional: true`).
 *
 * When >= 5 lows are available, first tries cup_and_handle: fit the cup on
 * all lows except the last (the handle's low), then require the pullback
 * from the cup's right-edge low down to the handle low to be shallow
 * (`<= CUP_HANDLE_MAX_DEPTH_RATIO * cup depth`) and downward. If that
 * succeeds, ONLY cup_and_handle is emitted — the cup doc already covers the
 * base, so re-emitting rounding_bottom would be redundant, not extra recall.
 * Otherwise falls back to a plain rounding_bottom fit over all the lows.
 */
export const classifyCurvaturePatterns: PatternClassifier = (
    pivots,
    _bars,
    atr
) => {
    if (atr <= 0) return [];

    const lows = pivots.filter(p => p.kind === 'low');
    if (lows.length < 4) return [];

    if (lows.length >= 5) {
        const cupLows = lows.slice(0, -1);
        const handleLow = lows[lows.length - 1];
        const cup = fitRoundingBottom(cupLows, atr);
        if (cup) {
            const rimPrice = cupLows[cupLows.length - 1].price;
            const handleDepth = rimPrice - handleLow.price;
            if (
                handleDepth > 0 &&
                handleDepth <= CUP_HANDLE_MAX_DEPTH_RATIO * cup.depth
            ) {
                return [
                    {
                        id: 'cup_and_handle',
                        startIndex: cup.startIndex,
                        endIndex: handleLow.index,
                    },
                ];
            }
        }
    }

    const rounding = fitRoundingBottom(lows, atr);
    if (!rounding) return [];
    return [
        {
            id: 'rounding_bottom',
            startIndex: rounding.startIndex,
            endIndex: rounding.endIndex,
        },
    ];
};

// ─── Facade ─────────────────────────────────────────────────────────────────

/**
 * All pattern classifiers, one entry per detection group. The Task-1.4
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
