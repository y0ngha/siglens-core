import { describe, expect, it } from 'vitest';
import {
    meanBarRangePercent,
    roundNumberLevels,
    splitBySide,
    collectIndicatorLevels,
    lastFiniteNumber,
} from '@/domain/analysis/referenceLevels';
import { MAX_REFERENCE_LEVELS_PER_SIDE } from '@/domain/analysis/marketReferenceConstants';
import type { Bar, IndicatorResult, ReferenceLevel } from '@/domain/types';

const lvl = (price: number, currentPrice = 100): ReferenceLevel => ({
    price,
    label: `L${price}`,
    kind: 'ma',
    distancePercent: ((price - currentPrice) / currentPrice) * 100,
});

/** Spacing between consecutive round levels for a price. */
const stepAt = (price: number): number => {
    const prices = roundNumberLevels(price)
        .map(l => l.price)
        .toSorted((a, b) => a - b);
    return Number((prices[1] - prices[0]).toPrecision(6));
};

describe('roundNumberLevels', () => {
    it('steps by the smallest 1/2.5/5×10ⁿ at or above 2% of price', () => {
        expect(stepAt(123)).toBe(2.5);
        expect(stepAt(3.2)).toBe(0.1);
        expect(stepAt(523)).toBe(25);
        expect(stepAt(320)).toBe(10);
    });
    it('has no seam at the old tier boundaries', () => {
        // The tier table stepped 0.025 at 0.99 but 0.5 at 1.00, and 10 at 1,000 but 25 above.
        expect(stepAt(1)).toBe(stepAt(0.99));
        expect(stepAt(1000)).toBe(stepAt(1000.01));
    });
    it('labels levels in plain decimal notation at the step precision', () => {
        const tiny = roundNumberLevels(0.000000125).map(l => l.label);
        expect(tiny.every(label => !label.includes('e'))).toBe(true);
        expect(roundNumberLevels(123).map(l => l.label)).toContain(
            'Round 122.5'
        );
        expect(roundNumberLevels(77107).map(l => l.label)).toContain(
            'Round 77500'
        );
        expect(roundNumberLevels(0.08359).map(l => l.label)).toContain(
            'Round 0.0825'
        );
    });
    it('labels every level kind round', () => {
        expect(roundNumberLevels(123).every(l => l.kind === 'round')).toBe(
            true
        );
    });
    it('returns no levels for a non-finite or non-positive price', () => {
        expect(roundNumberLevels(0)).toEqual([]);
        expect(roundNumberLevels(Number.NaN)).toEqual([]);
    });
    it('skips emitted levels that would be non-positive', () => {
        // base near zero: the lowest candidate index would land at/under 0
        const prices = roundNumberLevels(0.6).map(l => l.price);
        expect(prices.every(p => p > 0)).toBe(true);
    });
    it('scales the step to ~2% of price above 1,000 instead of a flat 10', () => {
        // A flat 10 put `Round 77110` 0.00% from BTC and `Round 269510` next to a KRX price.
        const btc = roundNumberLevels(77107).map(l => l.price);
        expect(btc).toContain(75000);
        expect(btc).toContain(77500);
        expect(btc).not.toContain(77110);
        const krw = roundNumberLevels(269500).map(l => l.price);
        expect(krw).toContain(260000);
        expect(krw).toContain(270000);
        expect(krw).not.toContain(269510);
    });
    it('scales the step below 1 so sub-unit assets get levels near the price', () => {
        const doge = roundNumberLevels(0.08359).map(l => l.price);
        expect(doge).toContain(0.0825);
        expect(doge).toContain(0.085);
        const shibPrice = 0.00000507;
        const shib = roundNumberLevels(shibPrice).map(l => l.price);
        expect(shib.length).toBeGreaterThan(0);
        expect(
            shib.every(p => p > 0 && Math.abs(p - shibPrice) / shibPrice < 0.15)
        ).toBe(true);
    });
    it('drops the trailing decimal for whole-mantissa steps (1x/5x10ⁿ)', () => {
        // 250 -> step 5 (mantissa 5, whole): dp should be 0, not the 1 used for 2.5x steps.
        expect(stepAt(250)).toBe(5);
        expect(roundNumberLevels(250).map(l => l.label)).toContain('Round 250');
        // 50 -> step 1 (mantissa 1, whole).
        expect(stepAt(50)).toBe(1);
        expect(roundNumberLevels(50).map(l => l.label)).toContain('Round 50');
        // 0.25 -> step 0.005 (mantissa 5, whole, sub-unit): decimals follow the step's own
        // precision (3dp), not the fixed 4dp a 2.5x step like 0.0825's gets.
        expect(stepAt(0.25)).toBe(0.005);
        expect(roundNumberLevels(0.25).map(l => l.label)).toContain(
            'Round 0.250'
        );
    });
});

describe('splitBySide', () => {
    it('puts levels below price into support, above into resistance, nearest-first', () => {
        const out = splitBySide([lvl(90), lvl(80), lvl(110), lvl(120)], 100);
        expect(out.support.map(l => l.price)).toEqual([90, 80]);
        expect(out.resistance.map(l => l.price)).toEqual([110, 120]);
    });
    it('dedupes near-equal prices', () => {
        const out = splitBySide([lvl(90), lvl(90.02)], 100);
        expect(out.support).toHaveLength(1);
    });
    it('caps each side at MAX_REFERENCE_LEVELS_PER_SIDE', () => {
        const count = MAX_REFERENCE_LEVELS_PER_SIDE + 4;
        const support = Array.from({ length: count }, (_, i) => lvl(90 - i));
        const resistance = Array.from({ length: count }, (_, i) =>
            lvl(110 + i)
        );
        const out = splitBySide([...support, ...resistance], 100);
        expect(out.support).toHaveLength(MAX_REFERENCE_LEVELS_PER_SIDE);
        expect(out.resistance).toHaveLength(MAX_REFERENCE_LEVELS_PER_SIDE);
    });
    it('flags nothing and adds no atPrice key without a band', () => {
        const out = splitBySide([lvl(99.9), lvl(90)], 100);
        expect(out.support.every(l => !('atPrice' in l))).toBe(true);
    });
    it('keeps the cap for levels beyond the band so at-price clusters cannot fill it', () => {
        // Six at-price levels used to take every slot, leaving the risk:reward block no
        // support beyond noise on that side.
        const atPrice = [99.95, 99.8, 99.65, 99.5, 99.35, 99.2].map(p =>
            lvl(p)
        );
        const beyond = Array.from({ length: 8 }, (_, i) => lvl(95 - i));
        const out = splitBySide([...atPrice, ...beyond], 100, 1);

        const flagged = out.support.filter(l => l.atPrice);
        expect(flagged.map(l => l.price)).toEqual([99.95, 99.8]);
        const clear = out.support.filter(l => !l.atPrice);
        expect(clear).toHaveLength(MAX_REFERENCE_LEVELS_PER_SIDE);
        expect(clear[0].price).toBe(95);
    });
});

describe('meanBarRangePercent', () => {
    const bar = (high: number, low: number, close: number): Bar => ({
        time: 0,
        open: close,
        high,
        low,
        close,
        volume: 1,
    });

    it('averages the high–low range in percent of close', () => {
        expect(
            meanBarRangePercent([bar(102, 98, 100), bar(101, 99, 100)])
        ).toBe(3);
    });
    it('skips unusable bars and returns 0 when none remain', () => {
        expect(meanBarRangePercent([bar(102, 98, 0)])).toBe(0);
        expect(meanBarRangePercent([])).toBe(0);
    });

    it('excludes a bar with an unusable open even when close/high/low are fine (reuses hasUsablePrices)', () => {
        // A wide, distinct high/low on the bad-open bar makes an accidental
        // inclusion visible in the mean instead of coincidentally matching.
        const badZeroOpen: Bar = {
            time: 0,
            open: 0,
            high: 110,
            low: 90,
            close: 100,
            volume: 1,
        };
        const badNaNOpen: Bar = {
            time: 0,
            open: Number.NaN,
            high: 110,
            low: 90,
            close: 100,
            volume: 1,
        };
        const good = bar(102, 98, 100); // range% = 4
        expect(meanBarRangePercent([badZeroOpen, good])).toBe(4);
        expect(meanBarRangePercent([badNaNOpen, good])).toBe(4);
    });
});

describe('collectIndicatorLevels', () => {
    const fullIndicators = (): IndicatorResult =>
        ({
            volumeProfile: { poc: 95, vah: 105, val: 92, profile: [] },
            ma: { 20: [100, 99], 50: [98, 97], 200: [80, 81] },
            ema: { 9: [101, 102], 20: [100, 100], 60: [90, 91] },
            bollinger: [{ upper: 130, lower: 70, middle: 100 }],
            keltnerChannel: [{ upper: 128, lower: 72, middle: 100 }],
            donchianChannel: [{ upper: 135, lower: 65, middle: 100 }],
            ichimoku: [{ senkouA: 110, senkouB: 88 }],
            supertrend: [{ supertrend: 96 }],
            vwap: [99, 98],
        }) as unknown as IndicatorResult;

    it('emits a POC level from the volume profile', () => {
        const levels = collectIndicatorLevels(100, fullIndicators());
        expect(levels.some(l => l.kind === 'vp_poc' && l.price === 95)).toBe(
            true
        );
    });

    it('emits bollinger/keltner/donchian/ichimoku/supertrend/vwap levels', () => {
        const kinds = new Set(
            collectIndicatorLevels(100, fullIndicators()).map(l => l.kind)
        );
        for (const k of [
            'bollinger',
            'keltner',
            'donchian',
            'ichimoku',
            'supertrend',
            'vwap',
        ]) {
            expect(kinds.has(k as ReferenceLevel['kind'])).toBe(true);
        }
    });

    it('includes only the requested MA/EMA subset', () => {
        const levels = collectIndicatorLevels(100, fullIndicators(), {
            maPeriods: [20],
            emaPeriods: [9],
        });
        const labels = levels.map(l => l.label);
        expect(labels).toContain('MA20');
        expect(labels).not.toContain('MA50');
        expect(labels).toContain('EMA9');
        expect(labels).not.toContain('EMA60');
    });

    it('skips MA/EMA periods that are absent from the suite', () => {
        const levels = collectIndicatorLevels(100, fullIndicators(), {
            maPeriods: [999],
            emaPeriods: [999],
        });
        expect(levels.some(l => l.kind === 'ma' || l.kind === 'ema')).toBe(
            false
        );
    });

    it('honours a windowVp override and skips POC when override is null', () => {
        const overridden = collectIndicatorLevels(100, fullIndicators(), {
            volumeProfile: { poc: 50, vah: 55, val: 45, profile: [] },
        });
        expect(
            overridden.some(l => l.kind === 'vp_poc' && l.price === 50)
        ).toBe(true);
        const none = collectIndicatorLevels(100, fullIndicators(), {
            volumeProfile: null,
        });
        expect(none.some(l => l.kind === 'vp_poc')).toBe(false);
    });

    it('defaults to all present MA/EMA periods when no overrides given', () => {
        const labels = collectIndicatorLevels(100, fullIndicators()).map(
            l => l.label
        );
        expect(labels).toContain('MA20');
        expect(labels).toContain('MA50');
        expect(labels).toContain('EMA60');
    });
});

describe('lastFiniteNumber', () => {
    it('returns the last finite number', () =>
        expect(lastFiniteNumber([1, 2, 3])).toBe(3));
    it('skips null values', () =>
        expect(lastFiniteNumber([1, null, 3])).toBe(3));
    it('skips non-finite values', () =>
        expect(lastFiniteNumber([1, Infinity, NaN, 2])).toBe(2));
    it('returns null for an empty array', () =>
        expect(lastFiniteNumber([])).toBeNull());
    it('returns null when all values are null/non-finite', () =>
        expect(lastFiniteNumber([null, Infinity])).toBeNull());
});
