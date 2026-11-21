import { describe, expect, it } from 'vitest';
import {
    calendarPeriodChange,
    closeOnOrBefore,
    isIsoDate,
    minusCalendarMonths,
    normalizeCloses,
} from '@/domain/agent/calendarPeriods';
import type { MarketDailyClose } from '@/domain/types';

function closesOf(rows: readonly [string, number][]): MarketDailyClose[] {
    return rows.map(([date, close]) => ({ date, close }));
}

describe('isIsoDate', () => {
    it('accepts real calendar dates, leap day included', () => {
        expect(isIsoDate('2026-11-20')).toBe(true);
        expect(isIsoDate('2028-02-29')).toBe(true);
    });

    it('rejects dates that do not round-trip and wrong shapes', () => {
        expect(isIsoDate('2026-02-29')).toBe(false);
        expect(isIsoDate('2026-02-30')).toBe(false);
        expect(isIsoDate('2026-13-01')).toBe(false);
        expect(isIsoDate('2026-1-5')).toBe(false);
        expect(isIsoDate('')).toBe(false);
    });
});

describe('minusCalendarMonths', () => {
    it('keeps the day of month when the target month has it', () => {
        expect(minusCalendarMonths('2026-10-19', 1)).toBe('2026-09-19');
        expect(minusCalendarMonths('2026-01-15', 3)).toBe('2025-10-15');
        expect(minusCalendarMonths('2026-10-19', 12)).toBe('2025-10-19');
    });

    it('clamps to the last day of a shorter target month', () => {
        expect(minusCalendarMonths('2026-03-31', 1)).toBe('2026-02-28');
        expect(minusCalendarMonths('2024-03-31', 1)).toBe('2024-02-29');
        expect(minusCalendarMonths('2028-02-29', 12)).toBe('2027-02-28');
        expect(minusCalendarMonths('2026-12-31', 3)).toBe('2026-09-30');
    });

    it('crosses a year boundary', () => {
        expect(minusCalendarMonths('2026-01-15', 1)).toBe('2025-12-15');
        expect(minusCalendarMonths('2026-02-10', 120)).toBe('2016-02-10');
    });
});

describe('closeOnOrBefore', () => {
    const closes = closesOf([
        ['2026-09-17', 1],
        ['2026-09-18', 1],
        ['2026-09-21', 1],
    ]);

    it('returns the exact date, else the last earlier session', () => {
        expect(closeOnOrBefore(closes, '2026-09-18')).toBe(1);
        expect(closeOnOrBefore(closes, '2026-09-20')).toBe(1);
        expect(closeOnOrBefore(closes, '2026-09-17')).toBe(0);
    });

    it('returns the last index for a date after the series', () => {
        expect(closeOnOrBefore(closes, '2026-09-30')).toBe(2);
    });

    it('is -1 when the series starts after the date or is empty', () => {
        expect(closeOnOrBefore(closes, '2026-09-16')).toBe(-1);
        expect(closeOnOrBefore([], '2026-09-16')).toBe(-1);
    });

    it('finds the right index in a longer series', () => {
        const long = Array.from({ length: 101 }, (_, i) => ({
            date: `2026-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
            close: 1,
        }));
        expect(closeOnOrBefore(long, '2026-02-05')).toBe(32);
        expect(closeOnOrBefore(long, '2026-04-17')).toBe(100);
    });
});

describe('calendarPeriodChange', () => {
    const closes = closesOf([
        ['2025-10-17', 80],
        ['2026-09-17', 100],
        ['2026-10-19', 110],
    ]);

    it('compares the last close with the last session on or before last date minus the months', () => {
        // 2026-10-19 minus 1 month = 2026-09-19 (no bar) -> 2026-09-17
        expect(calendarPeriodChange(closes, 1)).toEqual({
            baseDate: '2026-09-17',
            baseClose: 100,
            pct: 10,
        });
        // minus 12 months = 2025-10-19 (a Sunday) -> 2025-10-17
        expect(calendarPeriodChange(closes, 12)).toEqual({
            baseDate: '2025-10-17',
            baseClose: 80,
            pct: 37.5,
        });
    });

    it('rounds the change to two decimals', () => {
        expect(
            calendarPeriodChange(
                closesOf([
                    ['2026-09-17', 3],
                    ['2026-10-19', 4],
                ]),
                1
            )?.pct
        ).toBe(33.33);
    });

    it('is null when the series does not reach back that far', () => {
        expect(calendarPeriodChange(closes, 13)).toBeNull();
    });

    it('is null for an empty series and for months that are not positive integers', () => {
        expect(calendarPeriodChange([], 1)).toBeNull();
        expect(calendarPeriodChange(closes, 0)).toBeNull();
        expect(calendarPeriodChange(closes, 1.5)).toBeNull();
    });

    it('is null when the base close is not a usable price', () => {
        expect(
            calendarPeriodChange(
                closesOf([
                    ['2026-09-17', Number.NaN],
                    ['2026-10-19', 110],
                ]),
                1
            )
        ).toBeNull();
        expect(
            calendarPeriodChange(
                closesOf([
                    ['2026-09-17', 0],
                    ['2026-10-19', 110],
                ]),
                1
            )
        ).toBeNull();
    });

    it('skips a last row whose price is unusable, like computePriceStats does', () => {
        // the NaN last row is dropped, so the last close is 2026-09-17 and 1 month back is before the series
        expect(
            calendarPeriodChange(
                closesOf([
                    ['2026-09-17', 100],
                    ['2026-10-19', Number.NaN],
                ]),
                1
            )
        ).toBeNull();
        expect(
            calendarPeriodChange(
                closesOf([
                    ['2026-08-14', 100],
                    ['2026-09-17', 110],
                    ['2026-10-19', Number.NaN],
                ]),
                1
            )
        ).toEqual({ baseDate: '2026-08-14', baseClose: 100, pct: 10 });
    });
});

describe('normalizeCloses', () => {
    it('keeps usable rows sorted and unique and counts what it dropped', () => {
        expect(
            normalizeCloses(
                closesOf([
                    ['2026-01-05', 105],
                    ['2025-12-31', 104],
                    ['2025-12-31', 999],
                    ['2026-01-02', Number.NaN],
                    ['2026-01-03', 0],
                    ['2026-02-30', 100],
                ])
            )
        ).toEqual({
            closes: closesOf([
                ['2025-12-31', 104],
                ['2026-01-05', 105],
            ]),
            duplicates: 1,
            unusableDates: ['2026-01-02', '2026-01-03', '2026-02-30'],
        });
    });
});
