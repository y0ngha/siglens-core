import { describe, expect, it } from 'vitest';
import { aggregateBarsToMonthly } from '@/domain/analysis/aggregateBarsToMonthly';
import type { Bar } from '@/domain/types';

const utcSeconds = (
    year: number,
    monthIndex: number,
    day: number,
    hour = 0
): number => Math.floor(Date.UTC(year, monthIndex, day, hour) / 1000);

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

describe('aggregateBarsToMonthly', () => {
    it('returns [] for an empty input', () => {
        expect(aggregateBarsToMonthly([])).toEqual([]);
    });

    it('folds the days of one month into one bar stamped on the 1st', () => {
        const out = aggregateBarsToMonthly([
            bar({
                time: utcSeconds(2024, 0, 2),
                open: 5,
                high: 6,
                low: 4,
                close: 5.5,
                volume: 10,
            }),
            bar({
                time: utcSeconds(2024, 0, 15),
                open: 5.5,
                high: 9,
                low: 5,
                close: 8,
                volume: 20,
            }),
            bar({
                time: utcSeconds(2024, 0, 31),
                open: 8,
                high: 8.5,
                low: 3,
                close: 7,
                volume: 30,
            }),
        ]);
        expect(out).toEqual([
            {
                time: utcSeconds(2024, 0, 1),
                open: 5,
                high: 9,
                low: 3,
                close: 7,
                volume: 60,
            },
        ]);
    });

    it('starts a new bar at each calendar-month boundary, keeping the partial last month', () => {
        const out = aggregateBarsToMonthly([
            bar({ time: utcSeconds(2024, 0, 31), close: 1 }),
            bar({ time: utcSeconds(2024, 1, 1), close: 2 }),
            bar({ time: utcSeconds(2024, 1, 29), close: 3 }),
            bar({ time: utcSeconds(2024, 2, 1), close: 4 }),
        ]);
        expect(out.map(b => [b.time, b.close])).toEqual([
            [utcSeconds(2024, 0, 1), 1],
            [utcSeconds(2024, 1, 1), 3],
            [utcSeconds(2024, 2, 1), 4],
        ]);
    });

    it('rolls over the year', () => {
        const out = aggregateBarsToMonthly([
            bar({ time: utcSeconds(2023, 11, 29) }),
            bar({ time: utcSeconds(2024, 0, 2) }),
        ]);
        expect(out.map(b => b.time)).toEqual([
            utcSeconds(2023, 11, 1),
            utcSeconds(2024, 0, 1),
        ]);
    });

    it('skips bars without usable prices so they never set a high or low', () => {
        const out = aggregateBarsToMonthly([
            bar({ time: utcSeconds(2024, 0, 2), high: 12, low: 8 }),
            bar({ time: utcSeconds(2024, 0, 3), high: Number.NaN, low: 0 }),
            bar({
                time: utcSeconds(2024, 0, 4),
                open: 0,
                high: 0,
                low: 0,
                close: 0,
            }),
        ]);
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ high: 12, low: 8, volume: 100 });
    });

    it('does not mutate the input', () => {
        const input = [bar({ time: utcSeconds(2024, 0, 2) })];
        const copy = structuredClone(input);
        aggregateBarsToMonthly(input);
        expect(input).toEqual(copy);
    });
});
