import { describe, expect, it } from 'vitest';
import type { Bar, BuySellVolumeResult } from '@/domain/types';
import { computeFactorsAtT } from '@/domain/indicators/fearGreed/factors';

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
        priceTrend?: number;     // per-bar increment, default 0.1
        baseVolume?: number;     // base volume, default 1_000_000
        volumeJitter?: number;   // ± volume variance, default 50_000
        priceJitter?: number;    // ± price wiggle, default 0.5
    } = {}
): Bar[] {
    const {
        priceTrend = 0.1,
        baseVolume = 1_000_000,
        volumeJitter = 50_000,
        priceJitter = 0.5,
    } = options;
    const bars: Bar[] = [];
    for (let i = 0; i < count; i++) {
        const close = 100 + i * priceTrend + ((i % 7) - 3) * priceJitter * 0.1;
        const volume = baseVolume + ((i % 11) - 5) * volumeJitter * 0.2;
        bars.push(fakeBar(i + 1, close, volume));
    }
    return bars;
}

describe('computeFactorsAtT', () => {
    it('returns null when t < 1', () => {
        const bars = [fakeBar(1, 100, 1_000_000)];
        const bsv: BuySellVolumeResult[] = [{ buyVolume: 0, sellVolume: 0 }];
        expect(computeFactorsAtT(bars, bsv, 0)).toBeNull();
    });

    it('returns null when pre-t window is too small for POC/MA200/RANGE guards', () => {
        const bars = genBars(20);
        const bsv: BuySellVolumeResult[] = bars.map(() => ({
            buyVolume: 0,
            sellVolume: 0,
        }));
        // t=19: pre-t window has 19 bars (< 30 for MA200/RANGE) → null
        expect(computeFactorsAtT(bars, bsv, 19)).toBeNull();
    });

    it('returns positive volumeZ when volume spike on up day', () => {
        const bars = genBars(250); // 250 bars with variance — passes all guards
        // Replace last bar with a clear up-day volume spike
        const last = bars[bars.length - 1];
        bars[bars.length - 1] = {
            ...last,
            close: last.close + 5,           // strong up day
            high: (last.close + 5) * 1.01,
            low: (last.close + 5) * 0.99,
            volume: 5_000_000,                // spike
        };
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
        const bars = genBars(250);
        // Replace last bar so close == new high of full window
        const last = bars[bars.length - 1];
        bars[bars.length - 1] = {
            time: last.time,
            open: last.close,
            high: 200, // well above all prior highs
            low: last.close * 0.99,
            close: 200,
            volume: 1_000_000,
        };
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
