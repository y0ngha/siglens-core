import type {
    Bar,
    FibonacciLevel,
    FibonacciPivotLevels,
    FibonacciProjection,
    IndicatorResult,
    PivotFibLevels,
    SMCResult,
    SMCSwingPoint,
    StandardPivotLevels,
    SwingLegDirection,
} from '@/domain/types';
import { lastOf } from '@/domain/analysis/analysisUtils';

/** @internal Divisor for the central pivot: (high + low + close) / 3. */
const PIVOT_DIVISOR = 3;
/** @internal Multiplier for the doubled-pivot terms in standard R1/S1 and R3/S3. */
const PIVOT_DOUBLE = 2;

/** @internal Fibonacci pivot fractions of the prior-period range. */
const FIB_PIVOT_R1_S1_RATIO = 0.382;
const FIB_PIVOT_R2_S2_RATIO = 0.618;
const FIB_PIVOT_R3_S3_RATIO = 1.0;

/**
 * @internal Fibonacci retracement ratios (fractions of the swing high–low range).
 * Ordered shallow-to-deep so the rendered levels read top-down on an up-leg.
 */
const FIB_RETRACEMENT_RATIOS = [0.236, 0.382, 0.5, 0.618, 0.786] as const;

/**
 * @internal Fibonacci extension ratios used as projected take-profit targets.
 * 1.0 echoes the full measured move; higher ratios project beyond it.
 */
const FIB_EXTENSION_RATIOS = [1.0, 1.272, 1.618, 2.0, 2.618] as const;

const isUsablePrice = (price: number): boolean =>
    Number.isFinite(price) && price > 0;

/**
 * @internal Resolve the shared pivot base (central pivot `pp` and `range`) from a
 * bar's high/low/close. Returns `null` when any of the three prices is unusable,
 * so both pivot variants share one validation and base-arithmetic step.
 */
const resolvePivotBase = (bar: Bar): { pp: number; range: number } | null => {
    const { high, low, close } = bar;
    if (!isUsablePrice(high) || !isUsablePrice(low) || !isUsablePrice(close)) {
        return null;
    }

    return {
        pp: (high + low + close) / PIVOT_DIVISOR,
        range: high - low,
    };
};

const computeStandardPivot = (bar: Bar): StandardPivotLevels | null => {
    const base = resolvePivotBase(bar);
    if (base === null) return null;

    const { pp, range } = base;
    const { high, low } = bar;
    const twicePp = PIVOT_DOUBLE * pp;
    return {
        pp,
        r1: twicePp - low,
        r2: pp + range,
        r3: high + PIVOT_DOUBLE * (pp - low),
        s1: twicePp - high,
        s2: pp - range,
        s3: low - PIVOT_DOUBLE * (high - pp),
    };
};

const computeFibonacciPivot = (bar: Bar): FibonacciPivotLevels | null => {
    const base = resolvePivotBase(bar);
    if (base === null) return null;

    const { pp, range } = base;
    return {
        pp,
        r1: pp + FIB_PIVOT_R1_S1_RATIO * range,
        r2: pp + FIB_PIVOT_R2_S2_RATIO * range,
        r3: pp + FIB_PIVOT_R3_S3_RATIO * range,
        s1: pp - FIB_PIVOT_R1_S1_RATIO * range,
        s2: pp - FIB_PIVOT_R2_S2_RATIO * range,
        s3: pp - FIB_PIVOT_R3_S3_RATIO * range,
    };
};

/**
 * Resolve the swing leg direction from the chronological order of the two most
 * recent swing points: an up-leg when the low forms before the high.
 */
const resolveLegDirection = (
    swingHigh: SMCSwingPoint,
    swingLow: SMCSwingPoint
): SwingLegDirection => (swingLow.index < swingHigh.index ? 'up' : 'down');

/**
 * Build retracement levels. On an up-leg, ratio 0 sits at the high and ratio 1
 * at the low (a pullback from the high); on a down-leg the anchors are mirrored
 * so the levels track a bounce from the low.
 */
const buildRetracements = (
    high: number,
    low: number,
    direction: SwingLegDirection
): FibonacciLevel[] => {
    const range = high - low;
    return FIB_RETRACEMENT_RATIOS.map(ratio => ({
        ratio,
        price: direction === 'up' ? high - ratio * range : low + ratio * range,
    }));
};

/**
 * Build extension levels projected past the measured move: in the swing's own
 * direction (above the high for an up-leg, below the low for a down-leg).
 */
const buildExtensions = (
    high: number,
    low: number,
    direction: SwingLegDirection
): FibonacciLevel[] => {
    const range = high - low;
    return FIB_EXTENSION_RATIOS.map(ratio => ({
        ratio,
        price: direction === 'up' ? low + ratio * range : high - ratio * range,
    }));
};

const computeFibonacciProjection = (
    smc: SMCResult
): FibonacciProjection | null => {
    const swingHigh = lastOf(smc.swingHighs);
    const swingLow = lastOf(smc.swingLows);
    if (swingHigh === null || swingLow === null) return null;

    const { price: high } = swingHigh;
    const { price: low } = swingLow;
    if (!isUsablePrice(high) || !isUsablePrice(low) || high <= low) {
        return null;
    }

    const direction = resolveLegDirection(swingHigh, swingLow);
    return {
        high,
        low,
        direction,
        retracements: buildRetracements(high, low, direction),
        extensions: buildExtensions(high, low, direction),
    };
};

/** @internal Minimum bar count to expose a prior completed period for pivots. */
const MIN_BARS_FOR_PIVOT = 2;

/**
 * Compute deterministic pivot points and Fibonacci levels for a symbol.
 *
 * Pivot sets (standard and Fibonacci) are derived from the last completed prior
 * period — `bars[len - 2]` — whose high/low/close project onto the current
 * (latest) period the snapshot price belongs to. The Fibonacci projection
 * anchors on the most recent SMC swing high and swing low, deriving 23.6%–78.6%
 * retracements and 100%–261.8% extension targets; its `direction` follows the
 * chronological order of those swings.
 *
 * Every component is `null` when its inputs are unavailable: the pivots require
 * at least two bars (a prior period to anchor on) and finite, positive OHLC; the
 * Fibonacci projection requires swing points and a positive swing range.
 * These levels are injected into the prompt so the AI selects and interprets
 * them instead of performing the arithmetic itself.
 *
 * @param bars - OHLCV bars sorted oldest-first; the second-to-last bar anchors the pivots.
 * @param indicators - Indicator suite produced by `calculateIndicators` (SMC swings anchor the Fibonacci projection).
 * @returns Standard pivot, Fibonacci pivot, and Fibonacci projection, each nullable.
 */
export function computePivotFibLevels(
    bars: Bar[],
    indicators: IndicatorResult
): PivotFibLevels {
    const len = bars.length;
    const priorBar =
        len >= MIN_BARS_FOR_PIVOT ? bars[len - MIN_BARS_FOR_PIVOT] : null;

    return {
        standardPivot: priorBar != null ? computeStandardPivot(priorBar) : null,
        fibonacciPivot:
            priorBar != null ? computeFibonacciPivot(priorBar) : null,
        fibonacci: computeFibonacciProjection(indicators.smc),
    };
}
