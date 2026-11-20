import { describe, expect, it } from 'vitest';
import {
    jaccard,
    mean,
    median,
    pairsOf,
    quantile,
    standardError,
} from '../../../../scripts/replay/stats';

describe('mean', () => {
    it('averages values', () => {
        expect(mean([1, 2, 6])).toBe(3);
    });

    it('is null for no values, not 0', () => {
        expect(mean([])).toBeNull();
    });
});

describe('standardError', () => {
    it('is the sample standard deviation over sqrt(n)', () => {
        // values 2, 4: sd = sqrt(2), se = sqrt(2) / sqrt(2) = 1
        expect(standardError([2, 4])).toBeCloseTo(1, 12);
    });

    it('is null below two values', () => {
        expect(standardError([5])).toBeNull();
        expect(standardError([])).toBeNull();
    });
});

describe('quantile and median', () => {
    it('interpolates between ranks', () => {
        expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
        expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBeCloseTo(
            9.1,
            12
        );
    });

    it('does not depend on the input order', () => {
        expect(median([9, 1, 5])).toBe(5);
    });

    it('returns the endpoints at 0 and 1', () => {
        expect(quantile([3, 1, 2], 0)).toBe(1);
        expect(quantile([3, 1, 2], 1)).toBe(3);
    });

    it('is null for no values', () => {
        expect(quantile([], 0.5)).toBeNull();
    });
});

describe('jaccard', () => {
    it('is shared over union', () => {
        expect(jaccard(['a', 'b', 'c'], ['b', 'c', 'd'])).toBe(0.5);
    });

    it('ignores duplicates', () => {
        expect(jaccard(['a', 'a'], ['a'])).toBe(1);
    });

    it('is 1 for two empty sets and 0 for disjoint ones', () => {
        expect(jaccard([], [])).toBe(1);
        expect(jaccard(['a'], ['b'])).toBe(0);
    });
});

describe('pairsOf', () => {
    it('lists each unordered pair once', () => {
        expect(pairsOf([1, 2, 3])).toEqual([
            [1, 2],
            [1, 3],
            [2, 3],
        ]);
    });

    it('is empty below two items', () => {
        expect(pairsOf([1])).toEqual([]);
    });
});
