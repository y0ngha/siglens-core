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
    it('returns null for empty bars array', () => {
        expect(computeFearGreedIndex([], [])).toBeNull();
    });

    it('returns null when bars are insufficient for factor windows', () => {
        // 8 bars: factor windows (FEAR_GREED_MIN_FACTOR_WINDOW=30) cannot populate
        // at the latest bar, so computeFactorsAtT returns null and computeFearGreedIndex
        // short-circuits via the !current guard.
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
        // Two tie sources moved these anchors when percentile switched from
        // strict-less to mid-rank (63.73 → 72.43, Flow 47.79 → 65.18):
        //  - buysell_imbalance ties its whole sample (genBsv returns a
        //    constant 600k/400k split, so buySellImb is identical at every
        //    bar) and now ranks 50 instead of 0.
        //  - volume_z ties 16 of the 369 samples (genBars' `i % 11` volume
        //    cycle aliases against the 20-bar z-score window), moving that
        //    factor's percentile ~63.7 → ~65.9.
        // Trend group factors have no ties here, so its score is unchanged.
        expect(snap!.score).toBeCloseTo(72.43, 1);
        expect(snap!.label).toBe('GREED');
        expect(snap!.groups[0].score).toBeCloseTo(65.18, 1);
        expect(snap!.groups[1].score).toBeCloseTo(79.67, 1);
        expect(snap!.sampleSize).toBe(369);
    });

    it('does not bias buysell_imbalance to 0 when buySellVolume is empty (tie mid-rank regression)', () => {
        // An empty buySellVolume array makes buySellImb exactly 0 on every bar
        // (see computeFactorsAtT: `bsv` is undefined for every index, so
        // buySellImb falls back to 0). The current value then ties the whole
        // walk-forward sample. Before the mid-rank fix, strict-less semantics
        // ranked every tie at the bottom, permanently reading buysell_imbalance
        // as maximally fearful; it must now read as neutral (50) instead.
        const bars = genBars(400);
        const snap = computeFearGreedIndex(bars, []);
        expect(snap).not.toBeNull();
        const buysellFactor = snap!.groups
            .flatMap(g => g.factors)
            .find(f => f.key === 'buysell_imbalance');
        expect(buysellFactor).toBeDefined();
        expect(buysellFactor!.rawValue).toBe(0);
        expect(buysellFactor!.percentile).toBe(50);
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
