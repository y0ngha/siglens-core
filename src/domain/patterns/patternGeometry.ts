import type {
    Bar,
    CupPatternShape,
    ExtremePatternShape,
    FlagPatternShape,
    HeadAndShouldersPatternShape,
    HighTightFlagPatternShape,
    PatternBreakoutDirection,
    PatternGeometry,
    PatternKeyPoint,
    PatternPoint,
    QualifiedPattern,
    QualifiedPatternGeometry,
    RoundingPatternShape,
    TrendlinePatternShape,
} from '@/domain/types';
import { lineValueAt, trendlineHeight } from '@/domain/patterns/boundaryLines';

/**
 * @internal
 * Deterministic measured-move geometry for one QUALIFIED pattern — the numbers the siglens
 * pattern skills used to ask the model to compute itself.
 *
 * Every level comes from the fixed inputs `qualifyPatterns` attached
 * (`pattern.shape`): confirmed pivots and boundaries through touches, never
 * the still-forming extreme or a regression line. Only a breakout read off a
 * sloped boundary (triangle, wedge, channel, flag, neckline) moves with the
 * last bar; invalidation levels are pivot prices and stay put.
 */

const HALF = 0.5;

/** One named price anchor, with its bar's date pulled from `bars`. */
function point(
    label: string,
    at: PatternPoint,
    bars: readonly Bar[]
): PatternKeyPoint {
    return {
        label,
        price: at.price,
        index: at.index,
        time: bars[at.index].time,
    };
}

/**
 * The directed geometry every family ends in: targets are breakout ± height
 * (and half of it), and the invalidation carries the bar index it applies
 * from. `null` for a height that is not a positive number.
 */
function measuredMove(
    keyPoints: PatternKeyPoint[],
    breakoutLevel: number,
    height: number,
    direction: PatternBreakoutDirection,
    invalidation: PatternPoint
): PatternGeometry | null {
    if (!Number.isFinite(height) || height <= 0) return null;
    const sign = direction === 'up' ? 1 : -1;
    return {
        keyPoints,
        breakoutLevel,
        height,
        measuredTarget: breakoutLevel + sign * height,
        conservativeTarget: breakoutLevel + sign * height * HALF,
        invalidationLevel: invalidation.price,
        invalidationIndex: invalidation.index,
        direction,
    };
}

// ─── Double / triple tops and bottoms ───────────────────────────────────────

function extremeGeometry(
    pattern: QualifiedPattern,
    shape: ExtremePatternShape,
    bars: readonly Bar[]
): PatternGeometry | null {
    // The neckline sits on the opposite kind of the extremes.
    const isTop = shape.neckline.kind === 'low';
    const extremes = pattern.pivots.filter(p => p.kind !== shape.neckline.kind);
    const average =
        extremes.reduce((sum, p) => sum + p.price, 0) / extremes.length;
    const invalidation = extremes.reduce((best, p) =>
        isTop
            ? p.price > best.price
                ? p
                : best
            : p.price < best.price
              ? p
              : best
    );
    return measuredMove(
        [
            ...extremes.map((p, i) =>
                point(isTop ? `peak ${i + 1}` : `trough ${i + 1}`, p, bars)
            ),
            point('neckline', shape.neckline, bars),
        ],
        shape.neckline.price,
        Math.abs(average - shape.neckline.price),
        isTop ? 'down' : 'up',
        invalidation
    );
}

// ─── Head & shoulders ───────────────────────────────────────────────────────

/**
 * Breakout, height and status all read the SLOPED neckline: breakout
 * is the neckline at the break bar (or the last bar before a break), height
 * is the head's distance from the neckline at the head's own bar.
 */
function headAndShouldersGeometry(
    pattern: QualifiedPattern,
    shape: HeadAndShouldersPatternShape,
    bars: readonly Bar[]
): PatternGeometry | null {
    const [ls, m1, head, m2, rs] = pattern.pivots;
    const isRegular = head.kind === 'high';
    const breakout = lineValueAt(shape.neckline, shape.breakoutIndex);
    return measuredMove(
        [
            point('left shoulder', ls, bars),
            point('left trough', m1, bars),
            point('head', head, bars),
            point('right trough', m2, bars),
            point('right shoulder', rs, bars),
            point(
                'neckline',
                { index: shape.breakoutIndex, price: breakout },
                bars
            ),
        ],
        breakout,
        Math.abs(head.price - lineValueAt(shape.neckline, head.index)),
        isRegular ? 'down' : 'up',
        rs
    );
}

// ─── Triangles / wedges / channels / rectangle / broadening ────────────────

/**
 * Boundary pairs: the breakout side's boundary read at the last bar, the opposite
 * boundary's last touch as the invalidation, and the fixed
 * {@link trendlineHeight}. `null` once the boundaries have crossed at the
 * last bar — a pattern past its apex has nothing left to break out of.
 */
function trendlineGeometry(
    shape: TrendlinePatternShape,
    bars: readonly Bar[],
    id: QualifiedPattern['id']
): QualifiedPatternGeometry | null {
    const lastIndex = bars.length - 1;
    const upperLevel = lineValueAt(shape.upper, lastIndex);
    const lowerLevel = lineValueAt(shape.lower, lastIndex);
    if (!(upperLevel > lowerLevel)) return null;
    const keyPoints = [
        ...shape.upper.touches.map((p, i) =>
            point(`resistance touch ${i + 1}`, p, bars)
        ),
        ...shape.lower.touches.map((p, i) =>
            point(`support touch ${i + 1}`, p, bars)
        ),
    ];
    const height = trendlineHeight(id, shape.upper, shape.lower);
    if (shape.direction === null) {
        return { keyPoints, height, upperLevel, lowerLevel, direction: null };
    }
    const up = shape.direction === 'up';
    const opposite = up ? shape.lower : shape.upper;
    return measuredMove(
        keyPoints,
        up ? upperLevel : lowerLevel,
        height,
        shape.direction,
        opposite.touches[opposite.touches.length - 1]
    );
}

// ─── Flags and pennants ─────────────────────────────────────────────────────

/** Breakout = the breakout-side channel line at the last bar; height = the pole. */
function flagGeometry(
    pattern: QualifiedPattern,
    shape: FlagPatternShape,
    bars: readonly Bar[]
): PatternGeometry | null {
    const up = shape.direction === 'up';
    const lastIndex = bars.length - 1;
    const channelPoint = (line: FlagPatternShape['upper']): PatternPoint => ({
        index: pattern.endIndex,
        price: lineValueAt(line, pattern.endIndex),
    });
    return measuredMove(
        [
            point('flagpole base', shape.poleBase, bars),
            point(up ? 'flagpole top' : 'flagpole bottom', shape.poleTop, bars),
            point('flag upper channel', channelPoint(shape.upper), bars),
            point('flag lower channel', channelPoint(shape.lower), bars),
        ],
        lineValueAt(up ? shape.upper : shape.lower, lastIndex),
        Math.abs(shape.poleTop.price - shape.poleBase.price),
        shape.direction,
        shape.flagExtreme
    );
}

/**
 * High tight flag — the bull_flag rule on the matched pole: breakout at the
 * pole top, invalidation at the flag low, height = pole top − pole base.
 */
function highTightFlagGeometry(
    shape: HighTightFlagPatternShape,
    bars: readonly Bar[]
): PatternGeometry | null {
    return measuredMove(
        [
            point('flagpole base', shape.poleBase, bars),
            point('flagpole top', shape.poleTop, bars),
            point('flag lower channel', shape.flagLow, bars),
        ],
        shape.poleTop.price,
        shape.poleTop.price - shape.poleBase.price,
        'up',
        shape.flagLow
    );
}

// ─── Cup & handle and rounding ──────────────────────────────────────────────

/** Cup & handle: breakout = right rim, height = right rim − bottom, invalidation = handle low. */
function cupGeometry(
    shape: CupPatternShape,
    bars: readonly Bar[]
): PatternGeometry | null {
    return measuredMove(
        [
            point('left rim', shape.leftRim, bars),
            point('bottom', shape.bottom, bars),
            point('right rim', shape.rightRim, bars),
            point('handle low', shape.handleLow, bars),
        ],
        shape.rightRim.price,
        shape.rightRim.price - shape.bottom.price,
        'up',
        shape.handleLow
    );
}

/**
 * Rounding: breakout at the lip (the higher rim of a bottom, the lower rim of a
 * top), height = lip to extreme, invalidation at the most recent confirmed
 * swing on the right side.
 */
function roundingGeometry(
    shape: RoundingPatternShape,
    bars: readonly Bar[]
): PatternGeometry | null {
    const isBottom = shape.leftRim.kind === 'high';
    const lip = isBottom
        ? Math.max(shape.leftRim.price, shape.rightRim.price)
        : Math.min(shape.leftRim.price, shape.rightRim.price);
    return measuredMove(
        [
            point('left rim', shape.leftRim, bars),
            point(isBottom ? 'bottom' : 'top', shape.extreme, bars),
            point('right rim', shape.rightRim, bars),
        ],
        lip,
        Math.abs(lip - shape.extreme.price),
        isBottom ? 'up' : 'down',
        shape.invalidation
    );
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────

/**
 * Computes the measured-move geometry of one qualified pattern from its
 * fixed shape. `null` when `atr`/bounds are invalid, when a boundary pair has
 * crossed by the last bar, or when the shape yields no positive height.
 *
 * @param pattern - A `qualifyPatterns` result, indexed into `bars`.
 * @param bars - The full bar series the pattern came from (oldest-first).
 * @param atr - Average True Range for `bars` (must be finite and > 0) — the
 *   same validity guard `qualifyPatterns` itself applies.
 * @returns Directed geometry, undirected geometry (a boundary pair with no
 *   prior trend), or `null`.
 */
export function computeCandidateGeometry(
    pattern: QualifiedPattern,
    bars: readonly Bar[],
    atr: number
): QualifiedPatternGeometry | null {
    if (!Number.isFinite(atr) || atr <= 0) return null;
    if (
        pattern.startIndex < 0 ||
        pattern.endIndex >= bars.length ||
        pattern.startIndex > pattern.endIndex
    ) {
        return null;
    }
    const { shape } = pattern;
    switch (shape.kind) {
        case 'extreme':
            return extremeGeometry(pattern, shape, bars);
        case 'head_and_shoulders':
            return headAndShouldersGeometry(pattern, shape, bars);
        case 'trendline':
            return trendlineGeometry(shape, bars, pattern.id);
        case 'flag':
            return flagGeometry(pattern, shape, bars);
        case 'high_tight_flag':
            return highTightFlagGeometry(shape, bars);
        case 'cup':
            return cupGeometry(shape, bars);
        case 'rounding':
            return roundingGeometry(shape, bars);
    }
}
