import { describe, expect, it } from 'vitest';
import type { Bar, BuySellVolumeResult } from '@/domain/types';
import {
    computeFearGreedIndex,
    computeFearGreedHistory,
} from '@/domain/indicators/fearGreed/walkForward';
import { FEAR_GREED_CONFIDENCE_THRESHOLDS } from '@/domain/indicators/fearGreed/composition';
import type { FearGreedHistoryPoint } from '@/domain/indicators/fearGreed/types';

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
    it('returns null when bars are below the LIMITED confidence threshold', () => {
        // 8 bars: below LIMITED (10). Even if a factor were computable, the
        // walk-forward sample would be < LIMITED so composeSnapshot returns null.
        const bars = genBars(8);
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

        // Deterministic regression assertions captured against the current
        // walk-forward composition. Anchors composeSnapshot wiring + factor
        // ordering so accidental drift in scoring math surfaces here.
        expect(snap!.score).toBeCloseTo(63.73, 1);
        expect(snap!.label).toBe('GREED');
        expect(snap!.groups[0].score).toBeCloseTo(47.79, 1);
        expect(snap!.groups[1].score).toBeCloseTo(79.67, 1);
        expect(snap!.sampleSize).toBe(369);
    });

    it('returns confidence "limited" when sample is between LIMITED and NORMAL thresholds', () => {
        // 45 bars: factor windows produce a value at the latest bar (the
        // FEAR_GREED_MIN_FACTOR_WINDOW=30 boundary lets ma200/range factors
        // populate from index ~30) but the walk-forward sample size lands in
        // [LIMITED=10, NORMAL=60). The snapshot is returned with confidence
        // 'limited' rather than null.
        const bars = genBars(45);
        const snap = computeFearGreedIndex(bars, genBsv(45));
        expect(snap).not.toBeNull();
        expect(snap!.confidence).toBe('limited');
        expect(snap!.sampleSize).toBeGreaterThanOrEqual(
            FEAR_GREED_CONFIDENCE_THRESHOLDS.LIMITED
        );
        expect(snap!.sampleSize).toBeLessThan(
            FEAR_GREED_CONFIDENCE_THRESHOLDS.NORMAL
        );
        expect(snap!.score).toBeGreaterThanOrEqual(0);
        expect(snap!.score).toBeLessThanOrEqual(100);
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

        // Find the first index where h1 has a non-null score. With the
        // walkForward change (consistent with composeSnapshot's LIMITED gate),
        // this is the boundary where factor windows finish ramping AND the
        // walk-forward sample reaches LIMITED, whichever is later.
        const firstStableIdx = h1.findIndex(
            (p: FearGreedHistoryPoint) => p.score !== null
        );
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

    it('emits non-null entries once factors are computable, even with sample below NORMAL', () => {
        // History is consistent with composeSnapshot: it returns scores once the
        // walk-forward sample reaches LIMITED (10). With 45 bars, several late
        // entries become non-null even though the sample never reaches NORMAL.
        const bars = genBars(45);
        const history = computeFearGreedHistory(bars, genBsv(45));
        expect(history).toHaveLength(45);
        const nonNullCount = history.filter(
            (p: FearGreedHistoryPoint) => p.score !== null
        ).length;
        expect(nonNullCount).toBeGreaterThan(0);
        // Final entry should carry a score because the latest bar's snapshot
        // (sample=14, confidence='limited') is non-null in this fixture.
        expect(history[history.length - 1].score).not.toBeNull();
    });
});
