import { describe, it, expect } from 'vitest';
import { checkSanity } from '@/domain/validation/sanity';

describe('checkSanity', () => {
    it('passes a clean series within bounds with expected warmup', () => {
        const res = checkSanity([null, null, 0.2, 0.8, 0.5], {
            min: 0,
            max: 1,
            expectedWarmup: 2,
        });
        expect(res.pass).toBe(true);
        expect(res.issues).toEqual([]);
    });

    it('flags a NaN value (worst case)', () => {
        const res = checkSanity([0.1, Number.NaN, 0.3]);
        expect(res.pass).toBe(false);
        expect(res.issues.some(i => i.includes('non-finite'))).toBe(true);
    });

    it('flags an Infinity value (worst case)', () => {
        const res = checkSanity([0.1, Number.POSITIVE_INFINITY]);
        expect(res.pass).toBe(false);
        expect(res.issues.some(i => i.includes('non-finite'))).toBe(true);
    });

    it('flags out-of-range values', () => {
        const res = checkSanity([1.5, -0.2], { min: 0, max: 1 });
        expect(res.pass).toBe(false);
        expect(res.issues.some(i => i.includes('above max'))).toBe(true);
        expect(res.issues.some(i => i.includes('below min'))).toBe(true);
    });

    it('flags a warmup-count mismatch', () => {
        const res = checkSanity([null, 0.5], { expectedWarmup: 2 });
        expect(res.pass).toBe(false);
        expect(res.issues.some(i => i.includes('warmup'))).toBe(true);
    });

    it('passes an empty series and an all-null series (worst case)', () => {
        expect(checkSanity([]).pass).toBe(true);
        expect(checkSanity([null, null]).pass).toBe(true);
    });
});
