import { round2 } from '@/domain/agent/statsMath';
import type { MarketDailyClose } from '@/domain/types';

/** Result of {@link calendarPeriodChange}: the base session and the change against it. */
export interface CalendarPeriodChange {
    /** Date of the base close: the last session on or before the period's start date. */
    baseDate: string;
    baseClose: number;
    /** Last close against `baseClose`, 2 decimals. */
    pct: number;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS_PER_YEAR = 12;
const RATIO_TO_PERCENT = 100;

function pad2(value: number): string {
    return String(value).padStart(2, '0');
}

/** `true` for a real `YYYY-MM-DD` calendar date: the shape matches and the date round-trips (no `2026-02-30`). */
export function isIsoDate(value: string): boolean {
    const match = ISO_DATE.exec(value);
    if (match === null) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const probe = new Date(Date.UTC(year, month - 1, day));
    return (
        probe.getUTCFullYear() === year &&
        probe.getUTCMonth() === month - 1 &&
        probe.getUTCDate() === day
    );
}

/**
 * `YYYY-MM-DD` minus `months` calendar months, with the day clamped to the
 * target month's length (03-31 minus 1 month is 02-28 or 02-29; a leap day
 * minus a year is 02-28). Pure UTC arithmetic, so no timezone can shift it.
 * The input must be a valid date (see {@link isIsoDate}).
 */
export function minusCalendarMonths(isoDate: string, months: number): string {
    const [year = 0, month = 1, day = 1] = isoDate.split('-').map(Number);
    const monthIndex = year * MONTHS_PER_YEAR + (month - 1) - months;
    const targetYear = Math.floor(monthIndex / MONTHS_PER_YEAR);
    const targetMonth = monthIndex - targetYear * MONTHS_PER_YEAR; // 0-based
    // Day 0 of the following month is the last day of `targetMonth`.
    const daysInMonth = new Date(
        Date.UTC(targetYear, targetMonth + 1, 0)
    ).getUTCDate();
    return `${targetYear}-${pad2(targetMonth + 1)}-${pad2(Math.min(day, daysInMonth))}`;
}

/** Result of {@link normalizeCloses}. */
export interface NormalizedCloses {
    /** Usable closes ascending by date, one per date. */
    closes: MarketDailyClose[];
    /** Repeated-date rows removed; the date keeps its first usable row, so they are not unusable. */
    duplicates: number;
    /** Dates of the rows whose date or price was unusable (a repeated date still has a close and is not listed). */
    unusableDates: string[];
}

function isUsableClose(close: MarketDailyClose): boolean {
    return (
        isIsoDate(close.date) && Number.isFinite(close.close) && close.close > 0
    );
}

/**
 * The one cleaning rule for a close series: rows with an invalid date or a
 * price that is not finite and above zero are dropped, the rest sorted by
 * date, and the first of a repeated date wins. Every period function reads
 * the series through this, so two functions never disagree on which rows
 * count.
 */
export function normalizeCloses(
    closes: readonly MarketDailyClose[]
): NormalizedCloses {
    const usable = closes
        .filter(isUsableClose)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const unique = usable.filter(
        (close, i) => usable[i - 1]?.date !== close.date
    );
    return {
        closes: unique,
        duplicates: usable.length - unique.length,
        unusableDates: closes
            .filter(close => !isUsableClose(close))
            .map(close => close.date),
    };
}

/** Greatest index in `[low, high]` whose date is on or before `date`; `low - 1` when none. */
function searchOnOrBefore(
    closes: readonly MarketDailyClose[],
    date: string,
    low: number,
    high: number
): number {
    if (low > high) return high;
    const mid = Math.floor((low + high) / 2);
    const midDate = closes[mid]?.date ?? '';
    return midDate <= date
        ? searchOnOrBefore(closes, date, mid + 1, high)
        : searchOnOrBefore(closes, date, low, mid - 1);
}

/**
 * Index of the last close dated on or before `date`, or `-1` when the series
 * starts after it (or is empty). `closes` is ascending by date; the search is
 * a binary search, so it is cheap on a full price history.
 *
 * This is the one rule for where a period starts: the base of a window is the
 * close of the last session on or before the start date, so a weekend or
 * holiday start date resolves to the session before it.
 */
export function closeOnOrBefore(
    closes: readonly MarketDailyClose[],
    date: string
): number {
    return searchOnOrBefore(closes, date, 0, closes.length - 1);
}

/**
 * Last close against the close on or before (last date minus `months`
 * calendar months). `baseDate`/`baseClose` name the base session so an answer
 * can say which day the period starts on.
 *
 * @param closes - Completed sessions ascending by date; rows are cleaned by
 *   {@link normalizeCloses} first, so an unusable last row is skipped.
 * @param months - A positive integer number of calendar months.
 * @returns `null` when no usable close remains, the series does not reach back
 *   that far, or `months` is not a positive integer.
 */
export function calendarPeriodChange(
    closes: readonly MarketDailyClose[],
    months: number
): CalendarPeriodChange | null {
    if (!Number.isInteger(months) || months <= 0) return null;
    const { closes: usable } = normalizeCloses(closes);
    const last = usable.at(-1);
    if (last === undefined) return null;
    const baseIndex = closeOnOrBefore(
        usable,
        minusCalendarMonths(last.date, months)
    );
    const base = usable[baseIndex];
    // `-1`: the series begins after the target date. The last close itself can
    // never qualify (it is dated after the target), so a hit is always older.
    if (base === undefined) return null;
    return {
        baseDate: base.date,
        baseClose: base.close,
        pct: round2((last.close / base.close - 1) * RATIO_TO_PERCENT),
    };
}
