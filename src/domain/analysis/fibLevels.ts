import type {
    FibonacciLevel,
    FibonacciProjection,
    SMCResult,
    SMCSwingPoint,
    SwingLegDirection,
} from '@/domain/types';
import { lastOf } from '@/domain/analysis/analysisUtils';

/**
 * Fibonacci retracement ratios (fractions of the swing high–low range).
 * Ordered shallow-to-deep so the rendered levels read top-down on an up-leg.
 */
const FIB_RETRACEMENT_RATIOS = [0.236, 0.382, 0.5, 0.618, 0.786] as const;

/**
 * Fibonacci extension ratios used as projected take-profit targets.
 * 1.0 echoes the full measured move; higher ratios project beyond it.
 */
const FIB_EXTENSION_RATIOS = [1.0, 1.272, 1.618, 2.0, 2.618] as const;

export const isUsablePrice = (price: number): boolean =>
    Number.isFinite(price) && price > 0;

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

/**
 * Compute Fibonacci retracement and extension levels anchored on the most recent
 * SMC swing high and swing low.
 *
 * Returns `null` when swing points are missing, prices are unusable, or the swing
 * range is non-positive. Otherwise yields 23.6%–78.6% retracements within the
 * range and 100%–261.8% extension targets beyond it; `direction` follows the
 * chronological order of the two swings.
 *
 * @param smc - SMC result whose latest swing high/low anchor the projection.
 * @returns The Fibonacci projection, or `null` when inputs are unavailable.
 */
export const computeFibonacciProjection = (
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
