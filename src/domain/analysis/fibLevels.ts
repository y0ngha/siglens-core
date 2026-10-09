import type {
    AbcExtensionProjection,
    FibonacciLevel,
    FibonacciProjection,
    SMCResult,
    SMCSwingPoint,
    SwingLegDirection,
} from '@/domain/types';
import { isUsablePrice, lastOf } from '@/domain/analysis/analysisUtils';

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
/** @internal Exported for reuse by `domain/overlays/fibonacciCandidates.ts` — level prices must match this table exactly. */
export const buildRetracements = (
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
/** @internal Exported for reuse by `domain/overlays/fibonacciCandidates.ts` — level prices must match this table exactly. */
export const buildExtensions = (
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

/** One merged, chronologically-ordered swing point with its own type tag. */
interface TypedSwingPoint extends SMCSwingPoint {
    type: 'high' | 'low';
}

/**
 * @internal
 * Compute Fibonacci extension levels projected from point C of an A→B→C
 * swing triplet: the last three confirmed swing points in the window,
 * alternating high/low, continuing the A→B leg's own direction past C.
 *
 * Returns `null` when the window has fewer than 3 confirmed swing points,
 * the last three do not alternate type (A≠B≠C by type), any price is
 * unusable, or the A→B range is non-positive (spec 2026-09-18 §A3 — the
 * "next opposite swing after B" the fibonacci skill's ABC guidance asks the
 * model to cite).
 *
 * @param smc - SMC result whose swing points (already window-filtered by the
 *   caller) supply the A/B/C triplet.
 */
export const computeAbcExtension = (
    smc: SMCResult
): AbcExtensionProjection | null => {
    const merged: TypedSwingPoint[] = [
        ...smc.swingHighs.map(s => ({ ...s, type: 'high' as const })),
        ...smc.swingLows.map(s => ({ ...s, type: 'low' as const })),
    ].sort((x, y) => x.index - y.index);

    if (merged.length < 3) return null;
    const [a, b, c] = merged.slice(-3);
    if (a.type === b.type || b.type === c.type) return null;
    if (
        !isUsablePrice(a.price) ||
        !isUsablePrice(b.price) ||
        !isUsablePrice(c.price)
    ) {
        return null;
    }

    const direction: SwingLegDirection = b.type === 'high' ? 'up' : 'down';
    const range = Math.abs(b.price - a.price);
    if (range <= 0) return null;

    // C must be a real retracement — strictly between A and B — not an
    // overshoot past A (the leg never actually reversed) or a continuation
    // past B (2026-09-18). Equality at either edge is also
    // rejected: it is not a retracement, just a re-test of the anchor.
    const cIsRealRetracement =
        direction === 'up'
            ? c.price > a.price && c.price < b.price
            : c.price < a.price && c.price > b.price;
    if (!cIsRealRetracement) return null;

    const extensions = FIB_EXTENSION_RATIOS.map(ratio => ({
        ratio,
        price:
            direction === 'up'
                ? c.price + ratio * range
                : c.price - ratio * range,
    }));

    return {
        a: a.price,
        b: b.price,
        c: c.price,
        aIndex: a.index,
        bIndex: b.index,
        cIndex: c.index,
        direction,
        extensions,
    };
};

/**
 * @internal
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
        highIndex: swingHigh.index,
        lowIndex: swingLow.index,
        direction,
        retracements: buildRetracements(high, low, direction),
        extensions: buildExtensions(high, low, direction),
    };
};
