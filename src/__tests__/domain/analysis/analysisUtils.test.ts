import { describe, expect, it } from 'vitest';
import {
    hasUsablePrices,
    isUsablePrice,
    lastOf,
} from '@/domain/analysis/analysisUtils';

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

describe('hasUsablePrices', () => {
    const bar = {
        time: 1,
        open: 10,
        high: 11,
        low: 9,
        close: 10.5,
        volume: 100,
    };

    it('accepts a bar whose OHLC are all finite and positive', () => {
        expect(hasUsablePrices(bar)).toBe(true);
    });

    it('rejects a Yahoo-style placeholder with zero open/high/low', () => {
        expect(hasUsablePrices({ ...bar, open: 0, high: 0, low: 0 })).toBe(
            false
        );
    });

    it('rejects any single non-finite or non-positive price', () => {
        for (const field of ['open', 'high', 'low', 'close'] as const) {
            expect(hasUsablePrices({ ...bar, [field]: Number.NaN })).toBe(
                false
            );
            expect(hasUsablePrices({ ...bar, [field]: -1 })).toBe(false);
        }
    });

    it('does not judge volume', () => {
        expect(hasUsablePrices({ ...bar, volume: 0 })).toBe(true);
    });
});
