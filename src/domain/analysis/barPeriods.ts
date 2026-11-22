import { hasUsablePrices } from '@/domain/analysis/analysisUtils';
import {
    DAYS_PER_WEEK,
    MS_PER_DAY,
    MS_PER_HOUR,
    MS_PER_SECOND,
} from '@/domain/constants/time';
import {
    isRegularSessionOpen,
    nextRegularSessionBoundaryMs,
} from '@/domain/session';
import type { Bar, MarketSessionSpec } from '@/domain/types';

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

/**
 * The market clock the unfinished-period checks need: the listing's session schedule and
 * the instant the analysis is made at. Same shape as `MarketReferenceClock`; supplied by the
 * caller, because domain code never reads the wall clock.
 *
 * @internal
 */
export interface PeriodClock {
    readonly session: MarketSessionSpec;
    readonly now: Date;
}

/**
 * Whether the period of `bar` (a weekly or monthly bar, stamped at its period start) is
 * over at `clock.now`.
 *
 * - `now` lies in a later period: finished (the feed has not produced a newer bar yet, or
 *   the weekend has begun).
 * - `now` lies in the bar's own period on a `scheduled` session: finished when the market
 *   is not in a regular session and the **next regular open** falls in a later period.
 *   The session spec carries the exchange calendar, so a holiday-shortened week (the last
 *   session is a Thursday) is finished after that Thursday's close.
 * - `always-open` session, `now` in the bar's period: never finished (a 24/7 week ends at
 *   the UTC period boundary, which the first rule already covers).
 * - No clock: `false`, the prior behaviour (the last bar is treated as still forming).
 *
 * Pure: the instant comes from `clock`, never from the environment.
 *
 * @internal
 */
export function isLastPeriodBarFinished(
    bar: { readonly time: number },
    period: BarPeriod,
    clock: PeriodClock | undefined
): boolean {
    if (clock === undefined) return false;
    const { session, now } = clock;
    const barStartMs = barPeriodStartSeconds(period, bar.time) * MS_PER_SECOND;
    const nowStartMs =
        barPeriodStartSeconds(period, now.getTime() / MS_PER_SECOND) *
        MS_PER_SECOND;
    if (nowStartMs !== barStartMs) return nowStartMs > barStartMs;
    if (session.kind === 'always-open') return false;
    if (isRegularSessionOpen(session, now)) return false;
    const nextOpenMs = nextRegularSessionBoundaryMs(session, now, 'open');
    if (nextOpenMs === null) return false;
    return (
        barPeriodStartSeconds(period, nextOpenMs / MS_PER_SECOND) *
            MS_PER_SECOND >
        barStartMs
    );
}

/** @internal Sessions of an unfinished week or month: the daily bars seen so far and the sessions scheduled. */
export interface PeriodProgress {
    /** Daily bars with usable prices inside the period (observed). */
    readonly sessionsSoFar: number;
    /**
     * Sessions the exchange calendar schedules for the whole period (a holiday is not one), or
     * `null` when the session spec carries no holiday data (no `closeMinuteFor`): a plain weekday
     * schedule cannot prove a period has its nominal sessions (DOM-12), so no total is claimed.
     */
    readonly sessionsTotal: number | null;
}

const SESSION_PROBE_HOUR_UTC = 12;

/** The first instant after the period that starts at `startMs`: the next Monday or the 1st of the next month. */
function periodEndMs(period: BarPeriod, startMs: number): number {
    if (period === 'week') return startMs + DAYS_PER_WEEK * MS_PER_DAY;
    const start = new Date(startMs);
    return Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1);
}

/**
 * Sessions the session spec schedules in the period `[startMs, endMs)`: every non-weekend day
 * whose close minute is positive (`closeMinuteFor` returns `0` on a holiday), or every day on
 * a 24/7 session. Each bar's UTC date is its trading date, so the calendar date of a day is
 * read at UTC noon, which lies on the same local date for every zone within ±12h of UTC.
 */
function scheduledSessionsInPeriod(
    session: MarketSessionSpec,
    startMs: number,
    endMs: number
): number | null {
    const days = Math.round((endMs - startMs) / MS_PER_DAY);
    if (session.kind === 'always-open') return days;
    // The capability flag is the calendar itself: a spec without `closeMinuteFor` knows weekends
    // only, so a holiday period would be counted with its holidays as sessions.
    if (session.closeMinuteFor === undefined) return null;
    return Array.from({ length: days }, (_, i) => {
        const dayMs = startMs + i * MS_PER_DAY;
        const probe = new Date(dayMs + SESSION_PROBE_HOUR_UTC * MS_PER_HOUR);
        if (session.weekendDays.includes(probe.getUTCDay())) return 0;
        const closeMinute =
            session.closeMinuteFor?.(probe) ?? session.closeMinute;
        return closeMinute > 0 ? 1 : 0;
    }).reduce<number>((sum, n) => sum + n, 0);
}

/**
 * The progress of the last weekly or monthly bar, or `null` when there is nothing to say: no
 * clock, no bar, or the period is finished. "So far" counts the daily bars actually observed
 * in the period and "total" counts the sessions the calendar schedules (DOM-12: observed vs
 * scheduled, never one inferred from the other).
 *
 * @param period - `'week'` (ISO, Monday start) or `'month'` (UTC calendar month).
 * @param lastPeriodBar - The newest period bar (stamped at its period start).
 * @param dailyBars - The daily series the period bars were aggregated from; `undefined`
 *   (unknown) prints nothing.
 *
 * @internal
 */
export function lastPeriodProgress(
    period: BarPeriod,
    lastPeriodBar: { readonly time: number } | undefined,
    dailyBars: readonly Bar[] | undefined,
    clock: PeriodClock | undefined
): PeriodProgress | null {
    // Unknown is not "0 observed": without the daily series nothing can be said.
    if (
        lastPeriodBar === undefined ||
        clock === undefined ||
        dailyBars === undefined
    ) {
        return null;
    }
    if (isLastPeriodBarFinished(lastPeriodBar, period, clock)) return null;
    const startMs =
        barPeriodStartSeconds(period, lastPeriodBar.time) * MS_PER_SECOND;
    const endMs = periodEndMs(period, startMs);
    return {
        sessionsSoFar: dailyBars.filter(
            bar =>
                hasUsablePrices(bar) &&
                bar.time * MS_PER_SECOND >= startMs &&
                bar.time * MS_PER_SECOND < endMs
        ).length,
        sessionsTotal: scheduledSessionsInPeriod(clock.session, startMs, endMs),
    };
}
