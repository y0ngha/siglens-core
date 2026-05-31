import { describe, expect, it } from 'vitest';
import { anchoredVwap } from '@/domain/analysis/anchoredVwap';
import type { Bar } from '@/domain/types';

const bar = (i: number, h: number, l: number, c: number, v: number): Bar => ({
    time: i,
    open: c,
    high: h,
    low: l,
    close: c,
    volume: v,
});

describe('anchoredVwap', () => {
    it('equals the typical price when anchored at the last bar', () => {
        const bars = [bar(0, 10, 8, 9, 100), bar(1, 12, 10, 11, 50)];
        // anchor at index 1 -> only that bar: (12+10+11)/3 = 11
        expect(anchoredVwap(bars, 1)).toBeCloseTo(11, 6);
    });
    it('volume-weights the typical price across the anchored range', () => {
        const bars = [bar(0, 10, 10, 10, 100), bar(1, 20, 20, 20, 300)];
        // anchor 0: (10*100 + 20*300) / 400 = 17.5
        expect(anchoredVwap(bars, 0)).toBeCloseTo(17.5, 6);
    });
    it('returns null for an out-of-range anchor', () => {
        expect(anchoredVwap([bar(0, 10, 8, 9, 100)], 5)).toBeNull();
        expect(anchoredVwap([bar(0, 10, 8, 9, 100)], -1)).toBeNull();
    });
    it('returns null when total volume is non-positive', () => {
        expect(anchoredVwap([bar(0, 10, 8, 9, 0)], 0)).toBeNull();
    });
});
