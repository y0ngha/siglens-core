import { describe, expect, it } from 'vitest';
import { percentile } from '@/domain/indicators/fearGreed/percentile';

describe('percentile', () => {
    it('returns 50 for empty sample', () => {
        expect(percentile(0, [])).toBe(50);
    });
    it('returns 0 when value is below all samples', () => {
        expect(percentile(-1, [0, 1, 2, 3])).toBe(0);
    });
    it('returns 100 when value is above all samples', () => {
        expect(percentile(100, [0, 1, 2, 3])).toBe(100);
    });
    it('returns proportion strictly below value', () => {
        // sample [0,1,2,3], value=2 → 2 below(0,1) / 4 = 50
        expect(percentile(2, [0, 1, 2, 3])).toBe(50);
    });
    it('handles unsorted input', () => {
        expect(percentile(2, [3, 1, 0, 2])).toBe(50);
    });
    it('returns 0 for value equal to the sole element of single-element sample (strict <)', () => {
        expect(percentile(5, [5])).toBe(0);
    });
    it('returns 100 when value is above the sole element of single-element sample', () => {
        expect(percentile(10, [5])).toBe(100);
    });
    it('returns 0 when sample is all duplicates of value (strict-less-than semantics)', () => {
        expect(percentile(2, [2, 2, 2])).toBe(0);
    });
});
