import { describe, expect, it } from 'vitest';
import {
    baseRateVerdictLabel,
    candleBaseRateKey,
    candleCardBaseRate,
    normalizeCachedBaseRate,
    patternCardBaseRate,
} from '@/domain/analysis/baseRateCards';
import {
    CANDLE_BASE_RATES,
    CANDLE_POOLED_BASE_RATE,
    PATTERN_BASE_RATES,
    PATTERN_POOLED_BASE_RATE,
    PRICE_LEVEL_BASE_RATE,
    type MeasuredBaseRate,
} from '@/domain/analysis/measuredBaseRates';

const ROW: MeasuredBaseRate = PRICE_LEVEL_BASE_RATE;

/** A stored row as JSON round-trips it, for the cache-read cases to damage one member of. */
const stored = (): Record<string, unknown> =>
    JSON.parse(JSON.stringify(ROW)) as Record<string, unknown>;

describe('candleBaseRateKey', () => {
    it.each([
        ['Bullish Engulfing', 'bullish_engulfing'],
        ['bullish-engulfing', 'bullish_engulfing'],
        ['  Hammer ', 'hammer'],
        ['dark_cloud_cover', 'dark_cloud_cover'],
    ])('%s -> %s', (name, key) => {
        expect(candleBaseRateKey(name)).toBe(key);
    });
});

describe('patternCardBaseRate', () => {
    it('is the row of the skill pattern id on daily bars', () => {
        expect(patternCardBaseRate('double_bottom', '1Day')).toBe(
            PATTERN_BASE_RATES.double_bottom
        );
    });

    it('is the pooled row for a skill with no pattern id or an unknown one', () => {
        expect(patternCardBaseRate(undefined, '1Day')).toBe(
            PATTERN_POOLED_BASE_RATE
        );
        expect(patternCardBaseRate('mystery', '1Day')).toBe(
            PATTERN_POOLED_BASE_RATE
        );
    });

    it('is null off daily bars', () => {
        expect(patternCardBaseRate('double_bottom', '1Hour')).toBeNull();
    });
});

describe('candleCardBaseRate', () => {
    it('reads a card name through the table key', () => {
        expect(candleCardBaseRate('Bullish Engulfing', '1Day')).toBe(
            CANDLE_BASE_RATES.bullish_engulfing
        );
    });

    it('is the pooled row for a name it has no row for', () => {
        expect(candleCardBaseRate('망치형', '1Day')).toBe(
            CANDLE_POOLED_BASE_RATE
        );
    });

    it('is null off daily bars', () => {
        expect(candleCardBaseRate('hammer', '15Min')).toBeNull();
    });
});

describe('baseRateVerdictLabel', () => {
    it.each([
        ['beats_placebo', 'beats placebo'],
        ['no_edge', 'no edge over placebo'],
        ['insufficient_sample', 'small sample'],
    ] as const)('%s -> %s', (verdict, label) => {
        expect(baseRateVerdictLabel(verdict)).toBe(label);
    });
});

describe('normalizeCachedBaseRate', () => {
    it('keeps a valid row as written', () => {
        expect(normalizeCachedBaseRate(stored())).toEqual(ROW);
    });

    it('keeps null: not measured is a valid stored state', () => {
        expect(normalizeCachedBaseRate(null)).toBeNull();
    });

    it.each([undefined, 'row', 7, []])('drops %j: not an object', value => {
        expect(normalizeCachedBaseRate(value)).toBeUndefined();
    });

    const damaged: readonly [string, (row: Record<string, unknown>) => void][] =
        [
            ['unknown subject', row => void (row.subject = 'other')],
            ['unknown verdict', row => void (row.verdict = 'maybe')],
            ['empty key', row => void (row.key = '')],
            ['non-integer n', row => void (row.n = 1.5)],
            ['negative n', row => void (row.n = -1)],
            ['share above 1', row => void (row.eventShare = 1.2)],
            ['share below 0', row => void (row.placeboShare = -0.1)],
            ['missing difference', row => void delete row.difference],
            [
                'non-numeric difference member',
                row =>
                    void (row.difference = {
                        mean: 'x',
                        low: 0,
                        high: 0,
                    }),
            ],
            [
                'non-numeric difference low',
                row =>
                    void (row.difference = {
                        mean: 0,
                        low: null,
                        high: 0,
                    }),
            ],
            [
                'non-numeric difference high',
                row =>
                    void (row.difference = {
                        mean: 0,
                        low: 0,
                        high: Number.NaN,
                    }),
            ],
            ['missing scope', row => void delete row.scope],
            [
                'intraday scope',
                row =>
                    void (row.scope = {
                        timeframe: '1Hour',
                        symbols: 1,
                        from: 'a',
                        to: 'b',
                    }),
            ],
            [
                'non-integer symbols',
                row =>
                    void (row.scope = {
                        timeframe: '1Day',
                        symbols: 'x',
                        from: 'a',
                        to: 'b',
                    }),
            ],
            [
                'non-string from',
                row =>
                    void (row.scope = {
                        timeframe: '1Day',
                        symbols: 1,
                        from: 5,
                        to: 'b',
                    }),
            ],
            [
                'non-string to',
                row =>
                    void (row.scope = {
                        timeframe: '1Day',
                        symbols: 1,
                        from: 'a',
                        to: 5,
                    }),
            ],
        ];

    it.each(damaged)('drops a row with %s', (_name, damage) => {
        const row = stored();
        damage(row);
        expect(normalizeCachedBaseRate(row)).toBeUndefined();
    });
});
