import {
    MARKET_CLOSE_HOUR,
    MARKET_CLOSE_MINUTE,
    MINUTES_PER_DAY,
} from '@/domain/constants/time';

/**
 * NYSE holiday + early-close calendar, computed rather than fetched.
 *
 * Every NYSE closure is rule-derived: four fixed dates with a weekend-observance
 * shift, five nth-weekday dates, and Good Friday (Easter − 2). Early closes are
 * likewise conditional rules, not a data feed. A network call would trade a
 * deterministic answer for one that can 429, time out, or change shape — and it
 * would do so on the precondition of every trading decision ("is the market open
 * right now"), where neither failure direction is acceptable: assume open and we
 * trade on a holiday, assume closed and we halt on a normal day.
 *
 * Verified against the NYSE Group / ICE published calendar for 2025, 2026 and
 * 2027 — see `__tests__/domain/marketCalendar.test.ts`, which encodes that
 * calendar verbatim as the expected output.
 *
 * **Unscheduled closures are a list, not a rule** — see {@link UNSCHEDULED_CLOSURES}.
 * They are rarer than the scheduled calendar but not rare enough to ignore: the
 * most recent was 2025-01-09 (national day of mourning for Jimmy Carter), and
 * before that 2018-12-05, 2012-10-29/30, 2007-01-02, 2004-06-11, 2001-09-11..14.
 * Roughly once every three to four years. No algorithm can derive them and no
 * calendar API publishes them ahead of the announcement, so the only honest
 * handling is a short literal list that gets one more entry when one is declared.
 */

/** ET minutes-since-midnight of a regular close (16:00). */
export const REGULAR_CLOSE_MINUTE =
    MARKET_CLOSE_HOUR * 60 + MARKET_CLOSE_MINUTE;

/** ET minutes-since-midnight of a half-day close (13:00). */
export const EARLY_CLOSE_MINUTE = 13 * 60;

/**
 * First year NYSE observed Juneteenth (June 20, 2022 — June 19 fell on a Sunday).
 * Dates before this must not report it as a holiday, or backtests over older
 * bars would skip a day the market actually traded.
 */
const JUNETEENTH_FIRST_YEAR = 2022;

/**
 * Closures the exchange announced outside its published calendar, as
 * `YYYY-MM-DD` in ET.
 *
 * Deliberately a literal list. These are declared days — a presidential funeral,
 * a hurricane — with no derivable rule behind them, and they are announced days
 * or hours ahead, which is later than any calendar API would help. A release
 * every few years is the cost; the alternative is trading into a closed market
 * or, worse, believing a stale feed that says the market is open.
 *
 * **This list can only ever be right about the past.** That is not a defect to
 * fix but a boundary to respect, and it decides where each caller should look:
 *
 * - *Backtests and scheduling* — this list is the answer. Past entries make a
 *   run over historical bars skip the same days the market did.
 * - *Placing a real order* — the broker is the answer. It rejects orders on a
 *   closed market whether or not this list knows about the day, which is why a
 *   stale entry here cannot cause a trade into a closed market.
 *
 * The residual cost of a missing entry is therefore wasted work, not a bad
 * trade: analysis jobs burn one day of quota on a market that never opened.
 * At roughly one unscheduled closure every three to four years that is cheaper
 * than any mechanism to detect them, all of which would have to be live and
 * could fail in the far more expensive direction.
 */
export const UNSCHEDULED_CLOSURES: ReadonlySet<string> = new Set([
    '2012-10-29', // Hurricane Sandy
    '2012-10-30', // Hurricane Sandy
    '2018-12-05', // National day of mourning — George H. W. Bush
    '2025-01-09', // National day of mourning — Jimmy Carter
]);

/** @internal Calendar date in the exchange's local (ET) terms. */
export interface EtCalendarDate {
    year: number;
    /** 1-12. */
    month: number;
    /** 1-31. */
    day: number;
    /** 0 = Sun … 6 = Sat. */
    weekday: number;
}

const _etDateFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
});

const WEEKDAY_INDEX: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
};

/**
 * @internal Decompose an instant into its ET calendar date.
 *
 * Uses `Intl` rather than UTC arithmetic so DST transitions are the platform's
 * problem, not ours — the same reason `session.ts` does.
 */
export function etCalendarDate(now: Date): EtCalendarDate {
    const parts = _etDateFormatter.formatToParts(now);
    const get = (type: Intl.DateTimeFormatPartTypes): string =>
        parts.find(p => p.type === type)?.value ?? '';
    return {
        year: Number(get('year')),
        month: Number(get('month')),
        day: Number(get('day')),
        weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
    };
}

/** @internal `MM-DD` key used by the per-year holiday sets. */
function key(month: number, day: number): string {
    return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** @internal Weekday (0=Sun…6=Sat) of a Gregorian date, via UTC to avoid local-zone drift. */
function weekdayOf(year: number, month: number, day: number): number {
    return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** @internal Day-of-month of the `n`th `weekday` in a month (n is 1-based). */
function nthWeekday(
    year: number,
    month: number,
    weekday: number,
    n: number
): number {
    const firstWeekday = weekdayOf(year, month, 1);
    const offset = (weekday - firstWeekday + 7) % 7;
    return 1 + offset + (n - 1) * 7;
}

/** @internal Day-of-month of the last `weekday` in a month. */
function lastWeekday(year: number, month: number, weekday: number): number {
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const lastWeekdayIndex = weekdayOf(year, month, daysInMonth);
    return daysInMonth - ((lastWeekdayIndex - weekday + 7) % 7);
}

/**
 * @internal Easter Sunday (Gregorian), by the Anonymous Gregorian algorithm.
 *
 * Exact for 1583–4099, which covers every date this library will ever be asked
 * about. Good Friday is Easter − 2 days.
 */
function easterSunday(year: number): { month: number; day: number } {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return { month, day };
}

/** @internal Shift a Gregorian date by whole days. */
function addDays(
    year: number,
    month: number,
    day: number,
    delta: number
): { year: number; month: number; day: number } {
    const d = new Date(Date.UTC(year, month - 1, day + delta));
    return {
        year: d.getUTCFullYear(),
        month: d.getUTCMonth() + 1,
        day: d.getUTCDate(),
    };
}

/**
 * @internal Observed date of a fixed-date holiday, or `null` when it is not
 * observed at all.
 *
 * Saturday shifts to the preceding Friday and Sunday to the following Monday —
 * **except New Year's Day on a Saturday, which the NYSE does not observe.**
 * Shifting it back would close December 31, the last trading day of the previous
 * year, which the exchange declines to do. Its own calendar states this outright:
 * "Because the holiday falls on Saturday, January 1, 2028, no New Year's Day
 * holiday is observed."
 */
function observedFixedDate(
    year: number,
    month: number,
    day: number
): { month: number; day: number } | null {
    const weekday = weekdayOf(year, month, day);
    if (weekday === 6) {
        if (month === 1 && day === 1) return null;
        const prev = addDays(year, month, day, -1);
        return { month: prev.month, day: prev.day };
    }
    if (weekday === 0) {
        const next = addDays(year, month, day, 1);
        return { month: next.month, day: next.day };
    }
    return { month, day };
}

interface YearCalendar {
    /** `MM-DD` of every full closure. */
    holidays: ReadonlySet<string>;
    /** `MM-DD` of every 1:00 p.m. close. */
    earlyCloses: ReadonlySet<string>;
}

const _cache = new Map<number, YearCalendar>();

/** @internal Build (and memoize) the NYSE calendar for one year. */
function calendarFor(year: number): YearCalendar {
    const cached = _cache.get(year);
    if (cached) return cached;

    const holidays = new Set<string>();
    const addFixed = (month: number, day: number): void => {
        const observed = observedFixedDate(year, month, day);
        if (observed) holidays.add(key(observed.month, observed.day));
    };

    addFixed(1, 1); // New Year's Day
    if (year >= JUNETEENTH_FIRST_YEAR) addFixed(6, 19); // Juneteenth
    addFixed(7, 4); // Independence Day
    addFixed(12, 25); // Christmas Day

    holidays.add(key(1, nthWeekday(year, 1, 1, 3))); // MLK Jr. Day
    holidays.add(key(2, nthWeekday(year, 2, 1, 3))); // Washington's Birthday
    holidays.add(key(5, lastWeekday(year, 5, 1))); // Memorial Day
    holidays.add(key(9, nthWeekday(year, 9, 1, 1))); // Labor Day

    const thanksgivingDay = nthWeekday(year, 11, 4, 4);
    holidays.add(key(11, thanksgivingDay));

    const easter = easterSunday(year);
    const goodFriday = addDays(year, easter.month, easter.day, -2);
    holidays.add(key(goodFriday.month, goodFriday.day));

    // Early closes. Each is conditional, and **a full closure always wins**:
    // when July 4 falls on a Saturday the observed holiday *is* July 3, so that
    // date is a closure rather than a half day (NYSE 2026). The same applies to
    // December 24 when Christmas falls on a Saturday (NYSE 2027).
    const earlyCloses = new Set<string>();
    const addEarlyClose = (month: number, day: number): void => {
        const weekday = weekdayOf(year, month, day);
        if (weekday === 0 || weekday === 6) return;
        const k = key(month, day);
        if (holidays.has(k)) return;
        earlyCloses.add(k);
    };

    // July 3 — only when Independence Day itself is a weekday.
    const july4Weekday = weekdayOf(year, 7, 4);
    if (july4Weekday !== 0 && july4Weekday !== 6) addEarlyClose(7, 3);

    // The day after Thanksgiving is always a Friday, so it needs no guard
    // beyond the shared holiday check.
    const dayAfterThanksgiving = addDays(year, 11, thanksgivingDay, 1);
    addEarlyClose(dayAfterThanksgiving.month, dayAfterThanksgiving.day);

    // December 24 — only when Christmas Day itself is a weekday.
    const dec25Weekday = weekdayOf(year, 12, 25);
    if (dec25Weekday !== 0 && dec25Weekday !== 6) addEarlyClose(12, 24);

    const built: YearCalendar = { holidays, earlyCloses };
    _cache.set(year, built);
    return built;
}

/**
 * Whether the U.S. equity market is fully closed on the ET calendar day
 * containing `now` (weekends excluded — this reports *holidays* only).
 *
 * @param now - The instant to test.
 * @returns `true` on an NYSE full-closure date.
 */
export function isUsMarketHoliday(now: Date): boolean {
    const { year, month, day } = etCalendarDate(now);
    if (UNSCHEDULED_CLOSURES.has(`${year}-${key(month, day)}`)) return true;
    return calendarFor(year).holidays.has(key(month, day));
}

/**
 * Whether the ET calendar day containing `now` is a 1:00 p.m. half day.
 *
 * @param now - The instant to test.
 * @returns `true` on an NYSE early-close date. Always `false` on full closures.
 */
export function isUsMarketEarlyClose(now: Date): boolean {
    const { year, month, day } = etCalendarDate(now);
    // 예정 외 휴장이 반장 예정일과 겹치면 휴장이 이긴다 (전휴장 > 반장).
    if (UNSCHEDULED_CLOSURES.has(`${year}-${key(month, day)}`)) return false;
    return calendarFor(year).earlyCloses.has(key(month, day));
}

/**
 * Closing time (ET minutes since midnight) for the calendar day containing `now`.
 *
 * Returns `0` on a full closure so callers comparing `minutesOfDay < close`
 * never see an open window. Without this, a half day reads as open for the three
 * hours after the 13:00 bell — long enough for a full analysis cycle to place an
 * order into a market that is not there.
 *
 * @param now - The instant to test.
 * @returns `0` (closed), {@link EARLY_CLOSE_MINUTE}, or {@link REGULAR_CLOSE_MINUTE}.
 */
export function usMarketCloseMinute(now: Date): number {
    if (isUsMarketHoliday(now)) return 0;
    return isUsMarketEarlyClose(now)
        ? EARLY_CLOSE_MINUTE
        : REGULAR_CLOSE_MINUTE;
}

/**
 * Minutes remaining until the close of the ET calendar day containing `now`.
 *
 * @param now - The instant to test.
 * @param minutesOfDay - ET minutes since midnight for the same instant.
 * @returns Minutes to the bell, `0` once past it or on a full closure. Never
 *   exceeds {@link MINUTES_PER_DAY}.
 */
export function minutesUntilUsMarketClose(
    now: Date,
    minutesOfDay: number
): number {
    const close = usMarketCloseMinute(now);
    if (close === 0) return 0;
    const remaining = close - minutesOfDay;
    if (remaining <= 0) return 0;
    return Math.min(remaining, MINUTES_PER_DAY);
}
