import { describe, expect, it } from 'vitest';
import { krxTickSize, roundToKrxTick } from '@/domain/analysis/krxTick';
import {
    formatPrice,
    formatQuotedPrice,
    priceDecimalPlaces,
    priceQuoting,
    roundQuotedPrice,
    sharedPriceQuoting,
    type PriceQuoting,
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

describe('ETF/ETN tick table', () => {
    it.each([
        [1, 1],
        [1_999, 1],
        [2_000, 5],
        [4_995, 5],
        [20_000, 5],
        [40_123, 5],
        [1_234_000, 5],
    ])('%d won quotes in steps of %d', (price, tick) => {
        expect(krxTickSize(price, 'etp')).toBe(tick);
    });

    it.each([
        [1_999, 1_999],
        [1_999.4, 1_999],
        // Rounding up across the 2,000 edge lands on the edge.
        [1_999.6, 2_000],
        [40_121, 40_120],
        // Half up.
        [40_122.5, 40_125],
        [40_123, 40_125],
        [40_125, 40_125],
        [205_325, 205_325],
    ])('%d → %d', (price, rounded) => {
        expect(roundToKrxTick(price, 'etp')).toBe(rounded);
    });

    it('leaves a non-price unchanged', () => {
        expect(roundToKrxTick(0, 'etp')).toBe(0);
        expect(roundToKrxTick(-120, 'etp')).toBe(-120);
        expect(roundToKrxTick(Number.NaN, 'etp')).toBeNaN();
    });

    it('keeps the share table the default', () => {
        expect(krxTickSize(40_123)).toBe(krxTickSize(40_123, 'share'));
        expect(roundToKrxTick(40_123)).toBe(50 * Math.round(40_123 / 50));
        expect(roundToKrxTick(40_123, 'share')).not.toBe(
            roundToKrxTick(40_123, 'etp')
        );
    });
});

describe('price quoting', () => {
    it.each([
        ['USD equity', 224.566, 'USD', 'equity', { dp: 2, krxTick: null }],
        ['USD sub-unit', 0.08359, 'USD', 'equity', { dp: 5, krxTick: null }],
        ['crypto', 64_192.123, 'USD', 'crypto', { dp: 2, krxTick: null }],
        ['KRW share', 224_565, 'KRW', 'equity', { dp: 0, krxTick: 'share' }],
    ] as const)('%s', (_name, ref, currency, assetClass, expected) => {
        expect(priceQuoting(ref, currency, assetClass)).toEqual(expected);
    });

    it('carries the ETP table for a KRW listing and ignores it for any other currency', () => {
        expect(priceQuoting(40_123, 'KRW', 'equity', 'etp')).toEqual({
            dp: 0,
            krxTick: 'etp',
        });
        expect(priceQuoting(224.5, 'USD', 'equity', 'etp').krxTick).toBeNull();
        expect(priceQuoting(64_192, 'USD', 'crypto', 'etp').krxTick).toBeNull();
    });

    it('shares one quoting across a set of prices, finest decides', () => {
        expect(sharedPriceQuoting([0.995, 1.01], 'USD')).toEqual({
            dp: 4,
            krxTick: null,
        });
        expect(sharedPriceQuoting([40_123], 'KRW', 'equity', 'etp')).toEqual({
            dp: 0,
            krxTick: 'etp',
        });
    });
});

describe('price formatting at the KRX tick', () => {
    const KRW_SHARE: PriceQuoting = { dp: 0, krxTick: 'share' };
    const KRW_ETP: PriceQuoting = { dp: 0, krxTick: 'etp' };
    const USD: PriceQuoting = { dp: 2, krxTick: null };

    it('formats a KRX price at its table tick and leaves other quotings alone', () => {
        expect(formatQuotedPrice(205_325, KRW_SHARE)).toBe('205500');
        expect(formatQuotedPrice(40_123, KRW_SHARE)).toBe('40100');
        expect(formatQuotedPrice(40_123, KRW_ETP)).toBe('40125');
        expect(formatQuotedPrice(205.325, USD)).toBe('205.32');
        expect(formatQuotedPrice(null, KRW_SHARE)).toBe('N/A');
        expect(formatQuotedPrice(undefined, USD)).toBe('N/A');
        expect(formatPrice(224_565, 'KRW')).toBe('224500');
        expect(formatPrice(40_123, 'KRW', 'etp')).toBe('40125');
        expect(formatPrice(224.566, 'USD')).toBe('224.57');
    });

    it('rounds a quoted price only when the quoting names a KRX table', () => {
        expect(roundQuotedPrice(205_325, KRW_SHARE)).toBe(205_500);
        expect(roundQuotedPrice(40_122.5, KRW_ETP)).toBe(40_125);
        expect(roundQuotedPrice(205.325, USD)).toBe(205.325);
        // Whole-number decimals alone no longer imply a KRX price.
        expect(roundQuotedPrice(205_325, { dp: 0, krxTick: null })).toBe(
            205_325
        );
    });

    it('only a KRW listing resolves to whole-won decimals', () => {
        const prices = [1e-8, 0.0004, 0.08, 0.5, 0.999, 1, 2.5, 99, 64_192];
        for (const p of prices) {
            for (const assetClass of ['equity', 'crypto'] as const) {
                expect(priceDecimalPlaces(p, 'USD', assetClass)).not.toBe(0);
            }
            expect(priceDecimalPlaces(p, 'KRW')).toBe(0);
        }
    });
});
