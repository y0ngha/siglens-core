import type { EmaStackState, SwingStructureState } from '@/domain/types';

/** Number of trailing swing points compared to classify Dow structure. */
const SWING_COMPARISON_COUNT = 2;

/** @internal Kaufman efficiency ratio over the last `period` closes: |net| / Σ|step|. */
export function efficiencyRatio(
    closes: readonly number[],
    period: number
): number | null {
    if (closes.length < period + 1) return null;
    const window = closes.slice(-(period + 1));
    const net = Math.abs(window[window.length - 1] - window[0]);
    let volatility = 0;
    for (let i = 1; i < window.length; i++) {
        volatility += Math.abs(window[i] - window[i - 1]);
    }
    if (volatility === 0) return null;
    return net / volatility;
}

/** @internal EMA-stack alignment from price + two EMAs (short, long). */
export function classifyEmaStack(
    price: number,
    emaShort: number,
    emaLong: number
): EmaStackState {
    if (price > emaShort && emaShort > emaLong) return 'aligned_up';
    if (price < emaShort && emaShort < emaLong) return 'aligned_down';
    return 'mixed';
}

/** @internal Dow structure from the last two swing highs and lows. */
export function classifySwingStructure(
    swingHighs: readonly number[],
    swingLows: readonly number[]
): SwingStructureState {
    if (
        swingHighs.length < SWING_COMPARISON_COUNT ||
        swingLows.length < SWING_COMPARISON_COUNT
    ) {
        return 'mixed';
    }
    const lastHigh = swingHighs[swingHighs.length - 1];
    const prevHigh = swingHighs[swingHighs.length - SWING_COMPARISON_COUNT];
    const lastLow = swingLows[swingLows.length - 1];
    const prevLow = swingLows[swingLows.length - SWING_COMPARISON_COUNT];
    const hh = lastHigh > prevHigh;
    const hl = lastLow > prevLow;
    const lh = lastHigh < prevHigh;
    const ll = lastLow < prevLow;
    if (hh && hl) return 'HH_HL';
    if (lh && ll) return 'LH_LL';
    return 'mixed';
}
