import { medianOfSorted, round2 } from '@/domain/agent/statsMath';
import { localSessionParts } from '@/domain/session';
import type { MarketDailyClose, MarketSessionSpec } from '@/domain/types';

/** @internal Cap on move days listed; the window's larger moves come first. */
export const NEWS_MOVE_DAYS_MAX = 3;

/** @internal Cap on headlines indexed per move day (newest first); `itemCount` keeps the full count. */
export const NEWS_HEADLINES_PER_MOVE_DAY = 3;

/** Inputs for tying news items to the sessions they fall in and to the window's largest moves. */
export interface NewsPriceMovesInput {
    /**
     * Completed daily sessions, any order; invalid dates and prices are dropped. Must include at
     * least one session before `windowStart`, which is the base of the first window session's change.
     */
    readonly closes: readonly MarketDailyClose[];
    /** ISO instants of the news items, in the caller's item order. */
    readonly publishedAt: readonly string[];
    /** Scheduled: the zone, and the close (per day through `closeMinuteFor`, so half days work). Always-open: UTC dates. */
    readonly session: MarketSessionSpec;
    /** `YYYY-MM-DD`; the first session on or after it opens the window. */
    readonly windowStart: string;
}

/** One large-move session and the items attributed to it. */
export interface NewsMoveDay {
    /** Session date, `YYYY-MM-DD`. */
    date: string;
    /** Close against the previous session's close, 2 decimals. */
    changePct: number;
    /** 1 = largest `|changePct|` in the window; ties rank the later date first. */
    rank: number;
    /** Input indexes attributed to this session, newest published first (ties: lower index first), at most 3. */
    itemIndexes: number[];
    /** All items attributed to this session, before the cap. */
    itemCount: number;
}

/** News aligned with the window's sessions and its largest daily moves. */
export interface NewsPriceMoves {
    window: {
        /** First window session. */
        from: string;
        /** Last window session. */
        to: string;
        /** Sessions in the window, including the first (whose change needs the prior close). */
        sessions: number;
    };
    /** Median of `|changePct|` over the window's measurable sessions, 2 decimals. */
    medianAbsDailyChangePct: number | null;
    /** Largest `|changePct|` first (ties: the later date), at most 3. */
    moveDays: NewsMoveDay[];
    /**
     * Per input item: the session it belongs to, or `null` (published before the window,
     * after the last close, or unparseable).
     */
    itemSessions: (string | null)[];
    /** Items published after the last window session's close; unparseable dates are not counted. */
    afterLastCloseCount: number;
    /** Items published before `windowStart` (local date in the spec's zone); unparseable dates are not counted. */
    beforeWindowCount: number;
}

interface WindowSession {
    date: string;
    /** Measured change against the previous session, or `null` when no earlier close exists. */
    changePct: number | null;
    /** Close minute in the spec's zone; `0` for always-open specs, which do not use it. */
    closeMinute: number;
}

/** A window session whose change could be measured. */
interface MeasuredSession {
    date: string;
    changePct: number;
}

/** A parseable item with the session it was attributed to. */
interface PlacedItem {
    index: number;
    publishedMs: number;
    /** `null` when published before the window or after the last close. */
    session: string | null;
    beforeWindow: boolean;
}

/** An instant as the spec's zone reads it (UTC for always-open). */
interface LocalMoment {
    date: string;
    minute: number;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const RATIO_TO_PERCENT = 100;
/** Noon UTC falls on the same calendar day in every zone from UTC−12 to UTC+11, which covers the exchanges this serves. */
const PROBE_HOUR_UTC = 12;

function probeInstant(date: string): Date {
    return new Date(`${date}T${PROBE_HOUR_UTC}:00:00Z`);
}

/** `true` for a real `YYYY-MM-DD` calendar date: the shape matches and the date round-trips (no `2026-02-30`). */
function isIsoDate(value: string): boolean {
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

function isUsableClose(close: MarketDailyClose): boolean {
    return (
        isIsoDate(close.date) && Number.isFinite(close.close) && close.close > 0
    );
}

/** Usable closes sorted by date, one per date (the first of a duplicated date wins). */
function sortedUniqueCloses(
    closes: readonly MarketDailyClose[]
): MarketDailyClose[] {
    return closes
        .filter(isUsableClose)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
        .filter((close, i, all) => all[i - 1]?.date !== close.date);
}

/** Close minute of a session date; always-open specs have none (`0`, unused). */
function closeMinuteOn(spec: MarketSessionSpec, date: string): number {
    if (spec.kind === 'always-open') return 0;
    const calendarMinute = spec.closeMinuteFor?.(probeInstant(date));
    // A bar exists for this date, so the exchange traded: a calendar `0` (closed) contradicts
    // the bar and the spec's regular close applies. The bar dates are the calendar.
    return calendarMinute === undefined || calendarMinute === 0
        ? spec.closeMinute
        : calendarMinute;
}

function changeAgainstPrevious(
    close: MarketDailyClose,
    previous: MarketDailyClose | undefined
): number | null {
    if (previous === undefined) return null;
    return round2(
        ((close.close - previous.close) / previous.close) * RATIO_TO_PERCENT
    );
}

function pad2(value: number): string {
    return String(value).padStart(2, '0');
}

/** Local calendar date and minute of an instant, in the spec's zone (UTC for always-open). */
function localMoment(spec: MarketSessionSpec, at: Date): LocalMoment {
    if (spec.kind === 'always-open') {
        return {
            date: at.toISOString().slice(0, 10),
            minute: 0,
        };
    }
    const parts = localSessionParts(at, spec.timeZone);
    return {
        date: `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`,
        minute: parts.minutesOfDay,
    };
}

/**
 * First window session the item belongs to. Scheduled: the first session dated after
 * the item's local day, or the same day when the item came before that day's close.
 * Always-open: the item's UTC day when a session exists for it, else the next one.
 * Weekends and holidays need no table because the sessions are the bar dates.
 */
function sessionOf(
    spec: MarketSessionSpec,
    sessions: readonly WindowSession[],
    { date, minute }: LocalMoment
): string | null {
    const found =
        spec.kind === 'always-open'
            ? sessions.find(session => session.date >= date)
            : sessions.find(
                  session =>
                      session.date > date ||
                      (session.date === date && minute < session.closeMinute)
              );
    return found?.date ?? null;
}

function parsePublished(value: string): number | null {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
}

function newestFirst(a: PlacedItem, b: PlacedItem): number {
    return b.publishedMs - a.publishedMs || a.index - b.index;
}

/** Larger `|changePct|` first; the later ISO date first on a tie (dates are unique). */
function byLargestMove(a: MeasuredSession, b: MeasuredSession): number {
    return (
        Math.abs(b.changePct) - Math.abs(a.changePct) ||
        b.date.localeCompare(a.date)
    );
}

function measuredOf(session: WindowSession): MeasuredSession[] {
    return session.changePct === null
        ? []
        : [{ date: session.date, changePct: session.changePct }];
}

/**
 * Ties news items to completed trading sessions and to the window's largest daily
 * moves, so a move is only explained by headlines published before its close.
 *
 * An item belongs to the first session whose close came after it was published: a
 * pre-market and an after-close headline both land on the session they can move. An
 * item published after the last session's close has no session (`null`) and is
 * counted in `afterLastCloseCount`; one whose date cannot be parsed has none either
 * but is not counted, because it is unknown rather than late. The window opens at the
 * first session on or after `windowStart`. An item whose local date is before
 * `windowStart` has no session (`null`) and is counted in `beforeWindowCount`, so it is
 * never read as explaining a window move.
 *
 * Move days carry only sessions with a measured change (the first window session
 * needs a prior close in `closes`). Sessions with the same `|changePct|` rank the later
 * date first.
 *
 * @param input - Closes, item timestamps, the session spec and the window start.
 * @returns The alignment, or `null` when `windowStart` is not a date or the window
 *   holds fewer than 2 sessions.
 */
export function alignNewsWithPriceMoves(
    input: NewsPriceMovesInput
): NewsPriceMoves | null {
    if (!isIsoDate(input.windowStart)) return null;
    const closes = sortedUniqueCloses(input.closes);
    const windowSessions: WindowSession[] = closes.flatMap((close, i) =>
        close.date >= input.windowStart
            ? [
                  {
                      date: close.date,
                      changePct: changeAgainstPrevious(close, closes[i - 1]),
                      closeMinute: closeMinuteOn(input.session, close.date),
                  },
              ]
            : []
    );
    const [first, second, ...others] = windowSessions;
    if (first === undefined || second === undefined) return null;
    const last = others.at(-1) ?? second;

    const placed: PlacedItem[] = input.publishedAt.flatMap((value, index) => {
        const publishedMs = parsePublished(value);
        if (publishedMs === null) return [];
        const moment = localMoment(input.session, new Date(publishedMs));
        const beforeWindow = moment.date < input.windowStart;
        return [
            {
                index,
                publishedMs,
                session: beforeWindow
                    ? null
                    : sessionOf(input.session, windowSessions, moment),
                beforeWindow,
            },
        ];
    });
    const sessionByIndex = new Map(
        placed.map(item => [item.index, item.session])
    );
    const itemSessions = input.publishedAt.map(
        (_, index) => sessionByIndex.get(index) ?? null
    );
    const afterLastCloseCount = placed.filter(
        item => !item.beforeWindow && item.session === null
    ).length;
    const beforeWindowCount = placed.filter(item => item.beforeWindow).length;

    const measured = windowSessions.flatMap(measuredOf);
    const ranked = measured.toSorted(byLargestMove);
    const median = medianOfSorted(
        measured
            .map(session => Math.abs(session.changePct))
            .sort((a, b) => a - b)
    );

    const moveDays: NewsMoveDay[] = ranked
        .slice(0, NEWS_MOVE_DAYS_MAX)
        .map((session, i) => {
            const attributed = placed
                .filter(item => item.session === session.date)
                .sort(newestFirst);
            return {
                date: session.date,
                changePct: session.changePct,
                rank: i + 1,
                itemIndexes: attributed
                    .slice(0, NEWS_HEADLINES_PER_MOVE_DAY)
                    .map(item => item.index),
                itemCount: attributed.length,
            };
        });

    return {
        window: {
            from: first.date,
            to: last.date,
            sessions: windowSessions.length,
        },
        medianAbsDailyChangePct: median,
        moveDays,
        itemSessions,
        afterLastCloseCount,
        beforeWindowCount,
    };
}
