import { MS_PER_DAY, MS_PER_SECOND } from '@/domain/constants/time';

/** A calendar period daily bars can be rolled up into. */
export type BarPeriod = 'week' | 'month';

/**
 * @internal Unix-ms timestamp of Monday 00:00:00 UTC for the ISO week
 * containing `unixSeconds`. ISO weeks start Monday; `getUTCDay()` returns
 * `0` for Sunday, so Sunday maps to ISO day 7 (end of the previous week's
 * bucket, not the start of a new one).
 */
export function isoWeekStartMs(unixSeconds: number): number {
    const d = new Date(unixSeconds * MS_PER_SECOND);
    const utcDay = d.getUTCDay(); // 0 (Sun) .. 6 (Sat)
    const isoDay = utcDay === 0 ? 7 : utcDay; // 1 (Mon) .. 7 (Sun)
    const daysSinceMonday = isoDay - 1;
    const dayStartMs = Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate()
    );
    return dayStartMs - daysSinceMonday * MS_PER_DAY;
}

/** @internal Unix-ms timestamp of the 1st of the UTC calendar month containing `unixSeconds`, 00:00:00 UTC. */
export function monthStartMs(unixSeconds: number): number {
    const d = new Date(unixSeconds * MS_PER_SECOND);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/**
 * Start of the ISO week (Monday) or UTC calendar month containing
 * `unixSeconds`, in Unix seconds — the same `time` that
 * {@link aggregateBarsToWeekly} / {@link aggregateBarsToMonthly} stamp on the
 * bar for that period. Lets a consumer ask "which period is this date in"
 * (for example, whether the last weekly bar is the current week) without
 * re-deriving the boundaries. Pure.
 *
 * @param period - `'week'` (ISO, Monday start, UTC) or `'month'` (UTC).
 * @param unixSeconds - Any instant; for a trading date pass its UTC midnight.
 * @returns The period's start, in Unix seconds.
 */
export function barPeriodStartSeconds(
    period: BarPeriod,
    unixSeconds: number
): number {
    const startMs =
        period === 'week'
            ? isoWeekStartMs(unixSeconds)
            : monthStartMs(unixSeconds);
    return startMs / MS_PER_SECOND;
}
