import { describe, expect, it } from 'vitest';
import {
    normalizeHigherTimeframeReading,
    normalizeMarketBackdropReading,
} from '@/domain/analysis/normalizeHigherTimeframe';
import type {
    HigherTimeframeReading,
    MarketBackdropReading,
} from '@/domain/types';

const reading: HigherTimeframeReading = {
    kind: 'weekly',
    trend: 'bullish',
    slopeAtr: 1.62,
    rsi14: 61.2,
    closeVsMa50Pct: 12.4,
    lastBarInProgress: true,
    bars: 260,
    alignment: 'aligned',
};

const backdrop: MarketBackdropReading = {
    label: 'S&P 500 (SPY)',
    trend: 'bullish',
    closeVsMa200Pct: 6.2,
    endDate: '2026-11-20',
    relative: [
        { sessions: 20, symbolPct: 4.1, benchmarkPct: 1.3 },
        { sessions: 60, symbolPct: 9.8, benchmarkPct: 5 },
    ],
};

/** A copy of `value` with `key` replaced (or removed when `replacement` is `undefined`). */
function withMember<T extends object>(
    value: T,
    key: keyof T,
    replacement: unknown
): unknown {
    const { [key]: _dropped, ...rest } = value;
    return replacement === undefined ? rest : { ...rest, [key]: replacement };
}

describe('normalizeHigherTimeframeReading', () => {
    it('keeps a valid stored reading as is', () => {
        expect(normalizeHigherTimeframeReading(reading)).toEqual(reading);
    });

    it('keeps the not-measurable form: null trend and slope, no alignment', () => {
        const unmeasurable = {
            ...reading,
            trend: null,
            slopeAtr: null,
            alignment: null,
            closeVsMa50Pct: null,
            lastBarInProgress: false,
            bars: 12,
        };
        expect(normalizeHigherTimeframeReading(unmeasurable)).toEqual(
            unmeasurable
        );
    });

    it.each([
        ['not an object', 'weekly'],
        ['null', null],
        ['an array', [reading]],
    ])('drops %s', (_name, value) => {
        expect(normalizeHigherTimeframeReading(value)).toBeUndefined();
    });

    it.each([
        ['an unknown kind', withMember(reading, 'kind', 'yearly')],
        ['a missing kind', withMember(reading, 'kind', undefined)],
        ['an unknown trend', withMember(reading, 'trend', 'sideways')],
        ['a missing trend', withMember(reading, 'trend', undefined)],
        ['a non-finite slope', withMember(reading, 'slopeAtr', Number.NaN)],
        ['a missing slope', withMember(reading, 'slopeAtr', undefined)],
        ['a string RSI', withMember(reading, 'rsi14', '61.2')],
        ['a missing RSI', withMember(reading, 'rsi14', undefined)],
        [
            'a missing distance',
            withMember(reading, 'closeVsMa50Pct', undefined),
        ],
        [
            'a string progress flag',
            withMember(reading, 'lastBarInProgress', 'true'),
        ],
        ['a negative bar count', withMember(reading, 'bars', -1)],
        ['a fractional bar count', withMember(reading, 'bars', 2.5)],
        ['an unknown alignment', withMember(reading, 'alignment', 'opposite')],
        ['a missing alignment', withMember(reading, 'alignment', undefined)],
    ])('drops a reading with %s whole, never coerced', (_name, value) => {
        expect(normalizeHigherTimeframeReading(value)).toBeUndefined();
    });

    it('drops a null trend that still carries a slope, and the reverse', () => {
        expect(
            normalizeHigherTimeframeReading({ ...reading, trend: null })
        ).toBeUndefined();
        expect(
            normalizeHigherTimeframeReading({ ...reading, slopeAtr: null })
        ).toBeUndefined();
    });

    it('drops an alignment on a trend that was not measured', () => {
        expect(
            normalizeHigherTimeframeReading({
                ...reading,
                trend: null,
                slopeAtr: null,
            })
        ).toBeUndefined();
    });

    it('accepts a zero bar count (an empty series)', () => {
        expect(
            normalizeHigherTimeframeReading({
                ...reading,
                trend: null,
                slopeAtr: null,
                alignment: null,
                bars: 0,
            })?.bars
        ).toBe(0);
    });
});

describe('normalizeMarketBackdropReading', () => {
    it('keeps a valid stored reading as is', () => {
        expect(normalizeMarketBackdropReading(backdrop)).toEqual(backdrop);
    });

    it('keeps null members: no trend, no distance, no shared date, no change', () => {
        const sparse: MarketBackdropReading = {
            label: 'KOSPI',
            trend: null,
            closeVsMa200Pct: null,
            endDate: null,
            relative: [
                { sessions: 20, symbolPct: null, benchmarkPct: null },
                { sessions: 60, symbolPct: null, benchmarkPct: null },
            ],
        };
        expect(normalizeMarketBackdropReading(sparse)).toEqual(sparse);
    });

    it.each([
        ['not an object', 'SPY'],
        ['null', null],
        ['an empty label', { ...backdrop, label: '' }],
        ['a missing label', withMember(backdrop, 'label', undefined)],
        ['an unknown trend', { ...backdrop, trend: 'up' }],
        ['a missing trend', withMember(backdrop, 'trend', undefined)],
        ['a non-finite distance', { ...backdrop, closeVsMa200Pct: Infinity }],
        [
            'a missing distance',
            withMember(backdrop, 'closeVsMa200Pct', undefined),
        ],
        [
            'a date with a time',
            { ...backdrop, endDate: '2026-11-20T00:00:00Z' },
        ],
        ['a missing date', withMember(backdrop, 'endDate', undefined)],
        ['no changes', { ...backdrop, relative: [] }],
        ['changes that are not an array', { ...backdrop, relative: 'x' }],
        ['one window only', { ...backdrop, relative: [backdrop.relative[0]] }],
        [
            'a repeated window',
            {
                ...backdrop,
                relative: [backdrop.relative[0], backdrop.relative[0]],
            },
        ],
        [
            'an unconfigured window',
            {
                ...backdrop,
                relative: [
                    backdrop.relative[0],
                    { sessions: 10, symbolPct: 1, benchmarkPct: 1 },
                ],
            },
        ],
        [
            'a malformed change',
            {
                ...backdrop,
                relative: [
                    backdrop.relative[0],
                    { sessions: 60, symbolPct: '9.8', benchmarkPct: 5 },
                ],
            },
        ],
        [
            'a change that is not an object',
            { ...backdrop, relative: [backdrop.relative[0], 60] },
        ],
    ])('drops a backdrop with %s whole', (_name, value) => {
        expect(normalizeMarketBackdropReading(value)).toBeUndefined();
    });
});
