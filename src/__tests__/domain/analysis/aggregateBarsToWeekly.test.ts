import { describe, expect, it } from 'vitest';
import { aggregateBarsToWeekly } from '@/domain/analysis/aggregateBarsToWeekly';
import type { Bar } from '@/domain/types';

/** Unix seconds for `YYYY-MM-DD` at UTC midnight, or a given UTC hour. */
const utcSeconds = (
    year: number,
    monthIndex: number,
    day: number,
    hour = 0
): number => Math.floor(Date.UTC(year, monthIndex, day, hour) / 1000);

const MONDAY_2024_01_01 = utcSeconds(2024, 0, 1);
const MONDAY_2024_01_08 = utcSeconds(2024, 0, 8);

function bar(overrides: Partial<Bar> & { time: number }): Bar {
    return {
        open: 10,
        high: 10,
        low: 10,
        close: 10,
        volume: 100,
        ...overrides,
    };
}

describe('aggregateBarsToWeekly', () => {
    it('returns [] for an empty input', () => {
        expect(aggregateBarsToWeekly([])).toEqual([]);
    });

    it('aggregates a single bar into a single week matching that bar', () => {
        const b = bar({
            time: utcSeconds(2024, 0, 1, 9),
            open: 5,
            high: 7,
            low: 4,
            close: 6,
            volume: 50,
        });
        const result = aggregateBarsToWeekly([b]);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
            time: MONDAY_2024_01_01,
            open: 5,
            high: 7,
            low: 4,
            close: 6,
            volume: 50,
        });
    });

    it('open = first bar in week, close = last bar in week, high/low = extremes, volume = sum', () => {
        const bars: Bar[] = [
            bar({
                time: utcSeconds(2024, 0, 1),
                open: 10,
                high: 12,
                low: 9,
                close: 11,
                volume: 100,
            }),
            bar({
                time: utcSeconds(2024, 0, 2),
                open: 11,
                high: 13,
                low: 10,
                close: 12,
                volume: 200,
            }),
            bar({
                time: utcSeconds(2024, 0, 3),
                open: 12,
                high: 14,
                low: 11,
                close: 13,
                volume: 150,
            }),
        ];
        const result = aggregateBarsToWeekly(bars);
        expect(result).toEqual([
            {
                time: MONDAY_2024_01_01,
                open: 10,
                high: 14,
                low: 9,
                close: 13,
                volume: 450,
            },
        ]);
    });

    it('starts a new week at Monday UTC and keeps a trailing partial week', () => {
        const bars: Bar[] = [
            bar({ time: utcSeconds(2024, 0, 1), open: 10, close: 11 }), // Mon
            bar({ time: utcSeconds(2024, 0, 7), open: 11, close: 12 }), // Sun — same ISO week
            bar({
                time: utcSeconds(2024, 0, 8),
                open: 13,
                high: 15,
                low: 12,
                close: 14,
                volume: 300,
            }), // Mon — new week, only 1 bar (partial week, still kept)
        ];
        const result = aggregateBarsToWeekly(bars);
        expect(result).toHaveLength(2);
        expect(result[0].time).toBe(MONDAY_2024_01_01);
        expect(result[0].close).toBe(12); // last bar of week 1 (Sunday)
        expect(result[1]).toEqual({
            time: MONDAY_2024_01_08,
            open: 13,
            high: 15,
            low: 12,
            close: 14,
            volume: 300,
        });
    });

    it('a Sunday bar belongs to the PRECEDING Monday-start week, not the next one', () => {
        const sunday = bar({ time: utcSeconds(2024, 0, 7), open: 1, close: 2 });
        const result = aggregateBarsToWeekly([sunday]);
        expect(result[0].time).toBe(MONDAY_2024_01_01);
    });

    it('skips a bar with a non-finite OHLC value (NaN)', () => {
        const bars: Bar[] = [
            bar({ time: utcSeconds(2024, 0, 1), open: 10, close: 11 }),
            bar({
                time: utcSeconds(2024, 0, 2),
                open: Number.NaN,
                high: 13,
                low: 10,
                close: 12,
            }),
            bar({
                time: utcSeconds(2024, 0, 3),
                open: 12,
                high: 14,
                low: 11,
                close: 13,
            }),
        ];
        const result = aggregateBarsToWeekly(bars);
        expect(result).toHaveLength(1);
        // The NaN bar's high (13) never reaches the aggregate.
        expect(result[0].high).toBe(14);
        expect(result[0].close).toBe(13);
    });

    it('skips a bar with a zero OHLC value (placeholder row)', () => {
        const bars: Bar[] = [
            bar({ time: utcSeconds(2024, 0, 1), open: 10, close: 11 }),
            bar({
                time: utcSeconds(2024, 0, 2),
                open: 0,
                high: 0,
                low: 0,
                close: 0,
            }),
        ];
        const result = aggregateBarsToWeekly(bars);
        expect(result).toHaveLength(1);
        expect(result[0].close).toBe(11); // the zero-row's close never wins
    });

    it('skips a bar with a negative OHLC value', () => {
        const bars: Bar[] = [
            bar({
                time: utcSeconds(2024, 0, 1),
                open: 10,
                high: 12,
                low: -5,
                close: 11,
            }),
        ];
        const result = aggregateBarsToWeekly(bars);
        expect(result).toEqual([]);
    });

    it('returns [] when every bar is invalid', () => {
        const bars: Bar[] = [
            bar({ time: utcSeconds(2024, 0, 1), open: 0, close: 0 }),
            bar({ time: utcSeconds(2024, 0, 2), open: Number.NaN, close: 1 }),
        ];
        expect(aggregateBarsToWeekly(bars)).toEqual([]);
    });

    it('does not mutate the input array', () => {
        const bars: Bar[] = [
            bar({ time: utcSeconds(2024, 0, 1), open: 10, close: 11 }),
        ];
        const snapshot = JSON.parse(JSON.stringify(bars));
        aggregateBarsToWeekly(bars);
        expect(bars).toEqual(snapshot);
    });

    it('produces multiple ordered weekly bars for a multi-week series', () => {
        const bars: Bar[] = [
            bar({ time: utcSeconds(2024, 0, 1), close: 1 }),
            bar({ time: utcSeconds(2024, 0, 8), close: 2 }),
            bar({ time: utcSeconds(2024, 0, 15), close: 3 }),
        ];
        const result = aggregateBarsToWeekly(bars);
        expect(result.map(w => w.close)).toEqual([1, 2, 3]);
        expect(result.map(w => w.time)).toEqual([
            MONDAY_2024_01_01,
            MONDAY_2024_01_08,
            utcSeconds(2024, 0, 15),
        ]);
    });
});
