import { describe, expect, expectTypeOf, it } from 'vitest';
import {
    COMPUTED_CARD_KINDS,
    CYCLE_CARD_KINDS,
    INDICATOR_CARD_BASIS,
    INDICATOR_CARD_KINDS,
    INDICATOR_CARD_STATE_VALUES,
    INDICATOR_CARD_VALUE_KEYS,
    isCycleCardKind,
    parseComputedCardKind,
} from '@/domain/analysis/computedCardKinds';
import type {
    ComputedCardKind,
    CycleCardKind,
    IndicatorCardKind,
    IndicatorCardStates,
    IndicatorCardValues,
    IndicatorReading,
} from '@/domain/types';

const sorted = (xs: readonly string[]): string[] => [...xs].toSorted();

describe('computed card kinds', () => {
    it('lists 36 indicator kinds and 2 cycle kinds, each once, in a stable order', () => {
        expect(INDICATOR_CARD_KINDS).toHaveLength(36);
        expect(CYCLE_CARD_KINDS).toEqual(['ma_cycle', 'macd_cycle']);
        expect(COMPUTED_CARD_KINDS).toHaveLength(38);
        expect(new Set(COMPUTED_CARD_KINDS).size).toBe(38);
        expect(COMPUTED_CARD_KINDS).toEqual([
            ...INDICATOR_CARD_KINDS,
            ...CYCLE_CARD_KINDS,
        ]);
        expect(COMPUTED_CARD_KINDS.slice(0, 6)).toEqual([
            'ma',
            'ema',
            'adx',
            'atr',
            'obv',
            'volume_profile',
        ]);
    });

    it('names every member of the union, and nothing else (the per-kind tables are exhaustive records)', () => {
        const expected = sorted(Object.keys(INDICATOR_CARD_BASIS));
        expect(sorted(INDICATOR_CARD_KINDS)).toEqual(expected);
        expect(sorted(Object.keys(INDICATOR_CARD_VALUE_KEYS))).toEqual(
            expected
        );
        expect(sorted(Object.keys(INDICATOR_CARD_STATE_VALUES))).toEqual(
            expected
        );
        expectTypeOf<
            (typeof COMPUTED_CARD_KINDS)[number]
        >().toEqualTypeOf<ComputedCardKind>();
        expectTypeOf<
            (typeof INDICATOR_CARD_KINDS)[number]
        >().toEqualTypeOf<IndicatorCardKind>();
        expectTypeOf<
            (typeof CYCLE_CARD_KINDS)[number]
        >().toEqualTypeOf<CycleCardKind>();
    });

    it('gives every kind a state union and a value-key union, and a reading is the union over kinds', () => {
        expectTypeOf<
            keyof IndicatorCardStates
        >().toEqualTypeOf<IndicatorCardKind>();
        expectTypeOf<
            keyof IndicatorCardValues
        >().toEqualTypeOf<IndicatorCardKind>();
        expectTypeOf<
            IndicatorReading['kind']
        >().toEqualTypeOf<IndicatorCardKind>();
        expect(INDICATOR_CARD_VALUE_KEYS.ma).toEqual([
            'close',
            'ma5',
            'ma20',
            'ma60',
            'ma120',
            'ma200',
        ]);
    });

    it('has a state list for every kind except the event kinds, whose state is a fired signal', () => {
        const events = INDICATOR_CARD_KINDS.filter(
            kind => INDICATOR_CARD_STATE_VALUES[kind] === null
        );
        expect(sorted(events)).toEqual(
            sorted(
                INDICATOR_CARD_KINDS.filter(
                    k => INDICATOR_CARD_BASIS[k] === 'event'
                )
            )
        );
        expect(events).toHaveLength(11);
        expect(
            INDICATOR_CARD_KINDS.filter(
                k => INDICATOR_CARD_BASIS[k] === 'always_on'
            )
        ).toEqual(['ma', 'ema', 'adx', 'atr', 'obv', 'volume_profile']);
    });

    it('parses a frontmatter value to a kind and drops anything else', () => {
        expect(parseComputedCardKind('rsi')).toBe('rsi');
        expect(parseComputedCardKind('macd_cycle')).toBe('macd_cycle');
        expect(parseComputedCardKind('RSI')).toBeUndefined();
        expect(parseComputedCardKind('')).toBeUndefined();
        expect(parseComputedCardKind(undefined)).toBeUndefined();
        expect(parseComputedCardKind(3)).toBeUndefined();
    });

    it('tells the two cycle kinds from the indicator kinds', () => {
        expect(isCycleCardKind('ma_cycle')).toBe(true);
        expect(isCycleCardKind('macd_cycle')).toBe(true);
        expect(isCycleCardKind('macd')).toBe(false);
    });
});
