import type { Bar } from '@/domain/types';

const TYPICAL_PRICE_DIVISOR = 3;

/**
 * @internal Volume-weighted average of the typical price from `anchorIndex`
 * through the last bar (Anchored VWAP). Returns null for an out-of-range anchor
 * or non-positive cumulative volume.
 */
export function anchoredVwap(
    bars: readonly Bar[],
    anchorIndex: number
): number | null {
    const length = bars.length;
    if (anchorIndex < 0 || anchorIndex >= length) return null;
    let priceVolume = 0;
    let volume = 0;
    for (let i = anchorIndex; i < length; i++) {
        const b = bars[i];
        const typical = (b.high + b.low + b.close) / TYPICAL_PRICE_DIVISOR;
        priceVolume += typical * b.volume;
        volume += b.volume;
    }
    if (volume <= 0) return null;
    return priceVolume / volume;
}
