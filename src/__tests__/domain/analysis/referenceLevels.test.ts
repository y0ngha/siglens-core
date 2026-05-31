import { describe, expect, it } from 'vitest';
import {
    roundNumberLevels,
    splitBySide,
    collectIndicatorLevels,
} from '@/domain/analysis/referenceLevels';
import type { IndicatorResult, ReferenceLevel } from '@/domain/types';

const lvl = (price: number): ReferenceLevel => ({
    price,
    label: `L${price}`,
    kind: 'ma',
    distancePercent: 0,
});

describe('roundNumberLevels', () => {
    it('uses $5 increments in the 50–200 tier', () => {
        const prices = roundNumberLevels(123)
            .map(l => l.price)
            .sort((a, b) => a - b);
        expect(prices).toContain(120);
        expect(prices).toContain(125);
    });
    it('uses $0.50 increments under $5', () => {
        const prices = roundNumberLevels(3.2).map(l => l.price);
        expect(prices).toContain(3);
        expect(prices).toContain(3.5);
    });
    it('uses $10 increments above $200', () => {
        const prices = roundNumberLevels(523)
            .map(l => l.price)
            .sort((a, b) => a - b);
        expect(prices).toContain(520);
        expect(prices).toContain(530);
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
        const support = Array.from({ length: 10 }, (_, i) => lvl(90 - i));
        const resistance = Array.from({ length: 10 }, (_, i) => lvl(110 + i));
        const out = splitBySide([...support, ...resistance], 100);
        expect(out.support).toHaveLength(6);
        expect(out.resistance).toHaveLength(6);
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
