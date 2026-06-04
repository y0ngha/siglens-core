import { describe, it, expect } from 'vitest';
import {
    forwardReturn,
    aggregateForwardReturns,
    computeBaseline,
} from '@/domain/validation/baseline';

describe('forwardReturn', () => {
    const closes = [100, 110, 121]; // +10% each step

    it('computes upward fractional return over horizon', () => {
        expect(forwardReturn(closes, 0, 1, 'up')).toBeCloseTo(0.1, 10);
        expect(forwardReturn(closes, 0, 2, 'up')).toBeCloseTo(0.21, 10);
    });

    it('negates the return for a down-direction signal', () => {
        expect(forwardReturn(closes, 0, 1, 'down')).toBeCloseTo(-0.1, 10);
    });

    it('returns null when horizon runs past the end (worst case)', () => {
        expect(forwardReturn(closes, 2, 1, 'up')).toBeNull();
        expect(forwardReturn(closes, 0, 5, 'up')).toBeNull();
    });

    it('returns null for non-positive base price (worst case)', () => {
        expect(forwardReturn([0, 5], 0, 1, 'up')).toBeNull();
        expect(forwardReturn([-1, 5], 0, 1, 'up')).toBeNull();
    });

    it('returns null for a negative index (worst case)', () => {
        expect(forwardReturn(closes, -1, 1, 'up')).toBeNull();
    });
});

describe('aggregateForwardReturns', () => {
    it('aggregates hit-rate and mean over valid indices only', () => {
        const closes = [100, 110, 99]; // idx0: +10%, idx1: -10%
        const stats = aggregateForwardReturns(closes, [0, 1], 1, 'up');
        expect(stats.count).toBe(2);
        expect(stats.hitRate).toBeCloseTo(0.5, 10);
        expect(stats.meanReturn).toBeCloseTo((0.1 - 0.1) / 2, 10);
    });

    it('skips out-of-range indices', () => {
        const closes = [100, 110];
        const stats = aggregateForwardReturns(closes, [0, 1, 5], 1, 'up');
        expect(stats.count).toBe(1);
    });

    it('returns zeroed stats for an empty / all-invalid index set (worst case)', () => {
        expect(aggregateForwardReturns([100, 110], [], 1, 'up')).toEqual({
            count: 0,
            hitRate: 0,
            meanReturn: 0,
        });
        expect(aggregateForwardReturns([100], [0], 1, 'up')).toEqual({
            count: 0,
            hitRate: 0,
            meanReturn: 0,
        });
    });
});

describe('computeBaseline', () => {
    it('aggregates over every eligible index [0, n-horizon)', () => {
        const closes = [100, 110, 121, 133.1]; // all +10%
        const base = computeBaseline(closes, 1, 'up');
        expect(base.count).toBe(3);
        expect(base.hitRate).toBeCloseTo(1, 10);
    });

    it('returns zeroed stats when series shorter than horizon (worst case)', () => {
        expect(computeBaseline([100], 1, 'up')).toEqual({
            count: 0,
            hitRate: 0,
            meanReturn: 0,
        });
        expect(computeBaseline([], 1, 'up')).toEqual({
            count: 0,
            hitRate: 0,
            meanReturn: 0,
        });
    });
});
