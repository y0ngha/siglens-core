import { clockParts } from '@/domain/agent/promptShared';
import {
    DAYS_PER_WEEK,
    MS_PER_DAY,
    MS_PER_MINUTE,
} from '@/domain/constants/time';
import {
    getSessionStatus,
    localSessionParts,
    nextRegularSessionBoundaryMs,
    sessionOpenMinute,
} from '@/domain/session';
import type { MarketSessionSpec } from '@/domain/types';
import { timeZoneLabel } from './userTimeZone';

/** @internal Pre-market opens at 04:00 ET (minutes from local midnight, inclusive). */
export const US_PRE_MARKET_OPEN_MINUTE = 4 * 60;

/**
 * @internal After-hours lasts this many minutes from the day's regular close
 * (16:00 → 20:00; on a half day 13:00 → 17:00). The end is exclusive.
 */
export const US_AFTER_HOURS_MINUTES = 4 * 60;

/**
 * @internal The overnight session (23/5 trading on Nasdaq, NYSE Arca, Cboe EDGX
 * and MEMX) starts at 21:00 ET on the evening before a trading day and runs to
 * {@link US_PRE_MARKET_OPEN_MINUTE}. Inclusive start.
 */
export const US_OVERNIGHT_START_MINUTE = 21 * 60;

/**
 * @internal The industry-wide pause before the overnight session starts at
 * 20:00 ET (SIP maintenance window). Inclusive start, exclusive end at
 * {@link US_OVERNIGHT_START_MINUTE}.
 */
export const US_DAILY_PAUSE_START_MINUTE = 20 * 60;

/**
 * @internal First instant of the overnight session: Sun 2026-12-06 21:00 ET
 * (02:00 UTC on Dec 7). Before it the turn clock labels every off-hours moment
 * exactly as it did without the session, so notes stamped earlier rebuild
 * byte-identically.
 */
export const US_OVERNIGHT_LAUNCH_MS = Date.UTC(2026, 11, 7, 2, 0);

/**
 * @internal State printed during the overnight session. It says the session
 * exists and, in the same breath, what SIGLENS data does not cover, so the
 * model neither calls the market closed nor presents an overnight print as
 * SIGLENS data or as the official close.
 */
export const US_OVERNIGHT_STATE =
    'overnight session (SIGLENS quotes and charts cover only 04:00–20:00 ET; overnight trades do not set the official close)';

/**
 * @internal State printed in the 20:00–21:00 ET pause between a trading day's
 * after-hours and the overnight session that follows it.
 */
export const US_DAILY_PAUSE_STATE =
    'daily pause (overnight session from 21:00 ET)';

/**
 * @internal State printed 20:00–21:00 ET on a day that did not trade (a Sunday,
 * a holiday) when an overnight session starts at 21:00: nothing ran before, so
 * it is not a pause.
 */
export const US_CLOSED_BEFORE_OVERNIGHT_STATE =
    'closed (overnight session from 21:00 ET)';

type ScheduledSpec = Extract<MarketSessionSpec, { kind: 'scheduled' }>;

const WEEKDAY_SHORT = [
    'Sun',
    'Mon',
    'Tue',
    'Wed',
    'Thu',
    'Fri',
    'Sat',
] as const;
const WEEKDAY_FULL = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
] as const;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

/** `YYYY-MM-DD` of a UTC-midnight epoch ms. */
function isoDateOfUtcMs(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
}

/** @internal Full English weekday name of the instant in the zone ("Friday"). */
export function weekdayName(now: Date, timeZone: string): string {
    return WEEKDAY_FULL[localSessionParts(now, timeZone).weekdayIndex];
}

/**
 * @internal Short weekday, calendar date and clock of the instant in the zone:
 * `Fri 2026-11-20 09:09`.
 */
export function formatWeekdayClock(now: Date, timeZone: string): string {
    const { weekdayIndex } = localSessionParts(now, timeZone);
    const { date, time } = clockParts(now, timeZone);
    return `${WEEKDAY_SHORT[weekdayIndex]} ${date} ${time}`;
}

/**
 * @internal The Monday-to-Sunday week the instant falls in, by the zone's
 * calendar: `Mon 2026-11-16 to Sun 2026-11-22`.
 */
export function formatLocalWeek(now: Date, timeZone: string): string {
    const { year, month, day, weekdayIndex } = localSessionParts(now, timeZone);
    const daysSinceMonday = (weekdayIndex + DAYS_PER_WEEK - 1) % DAYS_PER_WEEK;
    const mondayMs =
        Date.UTC(year, month - 1, day) - daysSinceMonday * MS_PER_DAY;
    const sundayMs = mondayMs + (DAYS_PER_WEEK - 1) * MS_PER_DAY;
    return `Mon ${isoDateOfUtcMs(mondayMs)} to Sun ${isoDateOfUtcMs(sundayMs)}`;
}

/**
 * @internal `UTC: Fri 2026-11-20 14:09 · ET: … · KST: …` — the same three
 * zones as `formatNowLine`, with the weekday added.
 */
export function formatWeekdayNowLine(now: Date): string {
    return `UTC: ${formatWeekdayClock(now, 'UTC')} · ET: ${formatWeekdayClock(now, 'America/New_York')} · KST: ${formatWeekdayClock(now, 'Asia/Seoul')}`;
}

/**
 * @internal Time until a boundary as `in 21m` (under an hour), `in 3h 5m`
 * (under a day) or `in 2d 9h`. Whole minutes are rounded up first, so a
 * boundary 20m 10s away reads `in 21m`; the day form drops the minutes.
 */
export function formatLead(ms: number): string {
    const totalMinutes = Math.max(0, Math.ceil(ms / MS_PER_MINUTE));
    const totalHours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
    const minutes = totalMinutes % MINUTES_PER_HOUR;
    if (totalHours === 0) return `in ${minutes}m`;
    if (totalHours < HOURS_PER_DAY) return `in ${totalHours}h ${minutes}m`;
    const days = Math.floor(totalHours / HOURS_PER_DAY);
    return `in ${days}d ${totalHours % HOURS_PER_DAY}h`;
}

export interface MarketLineInput {
    /** Market name printed before the colon, e.g. `US stocks (NYSE/Nasdaq)`. */
    label: string;
    /** Zone label printed after the boundary clock, e.g. `ET`. */
    zoneLabel: string;
    now: Date;
    /** An `always-open` spec prints `open` alone: there is no boundary to name. */
    spec: MarketSessionSpec;
    /**
     * `true` only for the US line: names pre-market and after-hours clock
     * windows on a trading day and, from {@link US_OVERNIGHT_LAUNCH_MS} on,
     * the overnight session and the pause before it. The pre-market and
     * after-hours labels name windows of the clock only; the overnight label
     * also says SIGLENS prices do not cover it.
     */
    extendedHours: boolean;
    /**
     * The reader's resolved IANA zone. A boundary time is also printed in it
     * when its clock differs from the market's own, so the model quotes the
     * conversion instead of doing the arithmetic (a DST-season slip such as
     * ET 09:30 → "22:30 KST" is the failure this prevents).
     */
    userTimeZone?: string;
}

/**
 * Whether the spec trades on the local calendar day containing `at`: not a
 * weekend day and not a full closure (`closeMinuteFor` returning `0`).
 */
function isTradingDayAt(spec: ScheduledSpec, at: Date): boolean {
    const { weekdayIndex } = localSessionParts(at, spec.timeZone);
    if (spec.weekendDays.includes(weekdayIndex)) return false;
    return (spec.closeMinuteFor?.(at) ?? spec.closeMinute) > 0;
}

/**
 * Whether the local calendar day after the one containing `now` is a trading
 * day. The probe is noon UTC of the next local date, which falls on that same
 * date for every zone within UTC±11 (ET and KST included) and, unlike
 * `now + 24h`, never skips or repeats a date across a DST change.
 */
function isNextDayTradingDay(spec: ScheduledSpec, now: Date): boolean {
    const { year, month, day } = localSessionParts(now, spec.timeZone);
    return isTradingDayAt(
        spec,
        new Date(Date.UTC(year, month - 1, day + 1, 12))
    );
}

/**
 * The overnight-session state, the pause before it, or `null` when the moment
 * is outside both. The session runs from 21:00 on the evening before a trading
 * day to 04:00 of that day: none on a holiday eve or a Friday night, and the
 * week starts Sunday 21:00 when Monday trades. 20:00–21:00 on an evening an
 * overnight session follows is the daily pause on a trading day, and closed
 * with the 21:00 start named on a day that did not trade (Sunday, a holiday).
 */
function overnightState(
    spec: ScheduledSpec,
    now: Date,
    minutesOfDay: number
): string | null {
    if (minutesOfDay < US_PRE_MARKET_OPEN_MINUTE)
        return isTradingDayAt(spec, now) ? US_OVERNIGHT_STATE : null;
    if (minutesOfDay < US_DAILY_PAUSE_START_MINUTE) return null;
    if (!isNextDayTradingDay(spec, now)) return null;
    if (minutesOfDay >= US_OVERNIGHT_START_MINUTE) return US_OVERNIGHT_STATE;
    return isTradingDayAt(spec, now)
        ? US_DAILY_PAUSE_STATE
        : US_CLOSED_BEFORE_OVERNIGHT_STATE;
}

/**
 * `pre-market hours` / `after-hours` / overnight / daily pause / `closed` for a
 * moment outside the regular session. The overnight and pause states exist
 * only from {@link US_OVERNIGHT_LAUNCH_MS} on.
 */
function closedState(
    spec: ScheduledSpec,
    now: Date,
    extendedHours: boolean
): string {
    if (!extendedHours) return 'closed';
    const { minutesOfDay } = localSessionParts(now, spec.timeZone);
    if (now.getTime() >= US_OVERNIGHT_LAUNCH_MS) {
        const overnight = overnightState(spec, now, minutesOfDay);
        if (overnight !== null) return overnight;
    }
    if (!isTradingDayAt(spec, now)) return 'closed';
    if (
        minutesOfDay >= US_PRE_MARKET_OPEN_MINUTE &&
        minutesOfDay < sessionOpenMinute(spec, now)
    )
        return 'pre-market hours';
    const closeMinute = spec.closeMinuteFor?.(now) ?? spec.closeMinute;
    if (
        minutesOfDay >= closeMinute &&
        minutesOfDay < closeMinute + US_AFTER_HOURS_MINUTES
    )
        return 'after-hours';
    return 'closed';
}

/**
 * @internal One market line of the turn note: `- <label>: <state>; <opens|closes>
 * <weekday clock> <zoneLabel> (<lead>)`. The next boundary comes from
 * `nextRegularSessionBoundaryMs`, so holidays and half days are honoured; when
 * the spec has no trading day in reach the state is printed alone.
 */
export function formatMarketLine(input: MarketLineInput): string {
    const { label, zoneLabel, now, spec, extendedHours, userTimeZone } = input;
    if (spec.kind === 'always-open') return `- ${label}: open`;
    const open = getSessionStatus(spec, now) === 'open';
    const state = open ? 'open' : closedState(spec, now, extendedHours);
    const boundary = open ? 'close' : 'open';
    const atMs = nextRegularSessionBoundaryMs(spec, now, boundary);
    if (atMs === null) return `- ${label}: ${state}`;
    const verb = open ? 'closes' : 'opens';
    const at = new Date(atMs);
    const marketClock = formatWeekdayClock(at, spec.timeZone);
    // The same instant in the reader's zone, weekday included (it can differ
    // from the market's). Printed once when both zones show the same clock.
    const userClock =
        userTimeZone === undefined
            ? marketClock
            : formatWeekdayClock(at, userTimeZone);
    const userPart =
        userTimeZone === undefined || userClock === marketClock
            ? ''
            : ` (${userClock} ${timeZoneLabel(at, userTimeZone)})`;
    return `- ${label}: ${state}; ${verb} ${marketClock} ${zoneLabel}${userPart} (${formatLead(atMs - now.getTime())})`;
}
