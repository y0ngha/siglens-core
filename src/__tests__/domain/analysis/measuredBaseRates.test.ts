import { describe, expect, it } from 'vitest';
import {
    BASE_RATE_MIN_N,
    CANDLE_BASE_RATES,
    CANDLE_POOLED_BASE_RATE,
    PATTERN_BASE_RATES,
    PATTERN_POOLED_BASE_RATE,
    PRICE_LEVEL_BASE_RATE,
    measuredBaseRateFor,
    type MeasuredBaseRate,
} from '@/domain/analysis/measuredBaseRates';
import type {
    CandlePattern,
    ChartPatternId,
    MultiCandlePattern,
} from '@/domain/types';

const ALL_PATTERN_IDS: Record<ChartPatternId, true> = {
    head_and_shoulders: true,
    inverse_head_and_shoulders: true,
    double_top: true,
    double_bottom: true,
    triple_top: true,
    triple_bottom: true,
    ascending_triangle: true,
    descending_triangle: true,
    symmetrical_triangle: true,
    ascending_wedge: true,
    descending_wedge: true,
    ascending_channel: true,
    descending_channel: true,
    broadening_formation: true,
    bull_flag: true,
    bear_flag: true,
    pennant: true,
    high_tight_flag: true,
    rectangle: true,
    cup_and_handle: true,
    rounding_bottom: true,
    rounding_top: true,
};

const DIRECTIONAL_CANDLES: readonly (CandlePattern | MultiCandlePattern)[] = [
    'hammer',
    'inverted_hammer',
    'shooting_star',
    'hanging_man',
    'bullish_marubozu',
    'bearish_marubozu',
    'bullish_belt_hold',
    'bearish_belt_hold',
    'dragonfly_doji',
    'gravestone_doji',
    'bullish_engulfing',
    'bearish_engulfing',
    'morning_star',
    'evening_star',
    'three_white_soldiers',
    'three_black_crows',
    'rising_three_methods',
    'falling_three_methods',
    'bullish_three_line_strike',
    'bearish_three_line_strike',
];

const everyRow = (): readonly MeasuredBaseRate[] => [
    ...Object.values(PATTERN_BASE_RATES),
    ...Object.values(CANDLE_BASE_RATES),
    PATTERN_POOLED_BASE_RATE,
    CANDLE_POOLED_BASE_RATE,
    PRICE_LEVEL_BASE_RATE,
];

describe('measuredBaseRates (generated table)', () => {
    it('has the sample floor of the verdict rule', () => {
        expect(BASE_RATE_MIN_N).toBe(100);
    });

    it('gives every row a daily scope, shares in 0..1 and a difference that is event minus placebo', () => {
        for (const row of everyRow()) {
            expect(row.scope.timeframe).toBe('1Day');
            expect(row.scope.symbols).toBeGreaterThan(0);
            expect(row.eventShare).toBeGreaterThanOrEqual(0);
            expect(row.eventShare).toBeLessThanOrEqual(1);
            expect(row.placeboShare).toBeGreaterThanOrEqual(0);
            expect(row.placeboShare).toBeLessThanOrEqual(1);
            expect(row.difference.low).toBeLessThanOrEqual(row.difference.mean);
            expect(row.difference.mean).toBeLessThanOrEqual(
                row.difference.high
            );
            expect(row.difference.mean).toBeCloseTo(
                row.eventShare - row.placeboShare,
                4
            );
        }
    });

    it('follows the verdict rule from the stored numbers', () => {
        for (const row of everyRow()) {
            if (row.n < BASE_RATE_MIN_N) {
                expect(row.verdict).not.toBe('beats_placebo');
            }
            // The textbook direction with an interval clear of zero is necessary for a win.
            if (row.verdict === 'beats_placebo') {
                expect(row.n).toBeGreaterThanOrEqual(BASE_RATE_MIN_N);
                expect(row.difference.low).toBeGreaterThan(0);
            }
        }
        // A family below the floor carries the pooled figures and says so; an own row
        // never says it.
        for (const row of [
            ...Object.values(PATTERN_BASE_RATES),
            ...Object.values(CANDLE_BASE_RATES),
        ]) {
            expect(row.verdict === 'insufficient_sample').toBe(
                row.key === 'pooled'
            );
        }
    });

    it('carries the right subject on every row', () => {
        for (const row of Object.values(PATTERN_BASE_RATES)) {
            expect(row.subject).toBe('chart_pattern');
        }
        for (const row of Object.values(CANDLE_BASE_RATES)) {
            expect(row.subject).toBe('candle_pattern');
        }
        expect(PRICE_LEVEL_BASE_RATE.subject).toBe('price_level');
    });

    it('has only rows keyed by a real chart pattern id, own or pooled', () => {
        for (const [id, row] of Object.entries(PATTERN_BASE_RATES)) {
            expect(Object.keys(ALL_PATTERN_IDS)).toContain(id);
            expect([id, 'pooled']).toContain(row.key);
        }
    });

    it.each(Object.keys(ALL_PATTERN_IDS))(
        'gives the chart pattern %s a row on daily bars (its own, or the pooled one)',
        id => {
            const row = measuredBaseRateFor('chart_pattern', id, '1Day');
            expect(row).not.toBeNull();
            expect(row?.subject).toBe('chart_pattern');
            expect([id, 'pooled']).toContain(row?.key);
        }
    );

    it.each(DIRECTIONAL_CANDLES)(
        'gives the directional candle %s a row on daily bars (its own, or the pooled one)',
        name => {
            const row = measuredBaseRateFor('candle_pattern', name, '1Day');
            expect(row).not.toBeNull();
            expect(row?.subject).toBe('candle_pattern');
            expect([name, 'pooled']).toContain(row?.key);
        }
    );

    it('falls back to the pooled row for a key it has no row for', () => {
        expect(measuredBaseRateFor('chart_pattern', 'no_such', '1Day')).toBe(
            PATTERN_POOLED_BASE_RATE
        );
        expect(measuredBaseRateFor('candle_pattern', 'no_such', '1Day')).toBe(
            CANDLE_POOLED_BASE_RATE
        );
    });

    it('returns an own row for a family measured on enough events', () => {
        const [id, own] = Object.entries(PATTERN_BASE_RATES).find(
            ([, row]) => row.key !== 'pooled'
        ) ?? ['', undefined];
        expect(own).toBeDefined();
        expect(measuredBaseRateFor('chart_pattern', id, '1Day')).toBe(own);
    });

    it.each(['5Min', '15Min', '30Min', '1Hour', '4Hour'] as const)(
        'is not measured on %s bars: null for both subjects',
        timeframe => {
            expect(
                measuredBaseRateFor('chart_pattern', 'double_top', timeframe)
            ).toBeNull();
            expect(
                measuredBaseRateFor('candle_pattern', 'hammer', timeframe)
            ).toBeNull();
        }
    );
});
