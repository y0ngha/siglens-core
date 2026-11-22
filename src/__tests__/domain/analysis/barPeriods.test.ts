import { describe, expect, it } from 'vitest';
import { aggregateBarsToMonthly } from '@/domain/analysis/aggregateBarsToMonthly';
import { aggregateBarsToWeekly } from '@/domain/analysis/aggregateBarsToWeekly';
import {
    barPeriodStartSeconds,
    isLastPeriodBarFinished,
    lastWeekProgress,
    type PeriodClock,
} from '@/domain/analysis/barPeriods';
import { CRYPTO_SESSION, US_EQUITY_SESSION } from '@/domain/session';
import type { Bar, MarketSessionSpec } from '@/domain/types';

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

const dailyBar = (y: number, m: number, d: number): Bar => ({
    time: utc(y, m, d),
    open: 10,
    high: 12,
    low: 9,
    close: 11,
    volume: 100,
});

const usClock = (now: Date): PeriodClock => ({
    session: US_EQUITY_SESSION,
    now,
});

/** 2026-11-16 is a Monday; the week of 2026-11-16 holds sessions Mon 16 to Fri 20. */
const WEEK = { time: utc(2026, 10, 16) };

describe('isLastPeriodBarFinished', () => {
    it('is false without a clock: the last bar is treated as still forming', () => {
        expect(isLastPeriodBarFinished(WEEK, 'week', undefined)).toBe(false);
    });

    it('is false while the regular session of a weekday in the week is open', () => {
        // Wednesday 2026-11-18 11:00 ET = 16:00 UTC (EST).
        const now = new Date(Date.UTC(2026, 10, 18, 16, 0));
        expect(isLastPeriodBarFinished(WEEK, 'week', usClock(now))).toBe(false);
    });

    it('is false after the close of a mid-week day: the next open is in the same week', () => {
        // Wednesday 2026-11-18 17:00 ET = 22:00 UTC.
        const now = new Date(Date.UTC(2026, 10, 18, 22, 0));
        expect(isLastPeriodBarFinished(WEEK, 'week', usClock(now))).toBe(false);
    });

    it('is true after the Friday close: the next regular open is Monday, a later week', () => {
        // Friday 2026-11-20 17:00 ET = 22:00 UTC.
        const now = new Date(Date.UTC(2026, 10, 20, 22, 0));
        expect(isLastPeriodBarFinished(WEEK, 'week', usClock(now))).toBe(true);
    });

    it('is true on the weekend of the same week', () => {
        const now = new Date(Date.UTC(2026, 10, 21, 15, 0));
        expect(isLastPeriodBarFinished(WEEK, 'week', usClock(now))).toBe(true);
    });

    it('is false during Friday trading hours', () => {
        // Friday 2026-11-20 10:00 ET = 15:00 UTC.
        const now = new Date(Date.UTC(2026, 10, 20, 15, 0));
        expect(isLastPeriodBarFinished(WEEK, 'week', usClock(now))).toBe(false);
    });

    it('is true once now is in a later week, even before the next open', () => {
        // Monday 2026-11-23 08:00 ET = 13:00 UTC, before the 09:30 open.
        const now = new Date(Date.UTC(2026, 10, 23, 13, 0));
        expect(isLastPeriodBarFinished(WEEK, 'week', usClock(now))).toBe(true);
    });

    it('is true after the last session of a holiday-shortened week', () => {
        // Thanksgiving week of 2026-11-23: Thursday 11-26 is closed. After Wednesday
        // 11-25 close the next open is Friday 11-27 (same week): not finished.
        // After Friday's 13:00 early close the next open is the following Monday.
        const week = { time: utc(2026, 10, 23) };
        const wednesdayEvening = new Date(Date.UTC(2026, 10, 25, 22, 0));
        const fridayAfterEarlyClose = new Date(Date.UTC(2026, 10, 27, 19, 0));
        expect(
            isLastPeriodBarFinished(week, 'week', usClock(wednesdayEvening))
        ).toBe(false);
        expect(
            isLastPeriodBarFinished(
                week,
                'week',
                usClock(fridayAfterEarlyClose)
            )
        ).toBe(true);
    });

    it('is true when the last session of the week is a Thursday and the Friday is a holiday', () => {
        // A Friday holiday: the next open after Thursday's close is the next Monday.
        const fridayClosed: MarketSessionSpec = {
            ...(US_EQUITY_SESSION as Extract<
                MarketSessionSpec,
                { kind: 'scheduled' }
            >),
            closeMinuteFor: now => (now.getUTCDay() === 5 ? 0 : 960),
        };
        const thursdayEvening = new Date(Date.UTC(2026, 10, 19, 22, 0));
        expect(
            isLastPeriodBarFinished(WEEK, 'week', {
                session: fridayClosed,
                now: thursdayEvening,
            })
        ).toBe(true);
    });

    it('a 24/7 session is never finished inside its own week and always after it', () => {
        const midWeek = new Date(Date.UTC(2026, 10, 18, 3, 0));
        const sundayNight = new Date(Date.UTC(2026, 10, 22, 23, 59));
        const nextMonday = new Date(Date.UTC(2026, 10, 23, 0, 0));
        const crypto = (now: Date): PeriodClock => ({
            session: CRYPTO_SESSION,
            now,
        });
        expect(isLastPeriodBarFinished(WEEK, 'week', crypto(midWeek))).toBe(
            false
        );
        expect(isLastPeriodBarFinished(WEEK, 'week', crypto(sundayNight))).toBe(
            false
        );
        expect(isLastPeriodBarFinished(WEEK, 'week', crypto(nextMonday))).toBe(
            true
        );
    });

    it('reads a monthly bar the same way', () => {
        const november = { time: utc(2026, 10, 1) };
        const midMonth = new Date(Date.UTC(2026, 10, 12, 22, 0));
        const nextMonth = new Date(Date.UTC(2026, 11, 1, 14, 0));
        expect(
            isLastPeriodBarFinished(november, 'month', usClock(midMonth))
        ).toBe(false);
        expect(
            isLastPeriodBarFinished(november, 'month', usClock(nextMonth))
        ).toBe(true);
    });

    it('is false for a bar that lies after now', () => {
        const future = { time: utc(2026, 11, 7) };
        const now = new Date(Date.UTC(2026, 10, 18, 22, 0));
        expect(isLastPeriodBarFinished(future, 'week', usClock(now))).toBe(
            false
        );
    });
});

describe('lastWeekProgress', () => {
    const wednesdayEvening = new Date(Date.UTC(2026, 10, 18, 22, 0));
    const days = [
        dailyBar(2026, 10, 16),
        dailyBar(2026, 10, 17),
        dailyBar(2026, 10, 18),
    ];

    it('counts the observed daily bars against the five scheduled sessions', () => {
        expect(lastWeekProgress(WEEK, days, usClock(wednesdayEvening))).toEqual(
            {
                sessionsSoFar: 3,
                sessionsTotal: 5,
            }
        );
    });

    it('does not count daily bars of other weeks', () => {
        const withOthers = [
            dailyBar(2026, 10, 13),
            dailyBar(2026, 10, 23),
            ...days,
        ];
        expect(
            lastWeekProgress(WEEK, withOthers, usClock(wednesdayEvening))
                ?.sessionsSoFar
        ).toBe(3);
    });

    it('skips daily bars without usable prices', () => {
        const withPlaceholder = [
            ...days,
            { ...dailyBar(2026, 10, 19), open: 0, high: 0, low: 0 },
        ];
        expect(
            lastWeekProgress(WEEK, withPlaceholder, usClock(wednesdayEvening))
                ?.sessionsSoFar
        ).toBe(3);
    });

    it('totals the sessions the calendar schedules: Thanksgiving week has four', () => {
        const thanksgivingWeek = { time: utc(2026, 10, 23) };
        const tuesdayEvening = new Date(Date.UTC(2026, 10, 24, 22, 0));
        expect(
            lastWeekProgress(
                thanksgivingWeek,
                [dailyBar(2026, 10, 23), dailyBar(2026, 10, 24)],
                usClock(tuesdayEvening)
            )
        ).toEqual({ sessionsSoFar: 2, sessionsTotal: 4 });
    });

    it('claims no total when the session spec has no holiday data (a plain weekday schedule)', () => {
        const { closeMinuteFor: _calendar, ...weekdayOnly } =
            US_EQUITY_SESSION as Extract<
                MarketSessionSpec,
                { kind: 'scheduled' }
            >;
        expect(
            lastWeekProgress(WEEK, days, {
                session: weekdayOnly,
                now: wednesdayEvening,
            })
        ).toEqual({ sessionsSoFar: 3, sessionsTotal: null });
    });

    it('totals seven days on a 24/7 session', () => {
        expect(
            lastWeekProgress(WEEK, days, {
                session: CRYPTO_SESSION,
                now: wednesdayEvening,
            })
        ).toEqual({ sessionsSoFar: 3, sessionsTotal: 7 });
    });

    it('is null for a finished week, without a clock and without a bar', () => {
        const fridayEvening = new Date(Date.UTC(2026, 10, 20, 22, 0));
        expect(lastWeekProgress(WEEK, days, usClock(fridayEvening))).toBeNull();
        expect(lastWeekProgress(WEEK, days, undefined)).toBeNull();
        expect(
            lastWeekProgress(WEEK, undefined, usClock(wednesdayEvening))
        ).toBeNull();
        expect(
            lastWeekProgress(undefined, days, usClock(wednesdayEvening))
        ).toBeNull();
    });
});
