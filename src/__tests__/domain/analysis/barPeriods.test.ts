import { describe, expect, it } from 'vitest';
import { aggregateBarsToMonthly } from '@/domain/analysis/aggregateBarsToMonthly';
import { aggregateBarsToWeekly } from '@/domain/analysis/aggregateBarsToWeekly';
import { barPeriodStartSeconds } from '@/domain/analysis/barPeriods';

const utc = (y: number, m: number, d: number, h = 0) =>
    Math.floor(Date.UTC(y, m, d, h) / 1000);

describe('barPeriodStartSeconds', () => {
    it('week: Monday 00:00 UTC of the ISO week, Sunday belonging to the week before', () => {
        expect(barPeriodStartSeconds('week', utc(2024, 0, 3, 15))).toBe(
            utc(2024, 0, 1)
        );
        expect(barPeriodStartSeconds('week', utc(2024, 0, 7, 23))).toBe(
            utc(2024, 0, 1)
        );
        expect(barPeriodStartSeconds('week', utc(2024, 0, 8))).toBe(
            utc(2024, 0, 8)
        );
    });

    it('month: the 1st 00:00 UTC, rolling over the year', () => {
        expect(barPeriodStartSeconds('month', utc(2024, 1, 29, 12))).toBe(
            utc(2024, 1, 1)
        );
        expect(barPeriodStartSeconds('month', utc(2023, 11, 31, 23))).toBe(
            utc(2023, 11, 1)
        );
    });

    it('matches the time the aggregators stamp on that period', () => {
        const t = utc(2024, 4, 15);
        const bar = { time: t, open: 1, high: 1, low: 1, close: 1, volume: 1 };
        expect(barPeriodStartSeconds('week', t)).toBe(
            aggregateBarsToWeekly([bar])[0]!.time
        );
        expect(barPeriodStartSeconds('month', t)).toBe(
            aggregateBarsToMonthly([bar])[0]!.time
        );
    });
});
