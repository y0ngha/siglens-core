import { describe, expect, it } from 'vitest';
import { maxOf, minOf } from '@/domain/extent';

describe('minOf / maxOf', () => {
    it('returns the smallest and largest value', () => {
        expect(minOf([3, -1, 2])).toBe(-1);
        expect(maxOf([3, -1, 2])).toBe(3);
    });

    it('matches Math.min()/Math.max() on an empty list', () => {
        expect(minOf([])).toBe(Infinity);
        expect(maxOf([])).toBe(-Infinity);
    });

    it('propagates NaN like the spread form', () => {
        expect(minOf([1, Number.NaN, 2])).toBeNaN();
        expect(maxOf([1, Number.NaN, 2])).toBeNaN();
    });

    it('handles a list too large to spread into a call', () => {
        const big = Array.from({ length: 500_000 }, (_, i) => i);
        expect(minOf(big)).toBe(0);
        expect(maxOf(big)).toBe(499_999);
    });
});
