import { describe, expect, it } from 'vitest';
import type { Bar, BuySellVolumeResult } from '@/domain/types';
import {
    computeFactorsAtT,
    FEAR_GREED_MIN_FACTOR_WINDOW,
} from '@/domain/indicators/fearGreed/factors';

function fakeBar(time: number, close: number, volume: number): Bar {
    return {
        time,
        open: close,
        high: close * 1.01,
        low: close * 0.99,
        close,
        volume,
    };
}

/**
 * 250+ bars with mild variance so the spec's strict guards (volume std != 0,
 * POC has ≥ 30 bars, MA200/RANGE have ≥ 30 bars) are all satisfied. Without
 * variance the rolling-volume std becomes 0 and the function correctly returns null.
 */
function genBars(
    count: number,
    options: {
        priceTrend?: number; // per-bar increment, default 0.1
        baseVolume?: number; // base volume, default 1_000_000
        volumeJitter?: number; // ± volume variance, default 50_000
        priceJitter?: number; // ± price wiggle, default 0.5
    } = {}
): Bar[] {
    const {
        priceTrend = 0.1,
        baseVolume = 1_000_000,
        volumeJitter = 50_000,
        priceJitter = 0.5,
    } = options;
    return Array.from({ length: count }, (_, i) => {
        const close = 100 + i * priceTrend + ((i % 7) - 3) * priceJitter * 0.1;
        const volume = baseVolume + ((i % 11) - 5) * volumeJitter * 0.2;
        return fakeBar(i + 1, close, volume);
    });
}

describe('computeFactorsAtT', () => {
    it('returns null when t < 1', () => {
        const bars = [fakeBar(1, 100, 1_000_000)];
        const bsv: BuySellVolumeResult[] = [{ buyVolume: 0, sellVolume: 0 }];
        expect(computeFactorsAtT(bars, bsv, 0)).toBeNull();
    });

    it('returns null when pre-t window is too small for MA200/RANGE guards', () => {
        const bars = genBars(FEAR_GREED_MIN_FACTOR_WINDOW - 10);
        const bsv: BuySellVolumeResult[] = bars.map(() => ({
            buyVolume: 0,
            sellVolume: 0,
        }));
        expect(computeFactorsAtT(bars, bsv, bars.length - 1)).toBeNull();
    });

    it('returns positive volumeZ when volume spike on up day', () => {
        const baseBars = genBars(250); // 250 bars with variance — passes all guards
        const last = baseBars[baseBars.length - 1];
        const spikeBar: Bar = {
            ...last,
            close: last.close + 5,
            high: (last.close + 5) * 1.01,
            low: (last.close + 5) * 0.99,
            volume: 5_000_000,
        };
        const bars = [...baseBars.slice(0, -1), spikeBar];
        const bsv: BuySellVolumeResult[] = bars.map(() => ({
            buyVolume: 600_000,
            sellVolume: 400_000,
        }));
        const result = computeFactorsAtT(bars, bsv, bars.length - 1);
        expect(result).not.toBeNull();
        expect(result!.volumeZ).toBeGreaterThan(0);
        expect(result!.buySellImb).toBeCloseTo(0.2, 2);
    });

    it('returns rangePosition 1.0 when current close == 252-window high (current included)', () => {
        const baseBars = genBars(250);
        const last = baseBars[baseBars.length - 1];
        const newHighBar: Bar = {
            time: last.time,
            open: last.close,
            high: 200, // well above all prior highs
            low: last.close * 0.99,
            close: 200,
            volume: 1_000_000,
        };
        const bars = [...baseBars.slice(0, -1), newHighBar];
        const bsv: BuySellVolumeResult[] = bars.map(() => ({
            buyVolume: 0,
            sellVolume: 0,
        }));
        const result = computeFactorsAtT(bars, bsv, bars.length - 1);
        expect(result).not.toBeNull();
        expect(result!.rangePosition).toBeCloseTo(1.0, 5);
    });

    it('handles empty buySellVolume entry → buySellImb = 0', () => {
        const bars = genBars(250);
        const bsv: BuySellVolumeResult[] = bars.map(() => ({
            buyVolume: 0,
            sellVolume: 0,
        }));
        const result = computeFactorsAtT(bars, bsv, bars.length - 1);
        expect(result).not.toBeNull();
        expect(result!.buySellImb).toBe(0);
    });
});
