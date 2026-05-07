import { describe, expect, it } from 'vitest';
import type { Bar, BuySellVolumeResult } from '@/domain/types';
import {
    computeFearGreedIndex,
    computeFearGreedHistory,
} from '@/domain/indicators/fearGreed/walkForward';
import { FEAR_GREED_CONFIDENCE_THRESHOLDS } from '@/domain/indicators/fearGreed/composition';

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
    it('returns null when bars are below the NORMAL confidence threshold', () => {
        const bars = genBars(FEAR_GREED_CONFIDENCE_THRESHOLDS.NORMAL - 40); // 20 bars
        expect(computeFearGreedIndex(bars, genBsv(bars.length))).toBeNull();
    });

    it('returns snapshot when bars exceed warm-up + factor windows', () => {
        // 400 bars: comfortably above NORMAL (60) and above the 252-bar 52w window
        const bars = genBars(400);
        expect(bars.length).toBeGreaterThan(
            FEAR_GREED_CONFIDENCE_THRESHOLDS.NORMAL
        );
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

    it('does not have look-ahead bias — past entries unchanged when future bars are appended', () => {
        const bars1 = genBars(400);
        const bars2 = [...bars1, ...genBars(100, 110)];
        const h1 = computeFearGreedHistory(bars1, genBsv(400));
        const h2 = computeFearGreedHistory(bars2, genBsv(500));

        // Find the first index where h1 has a non-null score (post-warmup boundary)
        const firstStableIdx = h1.findIndex(p => p.score !== null);
        expect(firstStableIdx).toBeGreaterThan(0);

        // Verify multiple indices: warm-up boundary, mid-history, last index of h1
        const indicesToCheck = [
            firstStableIdx,
            Math.floor((firstStableIdx + 399) / 2),
            399,
        ];
        for (const i of indicesToCheck) {
            expect(h2[i].score).toBeCloseTo(h1[i].score!, 5);
        }
    });
});
