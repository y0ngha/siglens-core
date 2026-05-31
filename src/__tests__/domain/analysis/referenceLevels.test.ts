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
    it('labels every level kind round', () => {
        expect(roundNumberLevels(123).every(l => l.kind === 'round')).toBe(
            true
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
});

describe('collectIndicatorLevels', () => {
    it('emits a POC level from the volume profile', () => {
        const ind = {
            volumeProfile: { poc: 95, vah: 105, val: 92, profile: [] },
            ma: {},
            ema: {},
            bollinger: [],
            keltnerChannel: [],
            donchianChannel: [],
            ichimoku: [],
            supertrend: [],
            vwap: [],
        } as unknown as IndicatorResult;
        const levels = collectIndicatorLevels(100, ind);
        expect(levels.some(l => l.kind === 'vp_poc' && l.price === 95)).toBe(
            true
        );
    });
});
