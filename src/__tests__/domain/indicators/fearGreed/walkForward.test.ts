import { describe, expect, it } from 'vitest';
import type { Bar, BuySellVolumeResult } from '@/domain/types';
import {
    computeFearGreedIndex,
    computeFearGreedHistory,
} from '@/domain/indicators/fearGreed/walkForward';

function genBars(count: number, basePrice = 100): Bar[] {
    return Array.from({ length: count }, (_, i) => {
        const close = basePrice + Math.sin(i / 10) * 5;
        return {
            time: 1_700_000_000 + i * 86_400,
            open: close,
            high: close + 1,
            low: close - 1,
            close,
            volume: 1_000_000 + (i % 11) * 30_000,
        };
    });
}

function genBsv(count: number): BuySellVolumeResult[] {
    return Array.from({ length: count }, () => ({
        buyVolume: 600_000,
        sellVolume: 400_000,
    }));
}

describe('computeFearGreedIndex', () => {
    it('returns null for too-few bars', () => {
        const bars = genBars(20);
        expect(computeFearGreedIndex(bars, genBsv(20))).toBeNull();
    });

    it('returns snapshot when bars >= warmup + factor windows', () => {
        const bars = genBars(400);
        const snap = computeFearGreedIndex(bars, genBsv(400));
        expect(snap).not.toBeNull();
        expect(snap!.confidence).toBe('normal');
        expect(snap!.score).toBeGreaterThanOrEqual(0);
        expect(snap!.score).toBeLessThanOrEqual(100);
        expect(snap!.groups).toHaveLength(2);
        const factorCount =
            snap!.groups[0].factors.length + snap!.groups[1].factors.length;
        expect(factorCount).toBe(5);
    });
});

describe('computeFearGreedHistory', () => {
    it('returns array length equal to bars.length, with nulls in warm-up', () => {
        const bars = genBars(400);
        const history = computeFearGreedHistory(bars, genBsv(400));
        expect(history).toHaveLength(400);
        expect(history[0].score).toBeNull();
        expect(history[history.length - 1].score).not.toBeNull();
    });

    it('does not have look-ahead bias — history at index i unchanged when bars are added beyond i', () => {
        const bars1 = genBars(400);
        const bars2 = [...bars1, ...genBars(100, 110)];
        const h1 = computeFearGreedHistory(bars1, genBsv(400));
        const h2 = computeFearGreedHistory(bars2, genBsv(500));
        expect(h2[399].score).toBeCloseTo(h1[399].score!, 5);
    });
});
