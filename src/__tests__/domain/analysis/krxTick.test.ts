import { describe, expect, it } from 'vitest';
import { krxTickSize, roundToKrxTick } from '@/domain/analysis/krxTick';
import {
    formatPrice,
    formatPriceAtDp,
    KRW_PRICE_DECIMAL_PLACES,
    priceDecimalPlaces,
} from '@/domain/analysis/promptFormat';

describe('krxTickSize', () => {
    it.each([
        [1_999, 1],
        [2_000, 5],
        [4_995, 5],
        [5_000, 10],
        [19_990, 10],
        [20_000, 50],
        [49_950, 50],
        [50_000, 100],
        [199_900, 100],
        [200_000, 500],
        [499_500, 500],
        [500_000, 1_000],
        [1_234_000, 1_000],
    ])('%d won quotes in steps of %d', (price, tick) => {
        expect(krxTickSize(price)).toBe(tick);
    });
});

describe('roundToKrxTick', () => {
    it.each([
        // The 2026-10-18 screenshot's computed levels.
        [205_325, 205_500],
        [224_565, 224_500],
        [271_192.31, 271_000],
        [56_663, 56_700],
        // Half up; a tick-aligned price is unchanged.
        [240_250, 240_500],
        [240_300, 240_500],
        [215_000, 215_000],
        [1_234.4, 1_234],
        [3_337, 3_335],
        [12_345, 12_350],
        [33_333, 33_350],
        // Rounding up across a band edge lands on the edge.
        [1_999.6, 2_000],
        [19_996, 20_000],
        [499_800, 500_000],
    ])('%d → %d', (price, rounded) => {
        expect(roundToKrxTick(price)).toBe(rounded);
    });

    it('leaves a non-price unchanged', () => {
        expect(roundToKrxTick(0)).toBe(0);
        expect(roundToKrxTick(-120)).toBe(-120);
        expect(roundToKrxTick(Number.NaN)).toBeNaN();
    });
});

describe('price formatting at the KRX tick', () => {
    it('formats a KRW-precision price at its tick and leaves other precisions alone', () => {
        expect(formatPriceAtDp(205_325, KRW_PRICE_DECIMAL_PLACES)).toBe(
            '205500'
        );
        expect(formatPriceAtDp(205.325, 2)).toBe('205.32');
        expect(formatPriceAtDp(null, KRW_PRICE_DECIMAL_PLACES)).toBe('N/A');
        expect(formatPrice(224_565, 'KRW')).toBe('224500');
        expect(formatPrice(224.566, 'USD')).toBe('224.57');
    });

    it('only a KRW listing resolves to the KRW precision — the invariant formatPriceAtDp relies on', () => {
        const prices = [1e-8, 0.0004, 0.08, 0.5, 0.999, 1, 2.5, 99, 64_192];
        for (const p of prices) {
            for (const assetClass of ['equity', 'crypto'] as const) {
                expect(priceDecimalPlaces(p, 'USD', assetClass)).not.toBe(
                    KRW_PRICE_DECIMAL_PLACES
                );
            }
            expect(priceDecimalPlaces(p, 'KRW')).toBe(KRW_PRICE_DECIMAL_PLACES);
        }
        expect(priceDecimalPlaces(null, 'USD')).not.toBe(
            KRW_PRICE_DECIMAL_PLACES
        );
    });
});
