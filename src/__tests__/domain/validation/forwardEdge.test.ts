import { describe, it, expect } from 'vitest';
import { computeForwardEdge, sampleStd } from '@/domain/validation/forwardEdge';

describe('computeForwardEdge', () => {
    it('reports positive excess when triggers beat the baseline', () => {
        // closes rise +10% only right after even indices; odd indices fall.
        const closes = [100, 110, 99, 109, 98, 108];
        // triggers at even indices (0,2,4) → each +10% over horizon 1.
        const res = computeForwardEdge(closes, [0, 2, 4], 1, 'up');
        expect(res.triggerCount).toBe(3);
        expect(res.signal.hitRate).toBeCloseTo(1, 10);
        expect(res.excessMeanReturn).toBeGreaterThan(0);
        expect(res.excessHitRate).toBeGreaterThan(0);
    });

    it('emits tStat = 0 when fewer than two valid triggers (worst case)', () => {
        const closes = [100, 110, 121];
        const res = computeForwardEdge(closes, [0], 1, 'up');
        expect(res.tStat).toBe(0);
    });

    it('emits tStat = 0 when signal returns have zero variance (worst case)', () => {
        // every +10% → identical returns → sample std 0 → guarded to 0.
        const closes = [100, 110, 121, 133.1, 146.41];
        const res = computeForwardEdge(closes, [0, 1, 2], 1, 'up');
        expect(res.tStat).toBe(0);
    });

    it('handles an empty trigger set (worst case)', () => {
        const res = computeForwardEdge([100, 110, 121], [], 1, 'up');
        expect(res.triggerCount).toBe(0);
        expect(res.tStat).toBe(0);
        expect(res.excessMeanReturn).toBeCloseTo(-res.baseline.meanReturn, 10);
    });

    it('produces a positive finite tStat for a real edge with variance', () => {
        // triggers' returns vary but are all clearly above baseline.
        const closes = [100, 108, 100, 112, 100, 116, 100];
        const res = computeForwardEdge(closes, [0, 2, 4], 1, 'up');
        expect(Number.isFinite(res.tStat)).toBe(true);
        expect(res.tStat).toBeGreaterThan(0);
        // Hand-derived: signal returns [0.08, 0.12, 0.16] (mean 0.12, sd 0.04,
        // n 3); baseline mean ≈ 0.006809 →
        // tStat = (0.12 − 0.006809) / (0.04 / √3) ≈ 4.90.
        expect(res.tStat).toBeCloseTo(4.9, 1);
    });
});

describe('sampleStd', () => {
    it('returns 0 for an empty array (worst case)', () => {
        expect(sampleStd([], 0)).toBe(0);
    });

    it('returns 0 for a single point — no (n−1) spread (worst case)', () => {
        expect(sampleStd([42], 42)).toBe(0);
    });

    it('returns 0 when every value is identical (zero variance)', () => {
        expect(sampleStd([5, 5, 5], 5)).toBe(0);
    });

    it('computes the (n−1) sample std about the given mean', () => {
        // [1,2,3] about mean 2 → variance ((−1)²+0+1²)/(3−1)=1 → std 1.
        expect(sampleStd([1, 2, 3], 2)).toBeCloseTo(1, 12);
    });

    it('uses the supplied mean, not the array mean (parameter contract)', () => {
        // About mean 0: sqrt((1²+2²+3²)/(3−1)) = sqrt(7) ≈ 2.6457513.
        expect(sampleStd([1, 2, 3], 0)).toBeCloseTo(Math.sqrt(7), 12);
    });
});
