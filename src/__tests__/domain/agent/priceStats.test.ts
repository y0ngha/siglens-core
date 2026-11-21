import { describe, expect, it } from 'vitest';
import {
    AGENT_PRICE_STATS_DEFAULT_PERIOD,
    AGENT_PRICE_STATS_MAX_DATES,
    AGENT_PRICE_STATS_MAX_SUBJECTS,
    AGENT_PRICE_STATS_PERIODS,
    PRICE_STATS_MIN_DAILY_OBSERVATIONS,
    PRICE_STATS_MIN_WEEKLY_OBSERVATIONS,
    PRICE_STATS_NOTE_TEMPLATES as NOTES,
    computePriceStats,
    priceStatsEarliestDate,
} from '@/domain/agent/priceStats';
import type {
    PriceStatsRequest,
    PriceStatsResult,
    PriceStatsSubjectInput,
    PriceStatsWindowRequest,
} from '@/domain/agent/priceStats';
import type { MarketDailyClose } from '@/domain/types';

const MS_PER_DAY = 86_400_000;

function closesOf(rows: readonly [string, number][]): MarketDailyClose[] {
    return rows.map(([date, close]) => ({ date, close }));
}

function request(
    window: PriceStatsWindowRequest,
    dates: readonly string[] = [],
    ignored: PriceStatsRequest['ignored'] = []
): PriceStatsRequest {
    return { window, dates, ignored };
}

function subject(
    label: string,
    closes: readonly MarketDailyClose[],
    overrides: Partial<PriceStatsSubjectInput> = {}
): PriceStatsSubjectInput {
    return {
        label,
        closes,
        market: 'us',
        alwaysOpen: false,
        sessionInProgress: false,
        // By default the market's date is the last date in the data: nothing is "past" after it.
        today:
            closes
                .map(c => c.date)
                .sort()
                .at(-1) ?? '2026-01-01',
        ...overrides,
    };
}

/** One subject, labelled `A`. */
function statsOf(
    closes: readonly MarketDailyClose[],
    window: PriceStatsWindowRequest,
    dates: readonly string[] = []
): PriceStatsResult {
    return computePriceStats([subject('A', closes)], request(window, dates));
}

const ytd: PriceStatsWindowRequest = { kind: 'period', period: 'ytd' };

function isoOf(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
}

/** `count` consecutive weekdays from `start`. */
function weekdays(start: string, count: number): string[] {
    const startMs = Date.parse(`${start}T00:00:00Z`);
    return Array.from({ length: count * 2 }, (_, i) => startMs + i * MS_PER_DAY)
        .filter(ms => ![0, 6].includes(new Date(ms).getUTCDay()))
        .slice(0, count)
        .map(isoOf);
}

/** `count` consecutive calendar days from `start`. */
function allDays(start: string, count: number): string[] {
    const startMs = Date.parse(`${start}T00:00:00Z`);
    return Array.from({ length: count }, (_, i) =>
        isoOf(startMs + i * MS_PER_DAY)
    );
}

/** Alternates `low` and `high` by position: its returns take exactly two values. */
function oscillating(
    dates: readonly string[],
    low: number,
    high: number
): MarketDailyClose[] {
    return dates.map((date, i) => ({ date, close: i % 2 === 0 ? low : high }));
}

function scaled(
    closes: readonly MarketDailyClose[],
    factor: number
): MarketDailyClose[] {
    return closes.map(({ date, close }) => ({ date, close: close * factor }));
}

/** Weekend (01-03/04) and holiday (01-01) gaps around a year end; 12-31 is a Wednesday. */
const US_A = closesOf([
    ['2025-12-29', 100],
    ['2025-12-30', 102],
    ['2025-12-31', 104],
    ['2026-01-02', 106],
    ['2026-01-05', 105],
    ['2026-01-06', 110],
    ['2026-01-07', 108],
    ['2026-01-08', 99],
    ['2026-01-09', 103],
    ['2026-01-12', 109],
    ['2026-01-13', 111],
    ['2026-01-14', 110.5],
]);

/** Sparse closes whose gaps land every period target on a weekend or a missing day. */
const SPARSE = closesOf([
    ['2016-11-18', 10],
    ['2021-11-19', 20],
    ['2023-11-17', 30],
    ['2024-12-31', 45],
    ['2025-11-20', 50],
    ['2025-12-31', 52],
    ['2026-05-19', 55],
    ['2026-08-20', 60],
    ['2026-10-19', 70],
    ['2026-11-19', 75],
    ['2026-11-20', 80],
]);

describe('constants', () => {
    it('lists the periods, the default and the per-call caps', () => {
        expect(AGENT_PRICE_STATS_PERIODS).toEqual([
            'ytd',
            '1m',
            '3m',
            '6m',
            '1y',
            '3y',
            '5y',
            '10y',
            'max',
        ]);
        expect(AGENT_PRICE_STATS_DEFAULT_PERIOD).toBe('1y');
        expect(AGENT_PRICE_STATS_MAX_SUBJECTS).toBe(3);
        expect(AGENT_PRICE_STATS_MAX_DATES).toBe(5);
    });
});

describe('computePriceStats: period bases', () => {
    const period = (p: (typeof AGENT_PRICE_STATS_PERIODS)[number]) =>
        statsOf(SPARSE, { kind: 'period', period: p }).subjects[0];

    it('1m starts at the last session on or before the same date a month earlier', () => {
        // 2026-11-20 minus 1 month = 2026-10-20, no bar -> 2026-10-19
        expect(period('1m')).toMatchObject({
            window: {
                baseDate: '2026-10-19',
                baseClose: 70,
                endDate: '2026-11-20',
                endClose: 80,
                sessions: 2,
                calendarDays: 32,
            },
            returnPct: 14.29,
            cagrPct: null,
            highestClose: { date: '2026-11-20', close: 80 },
            lowestClose: { date: '2026-11-19', close: 75 },
            fromHighestClosePct: 0,
            maxDrawdown: null,
        });
    });

    it('3m uses an exact-date base', () => {
        expect(period('3m')).toMatchObject({
            window: {
                baseDate: '2026-08-20',
                baseClose: 60,
                sessions: 3,
                calendarDays: 92,
            },
            returnPct: 33.33,
        });
    });

    it('6m falls back to the session before a missing target date', () => {
        // target 2026-05-20 has no bar -> 2026-05-19
        expect(period('6m')).toMatchObject({
            window: {
                baseDate: '2026-05-19',
                baseClose: 55,
                sessions: 4,
                calendarDays: 185,
            },
            returnPct: 45.45,
        });
    });

    it('1y spans exactly 365 days, which is enough for an annual rate', () => {
        expect(period('1y')).toMatchObject({
            window: {
                baseDate: '2025-11-20',
                baseClose: 50,
                sessions: 6,
                calendarDays: 365,
            },
            returnPct: 60,
            cagrPct: null,
            highestClose: { date: '2026-11-20', close: 80 },
            lowestClose: { date: '2025-12-31', close: 52 },
        });
    });

    it('3y, 5y and 10y resolve weekend and missing-day targets to the session before', () => {
        // 2023-11-20 (no bar) -> 2023-11-17
        expect(period('3y')).toMatchObject({
            window: {
                baseDate: '2023-11-17',
                baseClose: 30,
                sessions: 8,
                calendarDays: 1099,
            },
            returnPct: 166.67,
            cagrPct: 38.54,
        });
        // 2021-11-20 is a Saturday -> 2021-11-19
        expect(period('5y')).toMatchObject({
            window: {
                baseDate: '2021-11-19',
                sessions: 9,
                calendarDays: 1827,
            },
            returnPct: 300,
            cagrPct: 31.94,
        });
        // 2016-11-20 is a Sunday -> 2016-11-18
        expect(period('10y')).toMatchObject({
            window: {
                baseDate: '2016-11-18',
                sessions: 10,
                calendarDays: 3654,
            },
            returnPct: 700,
            cagrPct: 23.1,
        });
    });

    it('max starts at the first close and needs no history note', () => {
        const result = statsOf(SPARSE, { kind: 'period', period: 'max' });
        expect(result.subjects[0]).toMatchObject({
            window: { baseDate: '2016-11-18', baseClose: 10, sessions: 10 },
            returnPct: 700,
        });
        expect(result.notes).toBeUndefined();
    });

    it('ytd starts at the previous year-end close, or the session before it', () => {
        expect(statsOf(US_A, ytd).subjects[0]).toMatchObject({
            window: {
                baseDate: '2025-12-31',
                baseClose: 104,
                endDate: '2026-01-14',
                endClose: 110.5,
                sessions: 9,
                calendarDays: 14,
            },
            returnPct: 6.25,
            cagrPct: null,
        });
        // 2022-12-31 is a Saturday -> the base is Friday 2022-12-30
        const yearStart = closesOf([
            ['2022-12-28', 50],
            ['2022-12-30', 51],
            ['2023-01-03', 52],
            ['2023-01-04', 53],
        ]);
        expect(statsOf(yearStart, ytd).subjects[0]).toMatchObject({
            window: { baseDate: '2022-12-30', baseClose: 51, sessions: 2 },
            returnPct: 3.92,
        });
    });

    it('starts at the first close with a history note when the target is before the history', () => {
        const result = statsOf(US_A, { kind: 'period', period: '1m' });
        // 2026-01-14 minus 1 month = 2025-12-14, before the first close 2025-12-29
        expect(result.subjects[0]).toMatchObject({
            window: {
                baseDate: '2025-12-29',
                baseClose: 100,
                sessions: 11,
                calendarDays: 16,
            },
            returnPct: 10.5,
        });
        expect(result.notes).toEqual([
            NOTES.historyStart('A', '2025-12-14', '2025-12-29'),
        ]);
        expect(result.notes?.[0]).toContain(
            "SIGLENS's price history starts on 2025-12-29"
        );
        expect(result.notes?.[0]).not.toContain('listed on');
    });
});

describe('computePriceStats: calendar year and range', () => {
    it('a finished calendar year starts at the previous year-end and ends at its own', () => {
        const result = statsOf(SPARSE, { kind: 'year', year: 2025 });
        expect(result.subjects[0]).toMatchObject({
            window: {
                baseDate: '2024-12-31',
                baseClose: 45,
                endDate: '2025-12-31',
                endClose: 52,
                sessions: 2,
                calendarDays: 365,
            },
            returnPct: 15.56,
            cagrPct: null,
        });
        expect(result.notes).toBeUndefined();
    });

    it('the year in progress ends at the last close with a note', () => {
        const result = statsOf(SPARSE, { kind: 'year', year: 2026 });
        expect(result.subjects[0]).toMatchObject({
            window: { baseDate: '2025-12-31', endDate: '2026-11-20' },
            returnPct: 53.85,
        });
        expect(result.notes).toEqual([
            NOTES.windowEndsAtLastClose('A', '2026-12-31', '2026-11-20'),
        ]);
    });

    it('a year whose start is before the history falls back to the first close with a note', () => {
        const result = statsOf(US_A, { kind: 'year', year: 2025 });
        expect(result.subjects[0]).toMatchObject({
            window: {
                baseDate: '2025-12-29',
                endDate: '2025-12-31',
                sessions: 2,
            },
            returnPct: 4,
        });
        expect(result.notes).toEqual([
            NOTES.historyStart('A', '2024-12-31', '2025-12-29'),
        ]);
    });

    it('a window ending before the history has no figures and says so', () => {
        const result = statsOf(
            closesOf([...US_A.map(c => [c.date, c.close] as [string, number])]),
            { kind: 'year', year: 2024 }
        );
        expect(result.subjects[0]).toEqual({
            subject: 'A',
            window: null,
            returnPct: null,
            cagrPct: null,
            highestClose: null,
            lowestClose: null,
            fromHighestClosePct: null,
            maxDrawdown: null,
            summary:
                'A: no figures (the requested end is before the price history starts on 2025-12-29)',
        });
        expect(result.notes).toEqual([
            NOTES.windowBeforeHistory('A', '2024-12-31', '2025-12-29'),
        ]);
        expect(result.asOf).toBe('2026-01-14');
    });

    it('a range with an end date stops at the last session on or before it', () => {
        const result = statsOf(US_A, {
            kind: 'range',
            from: '2026-01-05',
            to: '2026-01-09',
        });
        expect(result.subjects[0]).toMatchObject({
            window: {
                baseDate: '2026-01-05',
                baseClose: 105,
                endDate: '2026-01-09',
                endClose: 103,
                sessions: 4,
                calendarDays: 4,
            },
            returnPct: -1.9,
            highestClose: { date: '2026-01-06', close: 110 },
            lowestClose: { date: '2026-01-08', close: 99 },
            fromHighestClosePct: -6.36,
            maxDrawdown: {
                pct: -10,
                peakDate: '2026-01-06',
                troughDate: '2026-01-08',
                recoveredDate: null,
            },
        });
        expect(result.notes).toBeUndefined();
    });

    it('a range starting on a weekend uses the session before it', () => {
        expect(
            statsOf(US_A, { kind: 'range', from: '2026-01-03', to: null })
                .subjects[0]?.window?.baseDate
        ).toBe('2026-01-02');
    });

    it('a range ending after the last close ends there with a note', () => {
        const result = statsOf(US_A, {
            kind: 'range',
            from: '2026-01-12',
            to: '2026-02-01',
        });
        expect(result.subjects[0]?.window?.endDate).toBe('2026-01-14');
        expect(result.notes).toEqual([
            NOTES.windowEndsAtLastClose('A', '2026-02-01', '2026-01-14'),
        ]);
    });

    it('a start at the last close leaves no session to measure', () => {
        const result = statsOf(US_A, {
            kind: 'range',
            from: '2026-01-14',
            to: null,
        });
        expect(result.subjects[0]).toEqual({
            subject: 'A',
            window: {
                baseDate: '2026-01-14',
                baseClose: 110.5,
                endDate: '2026-01-14',
                endClose: 110.5,
                sessions: 0,
                calendarDays: 0,
            },
            returnPct: 0,
            cagrPct: null,
            highestClose: null,
            lowestClose: null,
            fromHighestClosePct: null,
            maxDrawdown: null,
            summary:
                'A 2026-01-14 → 2026-01-14 (0 sessions): close 110.5, no session after the base date, so no change measured',
        });
        expect(result.notes).toEqual([
            NOTES.noSessionInWindow('A', '2026-01-14'),
        ]);
    });

    it('a start after the last close also resolves to the last close', () => {
        const result = statsOf(US_A, {
            kind: 'range',
            from: '2026-02-01',
            to: null,
        });
        expect(result.subjects[0]?.window?.sessions).toBe(0);
        expect(result.notes).toEqual([
            NOTES.noSessionInWindow('A', '2026-01-14'),
        ]);
    });
});

describe('computePriceStats: annual rate', () => {
    it('is null at 364 calendar days', () => {
        const closes = closesOf([
            ['2025-11-21', 100],
            ['2026-11-20', 120],
        ]);
        expect(
            statsOf(closes, { kind: 'range', from: '2025-11-21', to: null })
                .subjects[0]
        ).toMatchObject({
            window: { calendarDays: 364 },
            returnPct: 20,
            cagrPct: null,
        });
    });

    it('is null at 366 calendar days and given from 367 with the exact value', () => {
        const at366 = closesOf([
            ['2025-11-19', 100],
            ['2026-11-20', 120],
        ]);
        expect(
            statsOf(at366, { kind: 'period', period: 'max' }).subjects[0]
        ).toMatchObject({ window: { calendarDays: 366 }, cagrPct: null });
        const at367 = closesOf([
            ['2025-11-18', 100],
            ['2026-11-20', 120],
        ]);
        // 1.2 ^ (365.25 / 367) - 1 = 19.8957...%
        expect(
            statsOf(at367, { kind: 'period', period: 'max' }).subjects[0]
        ).toMatchObject({
            window: { calendarDays: 367 },
            returnPct: 20,
            cagrPct: 19.9,
        });
    });

    it('is never given for a named period of a year or less, even when the base session is a few days early', () => {
        const closes = closesOf([
            ['2025-11-14', 100],
            ['2026-11-20', 120],
        ]);
        // 1y targets 2025-11-20; the first close is 2025-11-14, 371 days back
        expect(
            statsOf(closes, { kind: 'period', period: '1y' }).subjects[0]
        ).toMatchObject({ window: { calendarDays: 371 }, cagrPct: null });
        // the same 371 days as an explicit window is longer than a year
        expect(
            statsOf(closes, { kind: 'period', period: 'max' }).subjects[0]
        ).toMatchObject({ cagrPct: 19.66 });
        expect(
            statsOf(closes, {
                kind: 'range',
                from: '2025-11-14',
                to: null,
            }).subjects[0]
        ).toMatchObject({ cagrPct: 19.66 });
    });

    it('is never given for ytd or a calendar year', () => {
        expect(statsOf(SPARSE, ytd).subjects[0]?.cagrPct).toBeNull();
        expect(
            statsOf(SPARSE, { kind: 'year', year: 2025 }).subjects[0]?.cagrPct
        ).toBeNull();
    });
});

describe('computePriceStats: highs, lows and drawdown', () => {
    it('counts a fall from the base close and reports the recovery date', () => {
        const closes = closesOf([
            ['2025-12-31', 100],
            ['2026-01-02', 90],
            ['2026-01-05', 80],
            ['2026-01-06', 85],
            ['2026-01-07', 100],
            ['2026-01-08', 101],
        ]);
        expect(statsOf(closes, ytd).subjects[0]).toMatchObject({
            maxDrawdown: {
                pct: -20,
                peakDate: '2025-12-31',
                peakClose: 100,
                troughDate: '2026-01-05',
                troughClose: 80,
                recoveredDate: '2026-01-07',
            },
            highestClose: { date: '2026-01-08', close: 101 },
            lowestClose: { date: '2026-01-05', close: 80 },
        });
    });

    it('leaves the base out of the high and the recovery null while still below the peak', () => {
        const closes = closesOf([
            ['2025-12-31', 100],
            ['2026-01-02', 90],
            ['2026-01-05', 80],
        ]);
        expect(statsOf(closes, ytd).subjects[0]).toMatchObject({
            returnPct: -20,
            highestClose: { date: '2026-01-02', close: 90 },
            lowestClose: { date: '2026-01-05', close: 80 },
            fromHighestClosePct: -11.11,
            maxDrawdown: {
                pct: -20,
                peakDate: '2025-12-31',
                troughDate: '2026-01-05',
                recoveredDate: null,
            },
        });
    });

    it('keeps the earlier date on a tied high, a tied low and a tied trough', () => {
        const closes = closesOf([
            ['2025-12-31', 100],
            ['2026-01-02', 110],
            ['2026-01-05', 90],
            ['2026-01-06', 110],
            ['2026-01-07', 90],
            ['2026-01-08', 100],
        ]);
        expect(statsOf(closes, ytd).subjects[0]).toMatchObject({
            highestClose: { date: '2026-01-02', close: 110 },
            lowestClose: { date: '2026-01-05', close: 90 },
            maxDrawdown: {
                pct: -18.18,
                peakDate: '2026-01-02',
                troughDate: '2026-01-05',
                recoveredDate: '2026-01-06',
            },
        });
    });

    it('finds the deepest fall inside a window that later makes a new high', () => {
        expect(statsOf(US_A, ytd).subjects[0]).toMatchObject({
            highestClose: { date: '2026-01-13', close: 111 },
            lowestClose: { date: '2026-01-08', close: 99 },
            fromHighestClosePct: -0.45,
            maxDrawdown: {
                pct: -10,
                peakDate: '2026-01-06',
                peakClose: 110,
                troughDate: '2026-01-08',
                troughClose: 99,
                recoveredDate: '2026-01-13',
            },
        });
    });

    it('reports no drawdown when the fall rounds to 0.00%', () => {
        const flat = statsOf(
            closesOf([
                ['2025-12-31', 100],
                ['2026-01-02', 100],
                ['2026-01-05', 99.999],
            ]),
            ytd
        );
        expect(flat.subjects[0]?.maxDrawdown).toBeNull();
        expect(flat.subjects[0]?.summary).toContain(
            'no fall of 0.01% or more from an earlier close'
        );
        expect(
            statsOf(
                closesOf([
                    ['2025-12-31', 100],
                    ['2026-01-02', 100],
                    ['2026-01-05', 99.99],
                ]),
                ytd
            ).subjects[0]?.maxDrawdown?.pct
        ).toBe(-0.01);
    });

    it('is null for a series that only rises', () => {
        expect(
            statsOf(SPARSE, { kind: 'period', period: '1y' }).subjects[0]
                ?.maxDrawdown
        ).toBeNull();
    });
});

describe('computePriceStats: window starting at the history', () => {
    it('counts the first close as a high when max starts there', () => {
        const closes = closesOf([
            ['2021-01-04', 100],
            ['2021-01-05', 60],
            ['2021-01-06', 50],
            ['2021-01-07', 70],
        ]);
        expect(
            statsOf(closes, { kind: 'period', period: 'max' }).subjects[0]
        ).toMatchObject({
            window: { baseDate: '2021-01-04', sessions: 3 },
            returnPct: -30,
            highestClose: { date: '2021-01-04', close: 100 },
            lowestClose: { date: '2021-01-06', close: 50 },
            fromHighestClosePct: -30,
            maxDrawdown: { pct: -50, peakDate: '2021-01-04' },
        });
    });

    it('counts the first close for ytd when the history starts mid-year', () => {
        const closes = closesOf([
            ['2026-03-02', 100],
            ['2026-03-03', 90],
            ['2026-03-04', 95],
        ]);
        const result = statsOf(closes, ytd);
        expect(result.subjects[0]).toMatchObject({
            window: { baseDate: '2026-03-02', sessions: 2 },
            returnPct: -5,
            highestClose: { date: '2026-03-02', close: 100 },
            lowestClose: { date: '2026-03-03', close: 90 },
            fromHighestClosePct: -5,
        });
        expect(result.notes).toEqual([
            NOTES.historyStart('A', '2025-12-31', '2026-03-02'),
        ]);
    });

    it('counts the first close for a range that starts before the history', () => {
        const closes = closesOf([
            ['2026-03-02', 100],
            ['2026-03-03', 90],
        ]);
        expect(
            statsOf(closes, { kind: 'range', from: '2020-01-01', to: null })
                .subjects[0]?.highestClose
        ).toEqual({ date: '2026-03-02', close: 100 });
    });

    it('leaves out a base that is a close from before the window', () => {
        const closes = closesOf([
            ['2025-12-31', 100],
            ['2026-01-02', 90],
        ]);
        expect(statsOf(closes, ytd).subjects[0]?.highestClose).toEqual({
            date: '2026-01-02',
            close: 90,
        });
    });
});

describe('computePriceStats: the subject local date', () => {
    const newYear = closesOf([
        ['2025-12-30', 100],
        ['2025-12-31', 102],
    ]);

    it('between 1 January and the first session ytd equals the current calendar year', () => {
        const viaYtd = computePriceStats(
            [subject('A', newYear, { today: '2026-01-02' })],
            request(ytd)
        );
        const viaYear = computePriceStats(
            [subject('A', newYear, { today: '2026-01-02' })],
            request({ kind: 'year', year: 2026 })
        );
        expect(viaYtd.subjects).toEqual(viaYear.subjects);
        expect(viaYtd.notes).toEqual(viaYear.notes);
        expect(viaYtd.subjects[0]).toMatchObject({
            window: {
                baseDate: '2025-12-31',
                endDate: '2025-12-31',
                sessions: 0,
            },
            returnPct: 0,
        });
        expect(viaYtd.notes).toEqual([
            NOTES.windowEndsAtLastClose('A', '2026-12-31', '2025-12-31'),
            NOTES.noSessionInWindow('A', '2025-12-31'),
        ]);
    });

    it('uses the last close date and says so when today is not a date', () => {
        const result = computePriceStats(
            [subject('A', US_A, { today: 'soon' })],
            request(ytd)
        );
        expect(result.subjects[0]?.window?.baseDate).toBe('2025-12-31');
        expect(result.notes).toEqual([NOTES.todayIgnored('A', '2026-01-14')]);
        expect(NOTES.todayIgnored('A', '2026-01-14')).toContain(
            '"ytd" may then refer to the year of that close'
        );
    });

    it('an ignored today in early January is flagged, not silently last year', () => {
        const result = computePriceStats(
            [subject('A', newYear, { today: 'soon' })],
            request(ytd)
        );
        // the fallback reads 2025-12-31 as today, so ytd is 2025; the note says so
        expect(result.subjects[0]?.window?.baseDate).toBe('2025-12-30');
        expect(result.notes).toEqual([
            NOTES.todayIgnored('A', '2025-12-31'),
            NOTES.historyStart('A', '2024-12-31', '2025-12-30'),
        ]);
    });

    it('a today before the last close is raised to the last close date', () => {
        const result = computePriceStats(
            [subject('A', US_A, { today: '2025-12-01' })],
            request(ytd, ['2026-01-15'])
        );
        expect(result.subjects[0]?.window?.baseDate).toBe('2025-12-31');
        expect(result.subjects[0]?.closes?.[0]?.status).toBe(
            'after_last_close'
        );
    });

    it('reads a weekend as the last close only when no weekday lies between it and the last close', () => {
        // last close Wed 2026-01-14; today is Mon 2026-01-19: Thu 01-15 and Fri 01-16 may be unpublished
        const result = computePriceStats(
            [subject('A', US_A, { today: '2026-01-19' })],
            request({ kind: 'none' }, [
                '2026-01-15',
                '2026-01-17',
                '2026-01-18',
                '2026-01-19',
                '2026-01-20',
            ])
        );
        expect(
            result.subjects[0]?.closes?.map(entry => [
                entry.requestedDate,
                entry.status,
            ])
        ).toEqual([
            ['2026-01-15', 'after_last_close'],
            ['2026-01-17', 'after_last_close'],
            ['2026-01-18', 'after_last_close'],
            ['2026-01-19', 'after_last_close'],
            ['2026-01-20', 'after_last_close'],
        ]);
        expect(result.notes).toEqual([
            NOTES.datesAfterLastClose(
                'A',
                [
                    '2026-01-15',
                    '2026-01-17',
                    '2026-01-18',
                    '2026-01-19',
                    '2026-01-20',
                ],
                '2026-01-14'
            ),
        ]);
    });

    it('a Friday last close makes the following Saturday and Sunday previous_session', () => {
        const friday = closesOf([
            ['2026-01-15', 111],
            ['2026-01-16', 112],
        ]);
        const result = computePriceStats(
            [subject('A', friday, { today: '2026-01-19' })],
            request({ kind: 'none' }, ['2026-01-17', '2026-01-18'])
        );
        expect(result.subjects[0]?.closes).toEqual([
            {
                requestedDate: '2026-01-17',
                date: '2026-01-16',
                close: 112,
                status: 'previous_session',
            },
            {
                requestedDate: '2026-01-18',
                date: '2026-01-16',
                close: 112,
                status: 'previous_session',
            },
        ]);
        expect(result.notes).toEqual([
            NOTES.datesPreviousSession('A', [
                '2026-01-17 → 2026-01-16',
                '2026-01-18 → 2026-01-16',
            ]),
        ]);
    });

    it('a Thursday last close before Good Friday leaves the Saturday not in the data', () => {
        const thursday = closesOf([
            ['2026-04-01', 100],
            ['2026-04-02', 101],
        ]);
        const result = computePriceStats(
            [subject('A', thursday, { today: '2026-04-06' })],
            request({ kind: 'none' }, ['2026-04-04'])
        );
        expect(result.subjects[0]?.closes?.[0]?.status).toBe(
            'after_last_close'
        );
    });

    it('a weekend a week or more after a stale last close is not in the data', () => {
        const result = computePriceStats(
            [subject('A', US_A, { today: '2026-01-26' })],
            request({ kind: 'none' }, ['2026-01-24'])
        );
        expect(result.subjects[0]?.closes?.[0]?.status).toBe(
            'after_last_close'
        );
    });

    it('never reads a date after the last close of an always-open market as a missing session', () => {
        const result = computePriceStats(
            [
                subject('BTC', US_A, {
                    market: 'crypto',
                    alwaysOpen: true,
                    today: '2026-01-19',
                }),
            ],
            request({ kind: 'none' }, ['2026-01-17'])
        );
        expect(result.subjects[0]?.closes).toEqual([
            {
                requestedDate: '2026-01-17',
                date: null,
                close: null,
                status: 'after_last_close',
            },
        ]);
        expect(result.notes).toEqual([
            NOTES.datesAfterLastClose('BTC', ['2026-01-17'], '2026-01-14'),
            NOTES.alwaysOpenCloses('BTC'),
        ]);
    });

    it('the after-last-close note names the latest close and claims neither a missing session nor a fact about the market', () => {
        const note = NOTES.datesAfterLastClose(
            'A',
            ['2026-01-15'],
            '2026-01-14'
        );
        expect(note).toContain('the data has no close for 2026-01-15 yet');
        expect(note).toContain('the latest close is from 2026-01-14');
        expect(note).toContain('never say there was no session');
        expect(note).not.toContain('no close yet.');
    });
});

describe('computePriceStats: unusable rows', () => {
    const dirty = closesOf([
        ['2025-12-31', 104],
        ['2026-01-02', Number.NaN],
        ['2026-01-05', 105],
        ['2026-01-05', 999],
        ['2026-01-06', -1],
    ]);

    it('names the unusable dates, counts a repeated date apart, and says when a dropped row ended the window', () => {
        const result = statsOf(dirty, ytd, [
            '2026-01-02',
            '2026-01-05',
            '2026-01-06',
        ]);
        expect(result.subjects[0]?.closes).toEqual([
            {
                requestedDate: '2026-01-02',
                date: null,
                close: null,
                status: 'unusable_price',
            },
            {
                requestedDate: '2026-01-05',
                date: '2026-01-05',
                close: 105,
                status: 'exact',
            },
            {
                requestedDate: '2026-01-06',
                date: null,
                close: null,
                status: 'unusable_price',
            },
        ]);
        expect(result.notes).toEqual([
            NOTES.rowsUnusable('A', ['2026-01-02', '2026-01-06']),
            NOTES.duplicateRowsRemoved('A', 1),
            NOTES.windowEndRowUnusable('A', ['2026-01-06'], '2026-01-05'),
            NOTES.datesUnusablePrice('A', ['2026-01-02', '2026-01-06']),
        ]);
        expect(result.subjects[0]?.summary).toContain(
            '2026-01-02 (price unusable) no close; 2026-01-05 105; 2026-01-06 (price unusable) no close'
        );
        expect(NOTES.datesUnusablePrice('A', ['d'])).not.toContain(
            'had no session'
        );
    });

    it('a repeated date with a usable row is not called unusable', () => {
        const result = statsOf(
            closesOf([
                ['2025-12-31', 104],
                ['2025-12-31', 105],
                ['2026-01-02', 106],
            ]),
            ytd
        );
        expect(result.notes).toEqual([NOTES.duplicateRowsRemoved('A', 1)]);
        expect(NOTES.duplicateRowsRemoved('A', 1)).not.toContain('unusable');
        expect(NOTES.duplicateRowsRemoved('A', 2)).toContain(
            '2 rows with a repeated date were removed'
        );
    });

    it('says the window starts at the neighbouring session when the start date row was unusable', () => {
        const result = statsOf(
            closesOf([
                ['2025-12-30', 100],
                ['2025-12-31', Number.NaN],
                ['2026-01-02', 110],
            ]),
            ytd
        );
        expect(result.subjects[0]?.window?.baseDate).toBe('2025-12-30');
        expect(result.notes).toEqual([
            NOTES.rowsUnusable('A', ['2025-12-31']),
            NOTES.windowStartRowUnusable('A', ['2025-12-31'], '2025-12-30'),
        ]);
    });

    it('a start target on a Sunday with the Friday row dropped moves the base to Thursday and says so', () => {
        const result = statsOf(
            closesOf([
                ['2026-01-07', 100],
                ['2026-01-08', 101],
                ['2026-01-09', Number.NaN],
                ['2026-01-12', 110],
            ]),
            { kind: 'range', from: '2026-01-11', to: null }
        );
        expect(result.subjects[0]?.window?.baseDate).toBe('2026-01-08');
        expect(result.notes).toEqual([
            NOTES.rowsUnusable('A', ['2026-01-09']),
            NOTES.windowStartRowUnusable('A', ['2026-01-09'], '2026-01-08'),
        ]);
    });

    it('when the first row of the history was dropped, the history note alone names the unusable dates and the first usable row', () => {
        const result = statsOf(
            closesOf([
                ['2026-03-02', Number.NaN],
                ['2026-03-03', 100],
                ['2026-03-04', 110],
            ]),
            { kind: 'range', from: '2026-03-02', to: null }
        );
        expect(result.subjects[0]?.window?.baseDate).toBe('2026-03-03');
        expect(result.notes).toEqual([
            NOTES.historyStart('A', '2026-03-02', '2026-03-03', ['2026-03-02']),
            NOTES.rowsUnusable('A', ['2026-03-02']),
        ]);
        expect(
            NOTES.historyStart('A', '2026-03-02', '2026-03-03', ['2026-03-02'])
        ).toContain(
            'first usable price row is on 2026-03-03, after the requested start 2026-03-02 (the rows for 2026-03-02 were unusable and omitted)'
        );
    });

    it('an unusable row between the start target and the first usable close is named by the history note only', () => {
        const result = statsOf(
            closesOf([
                ['2026-03-03', Number.NaN],
                ['2026-03-04', 100],
                ['2026-03-05', 110],
            ]),
            { kind: 'range', from: '2026-03-02', to: null }
        );
        expect(result.subjects[0]?.window?.baseDate).toBe('2026-03-04');
        expect(result.notes).toEqual([
            NOTES.historyStart('A', '2026-03-02', '2026-03-04', ['2026-03-03']),
            NOTES.rowsUnusable('A', ['2026-03-03']),
        ]);
    });

    it('the history note caps the unusable dates it names', () => {
        const note = NOTES.historyStart(
            'A',
            '2026-02-01',
            '2026-03-09',
            [1, 2, 3, 4, 5, 6, 7].map(day => `2026-03-0${day}`)
        );
        expect(note).toContain(
            '2026-03-01, 2026-03-02, 2026-03-03, 2026-03-04, 2026-03-05, and 2 more'
        );
        expect(note).not.toContain('2026-03-06');
    });

    it('a malformed date string never triggers the window start or end notes', () => {
        const dirtyDate = closesOf([
            ['2026-11-19', 100],
            ['2026-11-20', 110],
            ['2026-11-20T00:00:00Z', 120],
        ]);
        const result = computePriceStats(
            [subject('A', dirtyDate, { today: '2026-11-20' })],
            request({ kind: 'period', period: 'max' })
        );
        expect(result.notes).toEqual([
            NOTES.rowsUnusable('A', ['2026-11-20T00:00:00Z']),
        ]);
        const ranged = computePriceStats(
            [subject('A', dirtyDate, { today: '2026-11-20' })],
            request({ kind: 'range', from: '2026-11-20', to: null })
        );
        expect(ranged.notes).toEqual([
            NOTES.noSessionInWindow('A', '2026-11-20'),
            NOTES.rowsUnusable('A', ['2026-11-20T00:00:00Z']),
        ]);
    });

    it('singular wording for one row, and a cap on the dates it names', () => {
        expect(
            statsOf(
                closesOf([
                    ['2025-12-31', 104],
                    ['2026-01-02', 0],
                ]),
                { kind: 'none' }
            ).notes
        ).toEqual([NOTES.rowsUnusable('A', ['2026-01-02'])]);
        expect(NOTES.rowsUnusable('A', ['2026-01-02'])).toContain(
            '1 price row (2026-01-02) had'
        );
        const seven = [1, 2, 3, 4, 5, 6, 7].map(day => `2026-01-0${day}`);
        const capped = NOTES.rowsUnusable('A', seven);
        expect(capped).toContain(
            '7 price rows (2026-01-01, 2026-01-02, 2026-01-03, 2026-01-04, 2026-01-05, and 2 more) had'
        );
        expect(capped).not.toContain('2026-01-06');
    });

    it('a subject left with no closes still answers each requested date, claiming no row for dates that were not unusable', () => {
        const result = statsOf(closesOf([['2026-01-02', Number.NaN]]), ytd, [
            '2026-01-02',
            '2025-05-01',
        ]);
        expect(result.subjects[0]).toEqual({
            subject: 'A',
            window: null,
            returnPct: null,
            cagrPct: null,
            highestClose: null,
            lowestClose: null,
            fromHighestClosePct: null,
            maxDrawdown: null,
            closes: [
                {
                    requestedDate: '2026-01-02',
                    date: null,
                    close: null,
                    status: 'unusable_price',
                },
                {
                    requestedDate: '2025-05-01',
                    date: null,
                    close: null,
                    status: 'no_price_data',
                },
            ],
            summary:
                'A: no closes | A closes: 2026-01-02 (price unusable) no close; 2025-05-01 (no price data) no close',
        });
        expect(result.notes).toEqual([
            NOTES.rowsUnusable('A', ['2026-01-02']),
            NOTES.datesUnusablePrice('A', ['2026-01-02']),
            NOTES.datesNoPriceData('A', ['2025-05-01']),
        ]);
        expect(NOTES.datesNoPriceData('A', ['d'])).toContain(
            'no usable price rows at all'
        );
    });

    it('a subject with no rows at all also answers each requested date', () => {
        const result = statsOf([], ytd, ['2026-01-02']);
        expect(result.subjects[0]?.closes).toEqual([
            {
                requestedDate: '2026-01-02',
                date: null,
                close: null,
                status: 'no_price_data',
            },
        ]);
        expect(result.notes).toEqual([
            NOTES.datesNoPriceData('A', ['2026-01-02']),
        ]);
        const noDates = statsOf(closesOf([['2026-01-02', Number.NaN]]), ytd);
        expect(noDates.subjects[0]?.summary).toBe('A: no closes');
        expect(noDates.notes).toEqual([
            NOTES.rowsUnusable('A', ['2026-01-02']),
        ]);
    });

    it('a series without dropped rows has no such note', () => {
        expect(statsOf(US_A, ytd).notes).toBeUndefined();
    });
});

describe('computePriceStats: date lookups', () => {
    const dates = [
        '2026-01-03',
        '2026-01-05',
        '2025-12-01',
        '2025-12-15',
        '2026-02-01',
    ];

    it('classifies all four statuses in the caller order and notes each status once', () => {
        const result = statsOf(US_A, { kind: 'none' }, dates);
        expect(result.subjects[0]).toEqual({
            subject: 'A',
            window: null,
            returnPct: null,
            cagrPct: null,
            highestClose: null,
            lowestClose: null,
            fromHighestClosePct: null,
            maxDrawdown: null,
            closes: [
                {
                    requestedDate: '2026-01-03',
                    date: '2026-01-02',
                    close: 106,
                    status: 'previous_session',
                },
                {
                    requestedDate: '2026-01-05',
                    date: '2026-01-05',
                    close: 105,
                    status: 'exact',
                },
                {
                    requestedDate: '2025-12-01',
                    date: null,
                    close: null,
                    status: 'before_history',
                },
                {
                    requestedDate: '2025-12-15',
                    date: null,
                    close: null,
                    status: 'before_history',
                },
                {
                    requestedDate: '2026-02-01',
                    date: null,
                    close: null,
                    status: 'after_last_close',
                },
            ],
            summary:
                'A closes: 2026-01-03 → 2026-01-02 (no session that day) 106; 2026-01-05 105; 2025-12-01 (before the price history) no close; 2025-12-15 (before the price history) no close; 2026-02-01 (not in the data yet) no close',
        });
        expect(result.notes).toEqual([
            NOTES.datesPreviousSession('A', ['2026-01-03 → 2026-01-02']),
            NOTES.datesBeforeHistory(
                'A',
                ['2025-12-01', '2025-12-15'],
                '2025-12-29'
            ),
            NOTES.datesAfterLastClose('A', ['2026-02-01'], '2026-01-14'),
        ]);
        expect(result.asOf).toBe('2026-01-14');
        expect(result.correlation).toBeUndefined();
    });

    it('exact dates need no note', () => {
        const result = statsOf(US_A, { kind: 'none' }, ['2026-01-02']);
        expect(result.subjects[0]?.summary).toBe('A closes: 2026-01-02 106');
        expect(result.notes).toBeUndefined();
    });

    it('lookups ride along with a window', () => {
        const result = statsOf(US_A, ytd, ['2026-01-02']);
        expect(result.subjects[0]).toMatchObject({
            window: { baseDate: '2025-12-31' },
            closes: [
                {
                    requestedDate: '2026-01-02',
                    date: '2026-01-02',
                    close: 106,
                    status: 'exact',
                },
            ],
        });
        expect(result.subjects[0]?.summary).toContain(
            ' | A closes: 2026-01-02 106'
        );
    });

    it('a window without dates has no closes key', () => {
        expect(statsOf(US_A, ytd).subjects[0]).not.toHaveProperty('closes');
    });

    it('today counts as after the last close while a session is in progress', () => {
        const result = computePriceStats(
            [subject('A', US_A, { sessionInProgress: true })],
            request({ kind: 'none' }, ['2026-01-15'])
        );
        expect(result.subjects[0]?.closes).toEqual([
            {
                requestedDate: '2026-01-15',
                date: null,
                close: null,
                status: 'after_last_close',
            },
        ]);
        expect(result.notes).toEqual([
            NOTES.datesAfterLastClose('A', ['2026-01-15'], '2026-01-14'),
            NOTES.sessionInProgress('A', '2026-01-14'),
        ]);
    });
});

describe('computePriceStats: notes and echo', () => {
    it('adds the always-open note for a crypto subject', () => {
        const result = computePriceStats(
            [subject('BTC', US_A, { market: 'crypto', alwaysOpen: true })],
            request(ytd)
        );
        expect(result.notes).toEqual([NOTES.alwaysOpenCloses('BTC')]);
        // a close dated D is the price at the END of that UTC date, not at its start
        expect(NOTES.alwaysOpenCloses('BTC')).toBe(
            'BTC: trades around the clock; the close dated D is the price at the end of that UTC date (00:00 UTC the next day), not an exchange close.'
        );
    });

    it('names the argument that overrode an ignored one', () => {
        const result = statsOf(US_A, {
            kind: 'range',
            from: '2026-01-05',
            to: null,
        });
        expect(result.notes).toBeUndefined();
        const both = computePriceStats(
            [subject('A', US_A)],
            request(
                { kind: 'range', from: '2026-01-05', to: null },
                [],
                ['period', 'year']
            )
        );
        expect(both.notes).toEqual([
            NOTES.argumentIgnored('period', 'from'),
            NOTES.argumentIgnored('year', 'from'),
        ]);
        const overYear = computePriceStats(
            [subject('A', SPARSE)],
            request({ kind: 'year', year: 2025 }, [], ['period'])
        );
        expect(overYear.notes).toEqual([
            NOTES.argumentIgnored('period', 'year'),
        ]);
    });

    it('echoes the window the figures cover', () => {
        const echo = (window: PriceStatsWindowRequest) =>
            statsOf(US_A, window).window;
        expect(echo({ kind: 'period', period: 'ytd' })).toEqual({
            kind: 'period',
            period: 'ytd',
        });
        expect(echo({ kind: 'year', year: 2025 })).toEqual({
            kind: 'year',
            year: 2025,
        });
        expect(
            echo({ kind: 'range', from: '2026-01-05', to: '2026-01-09' })
        ).toEqual({ kind: 'range', from: '2026-01-05', to: '2026-01-09' });
        expect(echo({ kind: 'range', from: '2026-01-05', to: null })).toEqual({
            kind: 'range',
            from: '2026-01-05',
        });
        expect(echo({ kind: 'none' })).toEqual({ kind: 'none' });
    });

    it('asOf is the latest end date among the subjects', () => {
        const result = computePriceStats(
            [subject('A', US_A), subject('B', US_A.slice(0, 8))],
            request({ kind: 'period', period: 'max' })
        );
        expect(result.asOf).toBe('2026-01-14');
        expect(result.subjects.map(view => view.subject)).toEqual(['A', 'B']);
    });

    it('a subject with no closes has no figures and no window', () => {
        const result = computePriceStats([subject('A', [])], request(ytd));
        expect(result.subjects[0]).toEqual({
            subject: 'A',
            window: null,
            returnPct: null,
            cagrPct: null,
            highestClose: null,
            lowestClose: null,
            fromHighestClosePct: null,
            maxDrawdown: null,
            summary: 'A: no closes',
        });
        expect(result.asOf).toBe('');
    });

    it('drops invalid prices and dates and sorts the rest', () => {
        const result = statsOf(
            closesOf([
                ['2026-01-05', 105],
                ['2025-12-31', 104],
                ['2025-12-31', 999],
                ['2026-01-02', Number.NaN],
                ['2026-01-03', 0],
                ['2026-02-30', 100],
            ]),
            ytd
        );
        expect(result.subjects[0]).toMatchObject({
            window: { baseDate: '2025-12-31', baseClose: 104, sessions: 1 },
            returnPct: 0.96,
        });
    });
});

describe('computePriceStats: summary lines', () => {
    it('prints a year-to-date line with the drawdown and its recovery', () => {
        expect(statsOf(US_A, ytd).subjects[0]?.summary).toBe(
            'A 2025-12-31 → 2026-01-14 (9 sessions): close 104 → 110.5, +6.25%; highest close 111 (2026-01-13), -0.45% from it; max drawdown -10% from 2026-01-06 to 2026-01-08, recovered 2026-01-13'
        );
    });

    it('says when the drawdown has not recovered by the window end', () => {
        expect(statsOf(US_A.slice(0, 10), ytd).subjects[0]?.summary).toBe(
            'A 2025-12-31 → 2026-01-12 (7 sessions): close 104 → 109, +4.81%; highest close 110 (2026-01-06), -0.91% from it; max drawdown -10% from 2026-01-06 to 2026-01-08, not recovered by 2026-01-12'
        );
    });

    it('adds the annual rate and says when no close fell below an earlier one', () => {
        expect(
            statsOf(SPARSE, { kind: 'period', period: '3y' }).subjects[0]
                ?.summary
        ).toBe(
            'A 2023-11-17 → 2026-11-20 (8 sessions): close 30 → 80, +166.67% (annual rate +38.54%); highest close 80 (2026-11-20), 0% from it; no fall of 0.01% or more from an earlier close'
        );
    });

    it('groups thousands in the session count and uses the singular for one', () => {
        const longSeries = allDays('2020-01-01', 1501).map((date, i) => ({
            date,
            close: 100 + i,
        }));
        expect(
            statsOf(longSeries, { kind: 'period', period: 'max' }).subjects[0]
                ?.summary
        ).toContain('(1,500 sessions)');
        expect(
            statsOf(
                closesOf([
                    ['2026-01-02', 100],
                    ['2026-01-05', 90],
                ]),
                { kind: 'period', period: 'max' }
            ).subjects[0]?.summary
        ).toContain('(1 session)');
    });
});

describe('computePriceStats: correlation', () => {
    const days70 = weekdays('2026-01-05', 70);
    const base70 = oscillating(days70, 100, 110);

    function pair(
        first: readonly MarketDailyClose[],
        second: readonly MarketDailyClose[],
        overrides: Partial<PriceStatsSubjectInput> = {}
    ): PriceStatsResult {
        return computePriceStats(
            [subject('A', first, overrides), subject('B', second, overrides)],
            request({ kind: 'period', period: 'max' })
        );
    }

    it('is 1 for proportional series and -1 for opposite moves, daily and weekly', () => {
        expect(pair(base70, scaled(base70, 2)).correlation).toEqual([
            {
                subjects: ['A', 'B'],
                daily: {
                    coefficient: 1,
                    observations: 69,
                    from: '2026-01-05',
                    to: '2026-04-10',
                },
                weekly: {
                    coefficient: 1,
                    observations: 13,
                    from: '2026-01-09',
                    to: '2026-04-10',
                },
            },
        ]);
        const anti = pair(base70, oscillating(days70, 100, 90));
        expect(anti.correlation?.[0]).toMatchObject({
            daily: { coefficient: -1, observations: 69 },
            weekly: { coefficient: -1, observations: 13 },
        });
        expect(anti.notes).toBeUndefined();
    });

    it('is null, not NaN, for a flat series, with its own note', () => {
        const result = pair(base70, oscillating(days70, 50, 50));
        expect(result.correlation?.[0]).toMatchObject({
            daily: { coefficient: null, observations: 69 },
            weekly: { coefficient: null, observations: 13 },
        });
        expect(result.notes).toEqual([
            NOTES.correlationFlat('A', 'B', 'daily', 69),
            NOTES.correlationFlat('A', 'B', 'weekly', 13),
        ]);
        expect(NOTES.correlationFlat('A', 'B', 'daily', 69)).toContain(
            'do not vary'
        );
    });

    it('prints the weekly coefficient at exactly the minimum observations', () => {
        const days65 = weekdays('2026-01-05', 65);
        const result = pair(
            oscillating(days65, 100, 110),
            oscillating(days65, 200, 220)
        );
        expect(result.correlation?.[0]?.weekly).toMatchObject({
            coefficient: 1,
            observations: PRICE_STATS_MIN_WEEKLY_OBSERVATIONS,
        });
        expect(result.notes).toBeUndefined();
    });

    it('gives no coefficient below the minimum observations and says so', () => {
        const days20 = weekdays('2026-01-05', 20);
        const result = pair(
            oscillating(days20, 100, 110),
            oscillating(days20, 200, 220)
        );
        expect(result.correlation?.[0]).toMatchObject({
            daily: { coefficient: null, observations: 19 },
            weekly: { coefficient: null, observations: 3 },
        });
        expect(result.notes).toEqual([
            NOTES.correlationTooFew(
                'A',
                'B',
                'daily',
                19,
                PRICE_STATS_MIN_DAILY_OBSERVATIONS
            ),
            NOTES.correlationTooFew(
                'A',
                'B',
                'weekly',
                3,
                PRICE_STATS_MIN_WEEKLY_OBSERVATIONS
            ),
        ]);
    });

    it('prints the daily coefficient at exactly the minimum observations', () => {
        const days21 = weekdays('2026-01-05', 21);
        const result = pair(
            oscillating(days21, 100, 110),
            oscillating(days21, 200, 220)
        );
        expect(result.correlation?.[0]?.daily).toMatchObject({
            coefficient: 1,
            observations: PRICE_STATS_MIN_DAILY_OBSERVATIONS,
        });
        expect(result.notes).toEqual([
            NOTES.correlationTooFew(
                'A',
                'B',
                'weekly',
                4,
                PRICE_STATS_MIN_WEEKLY_OBSERVATIONS
            ),
        ]);
    });

    it('measures returns between shared dates when one side has a holiday', () => {
        const days25 = weekdays('2026-01-05', 25);
        const a = oscillating(days25, 100, 110);
        // B was closed on the 8th, 9th and 16th dates
        const b = scaled(
            a.filter((_, i) => ![7, 8, 15].includes(i)),
            2
        );
        const result = pair(a, b);
        expect(result.correlation?.[0]?.daily).toEqual({
            coefficient: 1,
            observations: 21,
            from: '2026-01-05',
            to: '2026-02-06',
        });
    });

    it('limits the pair to the window both subjects share', () => {
        const days40 = weekdays('2026-01-05', 40);
        const a = oscillating(days40, 100, 110);
        // B's history starts on the 4th date and ends two dates early
        const b = scaled(a.slice(3, 38), 2);
        const result = pair(a, b);
        expect(result.correlation?.[0]?.daily).toEqual({
            coefficient: 1,
            observations: 34,
            from: '2026-01-08',
            to: '2026-02-25',
        });
        expect(result.notes?.[0]).toBe(
            NOTES.endsDiffer('A', '2026-02-27', 'B', '2026-02-25')
        );
    });

    it('samples weekly on the last shared date of each Monday-to-Sunday week', () => {
        const week = allDays('2026-01-05', 98);
        const a = oscillating(week, 100, 110);
        const result = pair(a, scaled(a, 2), {
            market: 'crypto',
            alwaysOpen: true,
        });
        expect(result.correlation?.[0]).toMatchObject({
            daily: { coefficient: 1, observations: 97 },
            weekly: {
                coefficient: 1,
                observations: 13,
                from: '2026-01-11',
                to: '2026-04-12',
            },
        });
        expect(result.notes).toEqual([
            NOTES.alwaysOpenCloses('A'),
            NOTES.alwaysOpenCloses('B'),
        ]);
    });

    it('keeps a week whose Monday was a holiday as one week', () => {
        const withoutMonday = days70.filter(date => date !== '2026-02-16');
        const a = oscillating(withoutMonday, 100, 110);
        const result = pair(a, scaled(a, 2));
        expect(result.correlation?.[0]).toMatchObject({
            daily: { coefficient: 1, observations: 68 },
            weekly: { coefficient: 1, observations: 13 },
        });
    });

    it('notes a cross-market pair', () => {
        const result = computePriceStats(
            [
                subject('A', base70, { market: 'us' }),
                subject('B', scaled(base70, 2), { market: 'kr' }),
            ],
            request({ kind: 'period', period: 'max' })
        );
        expect(result.notes).toEqual([NOTES.crossMarket('A', 'B', 'us', 'kr')]);
    });

    it('returns one pair per combination in input order for three subjects', () => {
        const result = computePriceStats(
            [
                subject('A', base70),
                subject('B', scaled(base70, 2)),
                subject('C', oscillating(days70, 100, 90)),
            ],
            request({ kind: 'period', period: 'max' })
        );
        expect(
            result.correlation?.map(c => [c.subjects, c.daily.coefficient])
        ).toEqual([
            [['A', 'B'], 1],
            [['A', 'C'], -1],
            [['B', 'C'], -1],
        ]);
    });

    it('has no correlation for one subject', () => {
        expect(
            statsOf(base70, { kind: 'period', period: 'max' }).correlation
        ).toBeUndefined();
    });

    it('a pair with a subject that has no window reports zero observations', () => {
        const result = computePriceStats(
            [subject('A', base70), subject('B', [])],
            request({ kind: 'period', period: 'max' })
        );
        expect(result.correlation?.[0]).toEqual({
            subjects: ['A', 'B'],
            daily: { coefficient: null, observations: 0, from: null, to: null },
            weekly: {
                coefficient: null,
                observations: 0,
                from: null,
                to: null,
            },
        });
    });
});

describe('priceStatsEarliestDate', () => {
    const last = '2026-11-20';
    const earliest = (
        window: PriceStatsWindowRequest,
        dates: readonly string[] = [],
        today = last
    ) => priceStatsEarliestDate(request(window, dates), last, today);

    it('takes the year of ytd from the subject today', () => {
        expect(
            priceStatsEarliestDate(request(ytd), '2026-12-31', '2027-01-02')
        ).toBe('2026-12-31');
        expect(priceStatsEarliestDate(request(ytd), '2026-12-31', 'soon')).toBe(
            '2025-12-31'
        );
    });

    it('resolves each period against the last close date', () => {
        expect(earliest({ kind: 'period', period: 'ytd' })).toBe('2025-12-31');
        expect(earliest({ kind: 'period', period: '1m' })).toBe('2026-10-20');
        expect(earliest({ kind: 'period', period: '1y' })).toBe('2025-11-20');
        expect(earliest({ kind: 'period', period: '3y' })).toBe('2023-11-20');
        expect(earliest({ kind: 'period', period: '10y' })).toBe('2016-11-20');
    });

    it('is null for max, even with dates', () => {
        expect(earliest({ kind: 'period', period: 'max' })).toBeNull();
        expect(
            earliest({ kind: 'period', period: 'max' }, ['2026-01-02'])
        ).toBeNull();
    });

    it('uses the previous year-end for a calendar year and the start for a range', () => {
        expect(earliest({ kind: 'year', year: 2024 })).toBe('2023-12-31');
        expect(earliest({ kind: 'range', from: '2026-03-02', to: null })).toBe(
            '2026-03-02'
        );
    });

    it('lets an earlier requested date move it back, and ignores a later one', () => {
        expect(earliest({ kind: 'period', period: '1y' }, ['2024-07-03'])).toBe(
            '2024-07-03'
        );
        expect(earliest({ kind: 'period', period: '1y' }, ['2026-07-03'])).toBe(
            '2025-11-20'
        );
    });

    it('with only dates is the earliest date, or the anchor when there are none', () => {
        expect(earliest({ kind: 'none' }, ['2026-07-03', '2026-01-02'])).toBe(
            '2026-01-02'
        );
        expect(earliest({ kind: 'none' })).toBe(last);
    });
});

describe('PRICE_STATS_NOTE_TEMPLATES', () => {
    it('each note names its subject and the dates it is about', () => {
        expect(NOTES.historyStart('A', '2020-01-01', '2021-02-03')).toContain(
            'A: '
        );
        expect(NOTES.historyStart('A', '2020-01-01', '2021-02-03')).toContain(
            '2020-01-01'
        );
        expect(
            NOTES.windowBeforeHistory('A', '2019-12-31', '2021-02-03')
        ).toContain('2019-12-31');
        expect(
            NOTES.windowEndsAtLastClose('A', '2026-12-31', '2026-11-20')
        ).toContain('2026-11-20');
        expect(NOTES.noSessionInWindow('A', '2026-11-20')).toContain(
            '0 return'
        );
        expect(NOTES.datesPreviousSession('A', ['x → y'])).toContain(
            'Name both dates'
        );
        expect(NOTES.datesBeforeHistory('A', ['d1', 'd2'], 'f')).toContain(
            'd1, d2'
        );
        expect(NOTES.datesAfterLastClose('A', ['d1'], 'l')).toContain(
            'never use a live price'
        );
        expect(NOTES.sessionInProgress('A', '2026-11-20')).toContain(
            'excluded'
        );
        expect(NOTES.alwaysOpenCloses('BTC')).not.toContain('of its date');
        expect(NOTES.argumentIgnored('period', 'from')).toContain('from');
        expect(NOTES.crossMarket('A', 'B', 'us', 'kr')).toContain('weekly');
        expect(NOTES.endsDiffer('A', 'e1', 'B', 'e2')).toContain('e2');
        expect(NOTES.correlationTooFew('A', 'B', 'daily', 3, 20)).toContain(
            'no daily correlation'
        );
    });
});
