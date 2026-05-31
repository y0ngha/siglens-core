import { describe, expect, it } from 'vitest';
import { isUsablePrice, lastOf } from '@/domain/analysis/analysisUtils';

describe('lastOf', () => {
    it('returns the last element', () => {
        expect(lastOf([1, 2, 3])).toBe(3);
    });
    it('returns null for an empty array', () => {
        expect(lastOf([])).toBeNull();
    });
});

describe('isUsablePrice', () => {
    it('accepts finite positive prices', () => {
        expect(isUsablePrice(10)).toBe(true);
    });
    it('rejects zero, negatives and non-finite prices', () => {
        expect(isUsablePrice(0)).toBe(false);
        expect(isUsablePrice(-1)).toBe(false);
        expect(isUsablePrice(Number.NaN)).toBe(false);
        expect(isUsablePrice(Number.POSITIVE_INFINITY)).toBe(false);
    });
});
