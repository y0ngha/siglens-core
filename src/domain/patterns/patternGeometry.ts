import type {
    Bar,
    PatternBreakoutDirection,
    PatternCandidate,
    PatternGeometry,
    PatternKeyPoint,
    PivotKind,
    PivotPoint,
} from '@/domain/types';
import { leastSquaresSlope } from '@/domain/patterns/classifiers';
import { FLAG_POLE_LOOKBACK_BARS } from '@/domain/patterns/constants';

/**
 * @internal
 * Deterministic measured-move geometry for one pre-screener
 * {@link PatternCandidate} (spec 2026-09-18 §A1) — the numbers the siglens
 * pattern skills used to ask the model to compute itself.
 *
 * Design: rather than threading geometry through each classifier's RETURN
 * SHAPE (which would force every existing classifier test to assert an
 * extra field), `classifiers.ts` additively attaches the exact `pivots` it
 * matched to each `PatternCandidate` — this module computes geometry
 * directly from those, never by re-extracting pivots over
 * `[startIndex, endIndex]` (re-extraction could reconstruct a DIFFERENT
 * pivot set than the one the classifier actually matched, e.g. a
 * different ATR-relative zigzag threshold interaction at the window edge —
 * this was a real defect on real data: a screener-flagged double_bottom/
 * double_top/head_and_shoulders regularly re-derived to nothing and
 * rendered six `N/A` fields even though the classifier had a specific
 * pivot set in hand). `candidate.pivots` absent (a hand-built candidate,
 * e.g. a test fixture) is the only remaining `null` case — the caller
 * renders one `geometry unavailable` line rather than six `N/A` fields.
 */

const HALF = 0.5;

/** @internal One named price anchor, with its bar's date pulled from `bars`. */
function point(
    label: string,
    index: number,
    price: number,
    bars: readonly Bar[]
): PatternKeyPoint {
    return { label, price, index, time: bars[index].time };
}

/** @internal Value of the OLS line through `points` (`{index,price}`), evaluated at bar index `x`. */
export function evaluateTrendlineAt(
    points: readonly PivotPoint[],
    x: number
): number {
    const n = points.length;
    const xMean = points.reduce((sum, p) => sum + p.index, 0) / n;
    const yMean = points.reduce((sum, p) => sum + p.price, 0) / n;
    const slope = leastSquaresSlope(
        points.map(p => ({ x: p.index, y: p.price }))
    );
    return yMean + slope * (x - xMean);
}

// ─── Extreme-match family: double/triple top/bottom ────────────────────────

function extremeMatchGeometry(
    candidate: PatternCandidate,
    bars: readonly Bar[]
): PatternGeometry | null {
    const isTop =
        candidate.id === 'double_top' || candidate.id === 'triple_top';
    const isTriple =
        candidate.id === 'triple_top' || candidate.id === 'triple_bottom';
    const sameKind: PivotKind = isTop ? 'high' : 'low';

    const pivots = candidate.pivots ?? [];
    const same = pivots.filter(p => p.kind === sameKind);
    const needed = isTriple ? 3 : 2;
    if (same.length < needed) return null;
    const chosen = same.slice(-needed);

    const opposite = pivots.filter(
        p =>
            p.kind !== sameKind &&
            p.index > chosen[0].index &&
            p.index < chosen[chosen.length - 1].index
    );
    if (opposite.length === 0) return null;

    const necklinePrice = isTop
        ? Math.min(...opposite.map(o => o.price))
        : Math.max(...opposite.map(o => o.price));
    const necklinePoint = opposite.find(o => o.price === necklinePrice)!;

    const peakAvg = chosen.reduce((sum, p) => sum + p.price, 0) / chosen.length;
    const height = isTop ? peakAvg - necklinePrice : necklinePrice - peakAvg;
    if (!Number.isFinite(height) || height <= 0) return null;

    const direction: PatternBreakoutDirection = isTop ? 'down' : 'up';
    const breakoutLevel = necklinePrice;
    const measuredTarget = isTop
        ? necklinePrice - height
        : necklinePrice + height;
    const conservativeTarget = isTop
        ? necklinePrice - height * HALF
        : necklinePrice + height * HALF;
    const invalidationLevel = isTop
        ? Math.max(...chosen.map(p => p.price))
        : Math.min(...chosen.map(p => p.price));

    const keyPoints = [
        ...chosen.map((p, i) =>
            point(
                isTop ? `peak ${i + 1}` : `trough ${i + 1}`,
                p.index,
                p.price,
                bars
            )
        ),
        point('neckline', necklinePoint.index, necklinePrice, bars),
    ];

    return {
        keyPoints,
        breakoutLevel,
        height,
        measuredTarget,
        conservativeTarget,
        invalidationLevel,
        direction,
    };
}

// ─── Head & shoulders family ────────────────────────────────────────────────

function headAndShouldersGeometry(
    candidate: PatternCandidate,
    bars: readonly Bar[]
): PatternGeometry | null {
    const isRegular = candidate.id === 'head_and_shoulders';
    const peakKind: PivotKind = isRegular ? 'high' : 'low';
    const troughKind: PivotKind = isRegular ? 'low' : 'high';

    const match = candidate.pivots;
    if (
        !match ||
        match.length !== 5 ||
        match[0].kind !== peakKind ||
        match[1].kind !== troughKind ||
        match[2].kind !== peakKind ||
        match[3].kind !== troughKind ||
        match[4].kind !== peakKind
    ) {
        return null;
    }
    const [ls, m1, head, m2, rs] = match;

    const neckline = (m1.price + m2.price) / 2;
    const height = isRegular ? head.price - neckline : neckline - head.price;
    if (!Number.isFinite(height) || height <= 0) return null;

    const direction: PatternBreakoutDirection = isRegular ? 'down' : 'up';
    const measuredTarget = isRegular ? neckline - height : neckline + height;
    const conservativeTarget = isRegular
        ? neckline - height * HALF
        : neckline + height * HALF;

    return {
        keyPoints: [
            point('left shoulder', ls.index, ls.price, bars),
            point('left trough', m1.index, m1.price, bars),
            point('head', head.index, head.price, bars),
            point('right trough', m2.index, m2.price, bars),
            point('right shoulder', rs.index, rs.price, bars),
            point('neckline', m2.index, neckline, bars),
        ],
        breakoutLevel: neckline,
        height,
        measuredTarget,
        conservativeTarget,
        invalidationLevel: rs.price,
        direction,
    };
}

// ─── Trendline-pair family: triangles / wedges / channels / rectangle ─────

function trendlineGeometry(
    candidate: PatternCandidate,
    bars: readonly Bar[]
): PatternGeometry | null {
    const pivots = candidate.pivots ?? [];
    const highs = pivots.filter(p => p.kind === 'high');
    const lows = pivots.filter(p => p.kind === 'low');
    if (highs.length < 2 || lows.length < 2) return null;

    const lastIndex = bars.length - 1;
    const lastClose = bars[lastIndex].close;
    // Breakout/invalidation lines are read at the last bar. A converging
    // pattern formed weeks ago can be past its apex by now (the lines have
    // crossed), where "the line at the last bar" no longer bounds anything —
    // fall back to the pattern's own last pivot, where both lines still hold.
    const linesOpenAt = (x: number): boolean =>
        evaluateTrendlineAt(highs, x) > evaluateTrendlineAt(lows, x);
    const lineX = linesOpenAt(lastIndex) ? lastIndex : candidate.endIndex;
    const resistanceAtLast = evaluateTrendlineAt(highs, lineX);
    const supportAtLast = evaluateTrendlineAt(lows, lineX);
    if (!(resistanceAtLast > supportAtLast)) return null;
    // Textbook measured move for triangles/wedges/rectangles is the height at
    // the pattern's widest point — its start, where the lines are furthest
    // apart for a converging pattern (and equal everywhere for a rectangle or
    // channel). The gap at the last bar is the narrowest point and would
    // understate it. A broadening formation diverges, so its widest point is
    // the other end: the line read point itself.
    const widestX =
        candidate.id === 'broadening_formation'
            ? lineX
            : Math.min(...pivots.map(p => p.index));
    const widestHeight =
        evaluateTrendlineAt(highs, widestX) -
        evaluateTrendlineAt(lows, widestX);

    let direction: PatternBreakoutDirection;
    switch (candidate.id) {
        case 'ascending_triangle':
            direction = 'up';
            break;
        case 'descending_triangle':
            direction = 'down';
            break;
        case 'ascending_wedge':
            direction = 'down';
            break;
        case 'descending_wedge':
            direction = 'up';
            break;
        default:
            // rectangle / symmetrical_triangle / ascending_channel /
            // descending_channel / broadening_formation: textbook direction
            // is genuinely undetermined until the break — bias toward the
            // side price sits closer to right now.
            direction =
                lastClose - supportAtLast >= resistanceAtLast - lastClose
                    ? 'up'
                    : 'down';
    }

    const height = widestHeight;
    if (!Number.isFinite(height) || height <= 0) return null;

    const breakoutLevel = direction === 'up' ? resistanceAtLast : supportAtLast;
    const invalidationLevel =
        direction === 'up' ? supportAtLast : resistanceAtLast;
    const measuredTarget =
        direction === 'up' ? breakoutLevel + height : breakoutLevel - height;
    const conservativeTarget =
        direction === 'up'
            ? breakoutLevel + height * HALF
            : breakoutLevel - height * HALF;

    return {
        keyPoints: [
            ...highs.map((p, i) =>
                point(`resistance touch ${i + 1}`, p.index, p.price, bars)
            ),
            ...lows.map((p, i) =>
                point(`support touch ${i + 1}`, p.index, p.price, bars)
            ),
        ],
        breakoutLevel,
        height,
        measuredTarget,
        conservativeTarget,
        invalidationLevel,
        direction,
    };
}

// ─── Flag / pennant family ──────────────────────────────────────────────────

function flagGeometry(
    candidate: PatternCandidate,
    bars: readonly Bar[]
): PatternGeometry | null {
    const consolidationStartIndex = candidate.startIndex;
    const consolidationEndIndex = candidate.endIndex;
    const poleStartIndex = Math.max(
        0,
        consolidationStartIndex - FLAG_POLE_LOOKBACK_BARS
    );
    if (poleStartIndex >= consolidationStartIndex) return null;

    const poleMove =
        bars[consolidationStartIndex].close - bars[poleStartIndex].close;
    const consolidationBars = bars.slice(
        consolidationStartIndex,
        consolidationEndIndex + 1
    );
    if (consolidationBars.length === 0) return null;

    const highs = consolidationBars.map(b => b.high);
    const lows = consolidationBars.map(b => b.low);
    const upperChannel = Math.max(...highs);
    const lowerChannel = Math.min(...lows);
    const upperIndex = consolidationStartIndex + highs.indexOf(upperChannel);
    const lowerIndex = consolidationStartIndex + lows.indexOf(lowerChannel);

    const direction: PatternBreakoutDirection =
        candidate.id === 'bull_flag'
            ? 'up'
            : candidate.id === 'bear_flag'
              ? 'down'
              : poleMove >= 0
                ? 'up'
                : 'down'; // pennant: pole direction decides

    const height = Math.abs(poleMove);
    if (!Number.isFinite(height) || height <= 0) return null;

    const breakoutLevel = direction === 'up' ? upperChannel : lowerChannel;
    const invalidationLevel = direction === 'up' ? lowerChannel : upperChannel;
    const measuredTarget =
        direction === 'up' ? breakoutLevel + height : breakoutLevel - height;
    const conservativeTarget =
        direction === 'up'
            ? breakoutLevel + height * HALF
            : breakoutLevel - height * HALF;

    return {
        keyPoints: [
            point(
                'flagpole base',
                poleStartIndex,
                bars[poleStartIndex].close,
                bars
            ),
            point(
                direction === 'up' ? 'flagpole top' : 'flagpole bottom',
                consolidationStartIndex,
                bars[consolidationStartIndex].close,
                bars
            ),
            point('flag upper channel', upperIndex, upperChannel, bars),
            point('flag lower channel', lowerIndex, lowerChannel, bars),
        ],
        breakoutLevel,
        height,
        measuredTarget,
        conservativeTarget,
        invalidationLevel,
        direction,
    };
}

/**
 * High tight flag — the bull_flag rule on the pole the classifier matched:
 * breakout at the pole top (the flag's upper edge), invalidation at the flag
 * low, height = pole top − pole base, so the printed extreme level is the
 * pole base itself. Reads the base/top anchors from `candidate.pivots`; the
 * pole can be up to `HTF_POLE_MAX_BARS` long, so it cannot be re-derived from
 * `FLAG_POLE_LOOKBACK_BARS` the way `flagGeometry` does for bull_flag.
 */
function highTightFlagGeometry(
    candidate: PatternCandidate,
    bars: readonly Bar[]
): PatternGeometry | null {
    const base = candidate.pivots?.find(p => p.kind === 'low');
    const top = candidate.pivots?.find(p => p.kind === 'high');
    if (!base || !top || top.index >= candidate.endIndex) return null;

    const flagLows = bars
        .slice(top.index + 1, candidate.endIndex + 1)
        .map(bar => bar.low);
    const flagLow = Math.min(...flagLows);
    const flagLowIndex = top.index + 1 + flagLows.indexOf(flagLow);

    const height = top.price - base.price;
    if (!Number.isFinite(height) || height <= 0) return null;

    return {
        keyPoints: [
            point('flagpole base', base.index, base.price, bars),
            point('flagpole top', top.index, top.price, bars),
            point('flag lower channel', flagLowIndex, flagLow, bars),
        ],
        breakoutLevel: top.price,
        height,
        measuredTarget: top.price + height,
        conservativeTarget: top.price + height * HALF,
        invalidationLevel: flagLow,
        direction: 'up',
    };
}

// ─── Curvature family: rounding bottom / cup & handle ──────────────────────

function curvatureGeometry(
    candidate: PatternCandidate,
    bars: readonly Bar[]
): PatternGeometry | null {
    const isCupHandle = candidate.id === 'cup_and_handle';
    const pivots = candidate.pivots ?? [];
    const lows = pivots.filter(p => p.kind === 'low');
    if (lows.length < (isCupHandle ? 2 : 1)) return null;

    const handleLow = isCupHandle ? lows[lows.length - 1] : null;
    const cupLows = isCupHandle ? lows.slice(0, -1) : lows;
    if (cupLows.length === 0) return null;

    const bottomPrice = Math.min(...cupLows.map(p => p.price));
    const bottomPoint = cupLows.find(p => p.price === bottomPrice)!;

    // The rim (lip) is the swing HIGH bounding the cup, not the highest of the
    // low pivots the classifier matched (it only attaches lows): read the
    // highest bar high across the pattern span — from the first cup low to the
    // handle low (cup & handle) or to the pattern's end (rounding bottom) —
    // so the breakout level is a price that actually printed on the chart.
    const spanStart = cupLows[0].index;
    const spanEnd = handleLow ? handleLow.index : candidate.endIndex;
    const rim = bars
        .slice(spanStart, spanEnd + 1)
        .map((bar, offset) => ({ index: spanStart + offset, price: bar.high }))
        .filter(p => Number.isFinite(p.price) && p.price > 0)
        .reduce<{ index: number; price: number } | null>(
            (best, p) => (best === null || p.price > best.price ? p : best),
            null
        );
    if (rim === null) return null;
    const rimPrice = rim.price;
    const depth = rimPrice - bottomPrice;
    if (!Number.isFinite(depth) || depth <= 0) return null;

    return {
        keyPoints: [
            point('rim', rim.index, rimPrice, bars),
            point('bottom', bottomPoint.index, bottomPoint.price, bars),
            ...(handleLow
                ? [point('handle low', handleLow.index, handleLow.price, bars)]
                : []),
        ],
        breakoutLevel: rimPrice,
        height: depth,
        measuredTarget: rimPrice + depth,
        conservativeTarget: rimPrice + depth * HALF,
        invalidationLevel: handleLow ? handleLow.price : bottomPrice,
        direction: 'up',
    };
}

/**
 * Rounding top — `curvatureGeometry`'s rounding_bottom rule mirrored: the rim
 * is the swing LOW bounding the dome (the lowest bar low from the first high
 * pivot to the pattern end), the top is the highest matched high pivot,
 * breakout is the rim, direction down, invalidation at the top.
 */
function roundingTopGeometry(
    candidate: PatternCandidate,
    bars: readonly Bar[]
): PatternGeometry | null {
    const highs = (candidate.pivots ?? []).filter(p => p.kind === 'high');
    if (highs.length === 0) return null;

    const topPrice = Math.max(...highs.map(p => p.price));
    const topPoint = highs.find(p => p.price === topPrice)!;

    const spanStart = highs[0].index;
    const rim = bars
        .slice(spanStart, candidate.endIndex + 1)
        .map((bar, offset) => ({ index: spanStart + offset, price: bar.low }))
        .filter(p => Number.isFinite(p.price) && p.price > 0)
        .reduce<{ index: number; price: number } | null>(
            (best, p) => (best === null || p.price < best.price ? p : best),
            null
        );
    if (rim === null) return null;
    const depth = topPrice - rim.price;
    if (!Number.isFinite(depth) || depth <= 0) return null;

    return {
        keyPoints: [
            point('rim', rim.index, rim.price, bars),
            point('top', topPoint.index, topPoint.price, bars),
        ],
        breakoutLevel: rim.price,
        height: depth,
        measuredTarget: rim.price - depth,
        conservativeTarget: rim.price - depth * HALF,
        invalidationLevel: topPrice,
        direction: 'down',
    };
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────

/**
 * Computes deterministic measured-move geometry for one pre-screener
 * candidate, directly from the pivots `classifiers.ts` matched
 * (`candidate.pivots`). `null` when `atr`/bounds are invalid or
 * `candidate.pivots` is absent/doesn't support the pattern's shape —
 * callers render a single `geometry unavailable` line rather than dropping
 * the candidate.
 *
 * @param candidate - A hit from `screenChartPatterns`, already rebased to
 *   `bars`' own indices.
 * @param bars - The full bar series the candidate came from (oldest-first).
 * @param atr - Average True Range for `bars` (must be finite and > 0) — the
 *   same validity guard `screenChartPatterns` itself applies.
 */
export function computeCandidateGeometry(
    candidate: PatternCandidate,
    bars: readonly Bar[],
    atr: number
): PatternGeometry | null {
    if (!Number.isFinite(atr) || atr <= 0) return null;
    if (
        candidate.startIndex < 0 ||
        candidate.endIndex >= bars.length ||
        candidate.startIndex > candidate.endIndex
    ) {
        return null;
    }

    try {
        switch (candidate.id) {
            case 'double_top':
            case 'triple_top':
            case 'double_bottom':
            case 'triple_bottom':
                return extremeMatchGeometry(candidate, bars);
            case 'head_and_shoulders':
            case 'inverse_head_and_shoulders':
                return headAndShouldersGeometry(candidate, bars);
            case 'ascending_triangle':
            case 'descending_triangle':
            case 'symmetrical_triangle':
            case 'ascending_wedge':
            case 'descending_wedge':
            case 'ascending_channel':
            case 'descending_channel':
            case 'broadening_formation':
            case 'rectangle':
                return trendlineGeometry(candidate, bars);
            case 'bull_flag':
            case 'bear_flag':
            case 'pennant':
                return flagGeometry(candidate, bars);
            case 'high_tight_flag':
                return highTightFlagGeometry(candidate, bars);
            case 'cup_and_handle':
            case 'rounding_bottom':
                return curvatureGeometry(candidate, bars);
            case 'rounding_top':
                return roundingTopGeometry(candidate, bars);
        }
    } catch {
        return null;
    }
}
