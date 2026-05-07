import { describe, expect, it } from 'vitest';
import type { Bar, BuySellVolumeResult } from '@/domain/types';
import { computeFactorsAtT } from '@/domain/indicators/fearGreed/factors';

function fakeBar(time: number, close: number, volume = 1_000_000): Bar {
    return { time, open: close, high: close * 1.01, low: close * 0.99, close, volume };
}

describe('computeFactorsAtT', () => {
    it('returns null when t < 1', () => {
        const bars = [fakeBar(1, 100)];
        const bsv: BuySellVolumeResult[] = [{ buyVolume: 0, sellVolume: 0 }];
        expect(computeFactorsAtT(bars, bsv, 0)).toBeNull();
    });

    it('returns null when window has fewer than 5 elements pre-t', () => {
        const bars = [fakeBar(1, 100), fakeBar(2, 101)];
        const bsv: BuySellVolumeResult[] = [
            { buyVolume: 0, sellVolume: 0 },
            { buyVolume: 0, sellVolume: 0 },
        ];
        expect(computeFactorsAtT(bars, bsv, 1)).toBeNull();
    });

    it('returns positive volumeZ when volume spike on up day', () => {
        const bars: Bar[] = [];
        for (let i = 0; i < 30; i++) {
            bars.push(fakeBar(i + 1, 100 + i * 0.1, 1_000_000));
        }
        bars[29] = fakeBar(30, 110, 5_000_000);
        const bsv: BuySellVolumeResult[] = bars.map(() => ({
            buyVolume: 600_000,
            sellVolume: 400_000,
        }));
        const result = computeFactorsAtT(bars, bsv, 29);
        expect(result).not.toBeNull();
        expect(result!.volumeZ).toBeGreaterThan(0);
        expect(result!.buySellImb).toBeCloseTo(0.2, 2);
    });

    it('returns range_position 1.0 when current close == 252-window high (현재 포함)', () => {
        const bars: Bar[] = [];
        for (let i = 0; i < 50; i++) {
            bars.push(fakeBar(i + 1, 100, 1_000_000));
        }
        bars[49] = { time: 50, open: 100, high: 110, low: 99, close: 110, volume: 1_000_000 };
        const bsv: BuySellVolumeResult[] = bars.map(() => ({ buyVolume: 0, sellVolume: 0 }));
        const result = computeFactorsAtT(bars, bsv, 49);
        expect(result).not.toBeNull();
        expect(result!.rangePosition).toBeCloseTo(1.0, 5);
    });

    it('handles empty buySellVolume entry → buySellImb = 0', () => {
        const bars: Bar[] = [];
        for (let i = 0; i < 30; i++) {
            bars.push(fakeBar(i + 1, 100 + i, 1_000_000));
        }
        const bsv: BuySellVolumeResult[] = bars.map(() => ({ buyVolume: 0, sellVolume: 0 }));
        const result = computeFactorsAtT(bars, bsv, 29);
        expect(result?.buySellImb).toBe(0);
    });
});
