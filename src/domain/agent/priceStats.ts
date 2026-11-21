import {
    closeOnOrBefore,
    isIsoDate,
    minusCalendarMonths,
    normalizeCloses,
} from '@/domain/agent/calendarPeriods';
import { round2 } from '@/domain/agent/statsMath';
import type { MarketDailyClose } from '@/domain/types';

/** Named windows `get_price_stats` accepts, ending at the subject's last completed session. */
export const AGENT_PRICE_STATS_PERIODS = [
    'ytd',
    '1m',
    '3m',
    '6m',
    '1y',
    '3y',
    '5y',
    '10y',
    'max',
] as const;

export type AgentPriceStatsPeriod = (typeof AGENT_PRICE_STATS_PERIODS)[number];

/** Window for an unqualified question. */
export const AGENT_PRICE_STATS_DEFAULT_PERIOD: AgentPriceStatsPeriod = '1y';

/** Subjects (symbols plus an index) one call covers; a larger request is rejected, never cut. */
export const AGENT_PRICE_STATS_MAX_SUBJECTS = 3;

/** Date lookups one call covers; a larger request is rejected, never cut. */
export const AGENT_PRICE_STATS_MAX_DATES = 5;

/** @internal Fewest daily return pairs that print a correlation coefficient. */
export const PRICE_STATS_MIN_DAILY_OBSERVATIONS = 20;

/** @internal Fewest weekly return pairs that print a correlation coefficient. */
export const PRICE_STATS_MIN_WEEKLY_OBSERVATIONS = 12;

/**
 * @internal An annual rate is printed only for a window longer than one year:
 * more than this many calendar days (one leap year), and never for a named
 * period of a year or less or for a calendar year.
 */
export const PRICE_STATS_CAGR_ABOVE_DAYS = 366;

/**
 * The window a caller asked for. `none`: only `dates` was passed, so the result
 * carries the date lookups and no window figures.
 */
export type PriceStatsWindowRequest =
    | { kind: 'period'; period: AgentPriceStatsPeriod }
    | { kind: 'year'; year: number }
    | { kind: 'range'; from: string; to: string | null }
    | { kind: 'none' };

export interface PriceStatsRequest {
    readonly window: PriceStatsWindowRequest;
    /** Validated `YYYY-MM-DD` dates, deduplicated, at most {@link AGENT_PRICE_STATS_MAX_DATES}, in the caller's order. */
    readonly dates: readonly string[];
    /** Arguments a more specific one overrode (`from` beats `year` beats `period`); each gets a note. */
    readonly ignored: readonly ('period' | 'year')[];
}

export interface PriceStatsSubjectInput {
    /** The name the result prints: `AAPL`, `005930.KS`, `kospi`. */
    readonly label: string;
    /** Completed sessions, exchange-local dates, as loaded: rows with an invalid date or a price that is not finite and above zero are dropped here and named in notes. */
    readonly closes: readonly MarketDailyClose[];
    /** Calendar id (`us`, `kr`, `crypto`); two different ids make a correlation a cross-market one. */
    readonly market: string;
    /** Crypto: a close dated D is the price at the end of that UTC date, 00:00 UTC on D + 1. */
    readonly alwaysOpen: boolean;
    /** A session is under way and was left out of `closes`. */
    readonly sessionInProgress: boolean;
    /**
     * The subject's market-local calendar date now (`YYYY-MM-DD`; the exchange's
     * zone, UTC for crypto). It is per subject because markets can be on
     * different dates at the same instant. It fixes the year `ytd` means (so
     * between 1 January and the first session of the year `ytd` equals the
     * current calendar year) and bounds which requested dates after the last
     * close can be read as a weekend (`previous_session`) rather than as
     * missing from the data (`after_last_close`). A value that is not a date
     * falls back to the
     * subject's last close date.
     */
    readonly today: string;
}

export interface PriceStatsClose {
    date: string;
    close: number;
}

export interface PriceStatsWindow {
    /** Date of the base close: the last session on or before the window's start date. */
    baseDate: string;
    baseClose: number;
    endDate: string;
    endClose: number;
    /** Closes after `baseDate` up to and including `endDate`. */
    sessions: number;
    /** Calendar days between `baseDate` and `endDate`, from the dates' components. */
    calendarDays: number;
}

export interface PriceStatsDrawdown {
    /** Peak to trough, negative, 2 decimals. */
    pct: number;
    peakDate: string;
    peakClose: number;
    troughDate: string;
    troughClose: number;
    /** First close at or above `peakClose` after the trough, inside the window; `null` while still below it. */
    recoveredDate: string | null;
}

/**
 * How a requested date's close was found:
 * - `exact`: a close dated that day.
 * - `previous_session`: no close that day, so the last close before it (a date inside the history that had no session, or a past Saturday or Sunday after the last close of a market that closes at weekends).
 * - `before_history`: the history starts after it.
 * - `after_last_close`: after the last close and not a known non-session: `today` or later, any weekday, or any date of an always-open market. The data has no close for it yet; the market is not claimed to have had no session, since a recent close may simply be unpublished.
 * - `unusable_price`: the date's row was dropped as unusable.
 * - `no_price_data`: the subject has no usable price rows at all and the date is not one of the unusable rows; no row is claimed to have existed for it.
 */
export type PriceStatsDateStatus =
    | 'exact'
    | 'previous_session'
    | 'before_history'
    | 'after_last_close'
    | 'unusable_price'
    | 'no_price_data';

export interface PriceStatsDateClose {
    requestedDate: string;
    /** The session the close is from; `null` for every status but `exact` and `previous_session`. */
    date: string | null;
    close: number | null;
    status: PriceStatsDateStatus;
}

export interface PriceStatsSubjectView {
    subject: string;
    /** `null` when no window applies (`none` kind, no closes, or a window ending before the history). */
    window: PriceStatsWindow | null;
    /** End close against base close, 2 decimals. */
    returnPct: number | null;
    /**
     * Annual rate; given only for a window longer than one year (more than 366
     * calendar days). It is `null` for a calendar year, `ytd`, `1m`, `3m`, `6m`
     * and `1y`, even when the base session lies a few days before the start
     * date, because an annualised rate over a year or less reads as a forecast.
     */
    cagrPct: number | null;
    /**
     * Highest close among the sessions after the base; a tie keeps the earlier
     * date. When the window starts at the first close of the history (`max`, or
     * a start before the history) the base is a close inside the window and
     * counts too; a base from before the window never does.
     */
    highestClose: PriceStatsClose | null;
    lowestClose: PriceStatsClose | null;
    /** End close against `highestClose`, 2 decimals. */
    fromHighestClosePct: number | null;
    /** Largest peak-to-trough fall on closes, counted from the base close on; `null` when no close fell below an earlier one or the fall rounds to 0.00%. */
    maxDrawdown: PriceStatsDrawdown | null;
    /** One entry per requested date, in the caller's order; only present when dates were requested. */
    closes?: PriceStatsDateClose[];
    /** One deterministic English line with every figure above. */
    summary: string;
}

export interface PriceStatsCorrelationLeg {
    /** Pearson coefficient of simple returns, 2 decimals; `null` below the minimum observations or for a flat series. */
    coefficient: number | null;
    /** Return pairs behind the coefficient (shared dates minus one). */
    observations: number;
    /** First and last shared date used; `null` when no date is shared. */
    from: string | null;
    to: string | null;
}

export interface PriceStatsCorrelation {
    subjects: [string, string];
    daily: PriceStatsCorrelationLeg;
    weekly: PriceStatsCorrelationLeg;
}

export interface PriceStatsResult {
    /** Latest end date among the subjects (the last close for the `none` kind). */
    asOf: string;
    window: {
        kind: PriceStatsWindowRequest['kind'];
        period?: AgentPriceStatsPeriod;
        year?: number;
        from?: string;
        to?: string;
    };
    /** Input order. */
    subjects: PriceStatsSubjectView[];
    /** Pairs in input order; absent with fewer than two subjects or for the `none` kind. */
    correlation?: PriceStatsCorrelation[];
    /** Absent when empty. */
    notes?: string[];
}

/**
 * The closed set of notes the result can carry, one builder per note. Each names
 * the subject and the dates it is about. Tests and the app's evaluation checks
 * import these instead of retyping the wording.
 */
export const PRICE_STATS_NOTE_TEMPLATES = {
    historyStart: (
        subject: string,
        requestedStart: string,
        firstDate: string,
        unusableBefore: readonly string[] = []
    ): string =>
        unusableBefore.length > 0
            ? `${subject}: the first usable price row is on ${firstDate}, after the requested start ${requestedStart} (the rows for ${namedDates(unusableBefore)} were unusable and omitted). The window starts at that first usable close; say the window starts on ${firstDate} and never call it a listing date.`
            : `${subject}: SIGLENS's price history starts on ${firstDate}, after the requested start ${requestedStart}. The window starts at that first close; say the window starts on ${firstDate} and never call it a listing date.`,
    windowBeforeHistory: (
        subject: string,
        requestedEnd: string,
        firstDate: string
    ): string =>
        `${subject}: the window was requested to end on ${requestedEnd}, before SIGLENS's price history starts on ${firstDate}. There is no figure for it; say so.`,
    windowEndsAtLastClose: (
        subject: string,
        requestedEnd: string,
        lastDate: string
    ): string =>
        `${subject}: the window was requested to end on ${requestedEnd}, but the last completed close is ${lastDate}. The window ends there; say it covers the period only up to ${lastDate}.`,
    noSessionInWindow: (subject: string, date: string): string =>
        `${subject}: no session closed after the base date ${date}, so no change was measured; the 0 return is not a measured move.`,
    datesPreviousSession: (subject: string, pairs: readonly string[]): string =>
        `${subject}: closes with status previous_session (${pairs.join(', ')}): the requested date had no session, so the close is from the last session before it. Name both dates.`,
    datesBeforeHistory: (
        subject: string,
        dates: readonly string[],
        firstDate: string
    ): string =>
        `${subject}: no close for ${dates.join(', ')} (status before_history): SIGLENS's price history starts on ${firstDate}. Say there is no close; never estimate one.`,
    datesAfterLastClose: (
        subject: string,
        dates: readonly string[],
        lastDate: string
    ): string =>
        `${subject}: the data has no close for ${dates.join(', ')} yet (status after_last_close); the latest close is from ${lastDate}. Say the data has no close for that date yet and name ${lastDate}; never say there was no session, and never use a live price as a close.`,
    datesNoPriceData: (subject: string, dates: readonly string[]): string =>
        `${subject}: no close for ${dates.join(', ')} (status no_price_data): the subject has no usable price rows at all. Say no close is available; never estimate one.`,
    datesUnusablePrice: (subject: string, dates: readonly string[]): string =>
        `${subject}: no close for ${dates.join(', ')} (status unusable_price): the price row for that date was unusable and omitted. Say the close is unavailable; never estimate one.`,
    rowsUnusable: (subject: string, dates: readonly string[]): string => {
        const names = namedDates(dates);
        return `${subject}: ${dates.length} price ${dates.length === 1 ? 'row' : 'rows'} (${names}) had an invalid date or a price that is not above zero and ${dates.length === 1 ? 'was' : 'were'} omitted; the figures use the remaining closes.`;
    },
    duplicateRowsRemoved: (subject: string, count: number): string =>
        `${subject}: ${count} ${count === 1 ? 'row' : 'rows'} with a repeated date ${count === 1 ? 'was' : 'were'} removed; the first row of each date was kept.`,
    windowStartRowUnusable: (
        subject: string,
        droppedDates: readonly string[],
        baseDate: string
    ): string =>
        `${subject}: the row for ${droppedDates.join(', ')} (after the session the window starts at, and at or before its start date) was unusable and omitted, so the window starts at the neighbouring earlier session ${baseDate}; name ${baseDate} as the start.`,
    windowEndRowUnusable: (
        subject: string,
        droppedDates: readonly string[],
        endDate: string
    ): string =>
        `${subject}: the row for ${droppedDates.join(', ')} (after the window's end) was unusable and omitted, so the window ends at ${endDate}; name ${endDate} as the end.`,
    todayIgnored: (subject: string, lastDate: string): string =>
        `${subject}: the market date supplied was not a valid date, so the last close date ${lastDate} was used as today; "ytd" may then refer to the year of that close, not the current year.`,
    sessionInProgress: (subject: string, lastDate: string): string =>
        `${subject}: a session is in progress and is excluded; the last completed close is ${lastDate}. The live price is a quote, not a close of this window.`,
    alwaysOpenCloses: (subject: string): string =>
        `${subject}: trades around the clock; the close dated D is the price at the end of that UTC date (00:00 UTC the next day), not an exchange close.`,
    argumentIgnored: (ignored: string, usedBy: string): string =>
        `Argument ${ignored} was ignored because ${usedBy} is more specific; the figures use the window that ${usedBy} sets. Name that window.`,
    crossMarket: (
        first: string,
        second: string,
        firstMarket: string,
        secondMarket: string
    ): string =>
        `${first} (${firstMarket}) and ${second} (${secondMarket}) trade in different sessions, so a daily correlation compares moves that did not happen at the same time; prefer the weekly one and say so.`,
    endsDiffer: (
        first: string,
        firstEnd: string,
        second: string,
        secondEnd: string
    ): string =>
        `${first} ends on ${firstEnd} and ${second} on ${secondEnd}; the correlation covers only their shared dates up to the earlier end.`,
    correlationFlat: (
        first: string,
        second: string,
        leg: 'daily' | 'weekly',
        observations: number
    ): string =>
        `${first} and ${second}: no ${leg} correlation is given because the returns of one of the series do not vary over the ${observations} shared return pairs. Say it cannot be measured; never call it zero.`,
    correlationTooFew: (
        first: string,
        second: string,
        leg: 'daily' | 'weekly',
        observations: number,
        minimum: number
    ): string =>
        `${first} and ${second}: ${observations} shared ${leg} return pairs, fewer than the ${minimum} needed, so no ${leg} correlation is given. Say it cannot be measured over this window.`,
};

/** Unusable-row dates a note names before it says "and N more". */
const UNUSABLE_DATES_LISTED = 5;

/** Dates for a note: the first few, then how many more. */
function namedDates(dates: readonly string[]): string {
    const listed = dates.slice(0, UNUSABLE_DATES_LISTED);
    const more = dates.length - listed.length;
    return `${listed.join(', ')}${more > 0 ? `, and ${more} more` : ''}`;
}
const RATIO_TO_PERCENT = 100;
const DAYS_PER_YEAR = 365.25;
const MS_PER_DAY = 86_400_000;
const MONTHS_PER_YEAR = 12;
/** Returns whose variance is below this are flat; float noise on a constant-growth series stays far under it. */
const MIN_RETURN_VARIANCE = 1e-20;
const DAYS_FROM_MONDAY: readonly number[] = [6, 0, 1, 2, 3, 4, 5];

const PERIOD_MONTHS = {
    '1m': 1,
    '3m': 3,
    '6m': 6,
    '1y': MONTHS_PER_YEAR,
    '3y': 3 * MONTHS_PER_YEAR,
    '5y': 5 * MONTHS_PER_YEAR,
    '10y': 10 * MONTHS_PER_YEAR,
} as const;

const WINDOW_ARGUMENT_NAME: Record<PriceStatsWindowRequest['kind'], string> = {
    period: 'period',
    year: 'year',
    range: 'from',
    none: 'dates',
};

function yearOf(date: string): number {
    return Number(date.slice(0, 4));
}

function previousYearEnd(year: number): string {
    return `${year - 1}-12-31`;
}

/** Start date a named period resolves to against the last close; `null` for `max` (the whole history). */
function periodStart(
    period: AgentPriceStatsPeriod,
    lastDate: string,
    today: string
): string | null {
    if (period === 'max') return null;
    if (period === 'ytd') return previousYearEnd(yearOf(today));
    return minusCalendarMonths(lastDate, PERIOD_MONTHS[period]);
}

/** Date the window's base is looked up on or before; `null` = the first close. */
function startTargetOf(
    window: Exclude<PriceStatsWindowRequest, { kind: 'none' }>,
    lastDate: string,
    today: string
): string | null {
    if (window.kind === 'period') {
        return periodStart(window.period, lastDate, today);
    }
    if (window.kind === 'year') return previousYearEnd(window.year);
    return window.from;
}

/** The latest date a row may have and still belong to the window: its explicit end, or no limit. */
function endLimitOf(
    window: Exclude<PriceStatsWindowRequest, { kind: 'none' }>
): string {
    if (window.kind === 'year') return `${window.year}-12-31`;
    if (window.kind === 'range' && window.to !== null) return window.to;
    return '9999-12-31';
}

function endTargetOf(
    window: Exclude<PriceStatsWindowRequest, { kind: 'none' }>,
    lastDate: string,
    today: string
): string {
    if (window.kind === 'year') return `${window.year}-12-31`;
    // No session yet this year: `ytd` is the current calendar year, same as `year`.
    if (
        window.kind === 'period' &&
        window.period === 'ytd' &&
        yearOf(lastDate) < yearOf(today)
    ) {
        return `${yearOf(today)}-12-31`;
    }
    if (window.kind === 'range') return window.to ?? lastDate;
    return lastDate;
}

/**
 * The subject's local date, never earlier than its last close: a value that is
 * not a date, or lies before the last close, reads as the last close date.
 */
function localToday(today: string, lastDate: string): string {
    return isIsoDate(today) && today > lastDate ? today : lastDate;
}

/**
 * Earliest date the request needs a close on or before, so a caller can pick a
 * short cached series or the whole history before loading anything. The anchor
 * is the subject's last completed close, and `today` is the subject's
 * market-local date (it fixes the year of `ytd`). `null` means the whole history
 * (`max`). Requested dates count too: a lookup before the window start needs
 * its own earlier close. With no window and no dates the anchor itself.
 */
export function priceStatsEarliestDate(
    request: PriceStatsRequest,
    lastCloseDate: string,
    today: string
): string | null {
    const { window } = request;
    if (window.kind === 'period' && window.period === 'max') return null;
    const start =
        window.kind === 'none'
            ? null
            : startTargetOf(
                  window,
                  lastCloseDate,
                  localToday(today, lastCloseDate)
              );
    const candidates = [...(start === null ? [] : [start]), ...request.dates];
    return candidates.toSorted()[0] ?? lastCloseDate;
}

function utcDay(date: string): number {
    const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
}

/** Calendar days between two ISO dates, from their components (no time of day involved). */
function daysBetween(from: string, to: string): number {
    return Math.round((utcDay(to) - utcDay(from)) / MS_PER_DAY);
}

/** The Monday of the Monday-to-Sunday week a date falls in. */
function mondayOf(date: string): string {
    const day = utcDay(date);
    const back = DAYS_FROM_MONDAY[new Date(day).getUTCDay()] ?? 0;
    return new Date(day - back * MS_PER_DAY).toISOString().slice(0, 10);
}

function closeAt(rows: readonly MarketDailyClose[], index: number): number {
    return rows[index]?.close ?? Number.NaN;
}

interface ResolvedWindow {
    baseIdx: number;
    endIdx: number;
    /** The base is a close inside the window (it starts at the history), not one from before it. */
    baseInWindow: boolean;
    notes: string[];
}

/**
 * One start rule for every window: the base is the close of the last session on
 * or before the start date; the end is the last close on or before the end
 * date. A start before the history falls back to the first close, an end after
 * the last close to the last one, each with a note.
 */
function resolveWindow(
    label: string,
    closes: readonly MarketDailyClose[],
    window: Exclude<PriceStatsWindowRequest, { kind: 'none' }>,
    today: string,
    validUnusable: readonly string[]
): ResolvedWindow {
    const firstDate = closes[0]?.date ?? '';
    const lastDate = closes.at(-1)?.date ?? '';
    const startTarget = startTargetOf(window, lastDate, today);
    const endTarget = endTargetOf(window, lastDate, today);
    const endIdx = closeOnOrBefore(closes, endTarget);
    if (endIdx < 0) {
        return {
            baseIdx: -1,
            endIdx: -1,
            baseInWindow: false,
            notes: [
                PRICE_STATS_NOTE_TEMPLATES.windowBeforeHistory(
                    label,
                    endTarget,
                    firstDate
                ),
            ],
        };
    }
    const rawBase =
        startTarget === null ? 0 : closeOnOrBefore(closes, startTarget);
    return {
        baseIdx: Math.min(Math.max(rawBase, 0), endIdx),
        endIdx,
        baseInWindow: rawBase < 0 || startTarget === null,
        notes: [
            ...(startTarget !== null && rawBase < 0
                ? [
                      PRICE_STATS_NOTE_TEMPLATES.historyStart(
                          label,
                          startTarget,
                          firstDate,
                          validUnusable.filter(date => date < firstDate)
                      ),
                  ]
                : []),
            ...(endTarget > lastDate
                ? [
                      PRICE_STATS_NOTE_TEMPLATES.windowEndsAtLastClose(
                          label,
                          endTarget,
                          lastDate
                      ),
                  ]
                : []),
        ],
    };
}

/** The best close under `better`; a tie keeps the earlier date. */
function extremeClose(
    rows: readonly MarketDailyClose[],
    better: (candidate: number, best: number) => boolean
): PriceStatsClose | null {
    return rows.reduce<PriceStatsClose | null>(
        (best, row) =>
            best === null || better(row.close, best.close)
                ? { date: row.date, close: row.close }
                : best,
        null
    );
}

interface DrawdownScan {
    peakIdx: number;
    worst: number;
    worstPeakIdx: number;
    worstTroughIdx: number;
}

/** Largest fall from a running peak over `rows` (base included); `null` when no close is below an earlier one. */
function maxDrawdownOf(
    rows: readonly MarketDailyClose[]
): PriceStatsDrawdown | null {
    const scan = rows.reduce<DrawdownScan>(
        (state, row, i) => {
            const peakIdx =
                row.close > closeAt(rows, state.peakIdx) ? i : state.peakIdx;
            const drop = row.close / closeAt(rows, peakIdx) - 1;
            return drop < state.worst
                ? {
                      peakIdx,
                      worst: drop,
                      worstPeakIdx: peakIdx,
                      worstTroughIdx: i,
                  }
                : { ...state, peakIdx };
        },
        { peakIdx: 0, worst: 0, worstPeakIdx: 0, worstTroughIdx: 0 }
    );
    const peak = rows[scan.worstPeakIdx];
    const trough = rows[scan.worstTroughIdx];
    if (scan.worst >= 0 || peak === undefined || trough === undefined) {
        return null;
    }
    const pct = round2(scan.worst * RATIO_TO_PERCENT);
    // A fall under 0.005% prints as 0.00: report no drawdown, not a "0%" one.
    if (pct === 0) return null;
    return {
        pct,
        peakDate: peak.date,
        peakClose: peak.close,
        troughDate: trough.date,
        troughClose: trough.close,
        recoveredDate:
            rows
                .slice(scan.worstTroughIdx + 1)
                .find(row => row.close >= peak.close)?.date ?? null,
    };
}

const PERIODS_WITHOUT_ANNUAL_RATE: readonly AgentPriceStatsPeriod[] = [
    'ytd',
    '1m',
    '3m',
    '6m',
    '1y',
];

/** An annual rate only for a window longer than one year: not a calendar year, not a named period of a year or less. */
function annualRatePct(
    window: PriceStatsWindowRequest,
    baseClose: number,
    endClose: number,
    calendarDays: number
): number | null {
    const named =
        window.kind === 'year' ||
        (window.kind === 'period' &&
            PERIODS_WITHOUT_ANNUAL_RATE.includes(window.period));
    if (named || calendarDays <= PRICE_STATS_CAGR_ABOVE_DAYS) return null;
    const rate = (endClose / baseClose) ** (DAYS_PER_YEAR / calendarDays) - 1;
    return Number.isFinite(rate) ? round2(rate * RATIO_TO_PERCENT) : null;
}

/** A weekday strictly between the two dates: the market may have traded in between. */
function hasWeekdayBetween(from: string, to: string): boolean {
    // Five days in between always include a weekday, so a week of probes is enough.
    const between = Math.min(Math.max(daysBetween(from, to) - 1, 0), 7);
    return Array.from({ length: between }, (_, i) =>
        isWeekend(isoPlusDays(from, i + 1))
    ).some(weekend => !weekend);
}

function isoPlusDays(date: string, days: number): string {
    return new Date(utcDay(date) + days * MS_PER_DAY)
        .toISOString()
        .slice(0, 10);
}

function isWeekend(date: string): boolean {
    const day = new Date(utcDay(date)).getUTCDay();
    return day === 0 || day === 6;
}

function dateCloseOf(
    closes: readonly MarketDailyClose[],
    requestedDate: string,
    today: string,
    unusableDates: ReadonlySet<string>,
    alwaysOpen: boolean
): PriceStatsDateClose {
    const lastDate = closes.at(-1)?.date ?? '';
    const found = closes[closeOnOrBefore(closes, requestedDate)];
    const noClose = (status: PriceStatsDateStatus): PriceStatsDateClose => ({
        requestedDate,
        date: null,
        close: null,
        status,
    });
    if (found?.date !== requestedDate && unusableDates.has(requestedDate)) {
        return noClose('unusable_price');
    }
    // After the last close the data has no close for the date. Only a past
    // Saturday or Sunday of a market that closes at weekends is known to have
    // had no session (it reads as the last close before it); a weekday could be
    // a close the provider has not published yet, and an always-open market
    // trades every day, so those stay "not in the data".
    if (
        requestedDate > lastDate &&
        (requestedDate >= today ||
            alwaysOpen ||
            !isWeekend(requestedDate) ||
            hasWeekdayBetween(lastDate, requestedDate))
    ) {
        return noClose('after_last_close');
    }
    if (found === undefined) return noClose('before_history');
    return {
        requestedDate,
        date: found.date,
        close: found.close,
        status: found.date === requestedDate ? 'exact' : 'previous_session',
    };
}

function datesNotes(
    label: string,
    closes: readonly MarketDailyClose[],
    entries: readonly PriceStatsDateClose[]
): string[] {
    const firstDate = closes[0]?.date ?? '';
    const lastDate = closes.at(-1)?.date ?? '';
    const withStatus = (status: PriceStatsDateStatus) =>
        entries.filter(entry => entry.status === status);
    const previous = withStatus('previous_session');
    const before = withStatus('before_history');
    const after = withStatus('after_last_close');
    const unusable = withStatus('unusable_price');
    const noData = withStatus('no_price_data');
    return [
        ...(previous.length > 0
            ? [
                  PRICE_STATS_NOTE_TEMPLATES.datesPreviousSession(
                      label,
                      previous.map(
                          entry => `${entry.requestedDate} → ${entry.date}`
                      )
                  ),
              ]
            : []),
        ...(before.length > 0
            ? [
                  PRICE_STATS_NOTE_TEMPLATES.datesBeforeHistory(
                      label,
                      before.map(entry => entry.requestedDate),
                      firstDate
                  ),
              ]
            : []),
        ...(after.length > 0
            ? [
                  PRICE_STATS_NOTE_TEMPLATES.datesAfterLastClose(
                      label,
                      after.map(entry => entry.requestedDate),
                      lastDate
                  ),
              ]
            : []),
        ...(unusable.length > 0
            ? [
                  PRICE_STATS_NOTE_TEMPLATES.datesUnusablePrice(
                      label,
                      unusable.map(entry => entry.requestedDate)
                  ),
              ]
            : []),
        ...(noData.length > 0
            ? [
                  PRICE_STATS_NOTE_TEMPLATES.datesNoPriceData(
                      label,
                      noData.map(entry => entry.requestedDate)
                  ),
              ]
            : []),
    ];
}

function signedPct(value: number): string {
    return `${value > 0 ? '+' : ''}${value}%`;
}

function groupedInteger(value: number): string {
    return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function sessionsText(sessions: number): string {
    return `${groupedInteger(sessions)} ${sessions === 1 ? 'session' : 'sessions'}`;
}

function drawdownText(
    drawdown: PriceStatsDrawdown | null,
    endDate: string
): string {
    if (drawdown === null)
        return 'no fall of 0.01% or more from an earlier close';
    const recovered =
        drawdown.recoveredDate === null
            ? `not recovered by ${endDate}`
            : `recovered ${drawdown.recoveredDate}`;
    return `max drawdown ${signedPct(drawdown.pct)} from ${drawdown.peakDate} to ${drawdown.troughDate}, ${recovered}`;
}

function windowSummary(
    label: string,
    window: PriceStatsWindow,
    view: Omit<PriceStatsSubjectView, 'summary' | 'closes' | 'subject'>
): string {
    const head = `${label} ${window.baseDate} → ${window.endDate} (${sessionsText(window.sessions)})`;
    const { highestClose, returnPct, cagrPct, fromHighestClosePct } = view;
    if (
        highestClose === null ||
        returnPct === null ||
        fromHighestClosePct === null
    ) {
        return `${head}: close ${window.endClose}, no session after the base date, so no change measured`;
    }
    const annual =
        cagrPct === null ? '' : ` (annual rate ${signedPct(cagrPct)})`;
    return `${head}: close ${window.baseClose} → ${window.endClose}, ${signedPct(returnPct)}${annual}; highest close ${highestClose.close} (${highestClose.date}), ${signedPct(fromHighestClosePct)} from it; ${drawdownText(view.maxDrawdown, window.endDate)}`;
}

function dateCloseText(entry: PriceStatsDateClose): string {
    if (entry.status === 'exact')
        return `${entry.requestedDate} ${entry.close}`;
    if (entry.status === 'previous_session') {
        return `${entry.requestedDate} → ${entry.date} (no session that day) ${entry.close}`;
    }
    if (entry.status === 'unusable_price') {
        return `${entry.requestedDate} (price unusable) no close`;
    }
    if (entry.status === 'no_price_data') {
        return `${entry.requestedDate} (no price data) no close`;
    }
    return entry.status === 'before_history'
        ? `${entry.requestedDate} (before the price history) no close`
        : `${entry.requestedDate} (not in the data yet) no close`;
}

interface SubjectComputation {
    input: PriceStatsSubjectInput;
    closes: MarketDailyClose[];
    view: PriceStatsSubjectView;
    notes: string[];
}

const NO_FIGURES = {
    returnPct: null,
    cagrPct: null,
    highestClose: null,
    lowestClose: null,
    fromHighestClosePct: null,
    maxDrawdown: null,
} as const;

function computeSubject(
    input: PriceStatsSubjectInput,
    request: PriceStatsRequest
): SubjectComputation {
    const label = input.label;
    const {
        closes,
        duplicates,
        unusableDates: unusableList,
    } = normalizeCloses(input.closes);
    const { window } = request;
    const last = closes.at(-1);
    const unusableDates = new Set(unusableList);
    // Only real dates take part in the window checks; a malformed string never does.
    const validUnusable = [...unusableDates].filter(isIsoDate).toSorted();
    const dropNotes = [
        ...(unusableDates.size > 0
            ? [
                  PRICE_STATS_NOTE_TEMPLATES.rowsUnusable(
                      label,
                      [...unusableDates].toSorted()
                  ),
              ]
            : []),
        ...(duplicates > 0
            ? [
                  PRICE_STATS_NOTE_TEMPLATES.duplicateRowsRemoved(
                      label,
                      duplicates
                  ),
              ]
            : []),
    ];
    if (last === undefined) {
        // No usable row remains: each requested date still gets an answer.
        const lookups =
            request.dates.length > 0
                ? request.dates.map((date): PriceStatsDateClose => ({
                      requestedDate: date,
                      date: null,
                      close: null,
                      status: unusableDates.has(date)
                          ? 'unusable_price'
                          : 'no_price_data',
                  }))
                : undefined;
        return {
            input,
            closes,
            notes: [
                ...dropNotes,
                ...(lookups === undefined
                    ? []
                    : datesNotes(label, closes, lookups)),
            ],
            view: {
                subject: label,
                window: null,
                ...NO_FIGURES,
                ...(lookups === undefined ? {} : { closes: lookups }),
                summary: [
                    `${label}: no closes`,
                    lookups === undefined
                        ? null
                        : `${label} closes: ${lookups.map(dateCloseText).join('; ')}`,
                ]
                    .filter(part => part !== null)
                    .join(' | '),
            },
        };
    }

    const today = localToday(input.today, last.date);
    const resolved =
        window.kind === 'none'
            ? null
            : resolveWindow(label, closes, window, today, validUnusable);
    const base = resolved === null ? undefined : closes[resolved.baseIdx];
    const end = resolved === null ? undefined : closes[resolved.endIdx];
    const entries =
        request.dates.length > 0
            ? request.dates.map(date =>
                  dateCloseOf(
                      closes,
                      date,
                      today,
                      unusableDates,
                      input.alwaysOpen
                  )
              )
            : undefined;
    const startTarget =
        window.kind === 'none' ? null : startTargetOf(window, last.date, today);
    const droppedAfterEnd =
        end === undefined || window.kind === 'none'
            ? []
            : validUnusable.filter(
                  date => date > end.date && date <= endLimitOf(window)
              );
    const droppedAtStart =
        base === undefined || startTarget === null || base.date > startTarget
            ? []
            : validUnusable.filter(
                  date => date > base.date && date <= startTarget
              );

    const notes = [
        ...(isIsoDate(input.today)
            ? []
            : [PRICE_STATS_NOTE_TEMPLATES.todayIgnored(label, last.date)]),
        ...(resolved?.notes ?? []),
        ...(resolved !== null &&
        base !== undefined &&
        end !== undefined &&
        base.date === end.date
            ? [PRICE_STATS_NOTE_TEMPLATES.noSessionInWindow(label, base.date)]
            : []),
        ...dropNotes,
        ...(base !== undefined && droppedAtStart.length > 0
            ? [
                  PRICE_STATS_NOTE_TEMPLATES.windowStartRowUnusable(
                      label,
                      droppedAtStart,
                      base.date
                  ),
              ]
            : []),
        ...(end !== undefined && droppedAfterEnd.length > 0
            ? [
                  PRICE_STATS_NOTE_TEMPLATES.windowEndRowUnusable(
                      label,
                      droppedAfterEnd,
                      end.date
                  ),
              ]
            : []),
        ...(entries === undefined ? [] : datesNotes(label, closes, entries)),
        ...(input.sessionInProgress
            ? [PRICE_STATS_NOTE_TEMPLATES.sessionInProgress(label, last.date)]
            : []),
        ...(input.alwaysOpen
            ? [PRICE_STATS_NOTE_TEMPLATES.alwaysOpenCloses(label)]
            : []),
    ];

    const closesLine =
        entries === undefined
            ? null
            : `${label} closes: ${entries.map(dateCloseText).join('; ')}`;
    const withCloses = entries === undefined ? {} : { closes: entries };

    if (resolved === null || base === undefined || end === undefined) {
        const reason =
            resolved === null
                ? null
                : `${label}: no figures (the requested end is before the price history starts on ${closes[0]?.date ?? ''})`;
        return {
            input,
            closes,
            notes,
            view: {
                subject: label,
                window: null,
                ...NO_FIGURES,
                ...withCloses,
                summary: [reason, closesLine]
                    .filter(part => part !== null)
                    .join(' | '),
            },
        };
    }

    const after = closes.slice(resolved.baseIdx + 1, resolved.endIdx + 1);
    // A base inside the window (the window starts at the history) is also a
    // close of the window; a base from before the window is not.
    const ranged = resolved.baseInWindow
        ? closes.slice(resolved.baseIdx, resolved.endIdx + 1)
        : after;
    const calendarDays = daysBetween(base.date, end.date);
    const windowFigures: PriceStatsWindow = {
        baseDate: base.date,
        baseClose: base.close,
        endDate: end.date,
        endClose: end.close,
        sessions: after.length,
        calendarDays,
    };
    const highestClose = extremeClose(ranged, (c, best) => c > best);
    const figures: Omit<
        PriceStatsSubjectView,
        'summary' | 'closes' | 'subject'
    > =
        after.length === 0 || highestClose === null
            ? {
                  window: windowFigures,
                  ...NO_FIGURES,
                  returnPct: 0,
              }
            : {
                  window: windowFigures,
                  returnPct: round2(
                      (end.close / base.close - 1) * RATIO_TO_PERCENT
                  ),
                  cagrPct: annualRatePct(
                      window,
                      base.close,
                      end.close,
                      calendarDays
                  ),
                  highestClose,
                  lowestClose: extremeClose(ranged, (c, best) => c < best),
                  fromHighestClosePct: round2(
                      (end.close / highestClose.close - 1) * RATIO_TO_PERCENT
                  ),
                  maxDrawdown: maxDrawdownOf(
                      closes.slice(resolved.baseIdx, resolved.endIdx + 1)
                  ),
              };
    return {
        input,
        closes,
        notes,
        view: {
            subject: label,
            ...figures,
            ...withCloses,
            summary: [windowSummary(label, windowFigures, figures), closesLine]
                .filter(part => part !== null)
                .join(' | '),
        },
    };
}

interface PairPoint {
    date: string;
    first: number;
    second: number;
}

/**
 * Dates both subjects have a close on, inside the window they share: from the
 * later base to the earlier end. A holiday on one side drops that date from
 * both, so returns are always measured between the same two dates.
 */
function sharedPoints(
    first: SubjectComputation,
    second: SubjectComputation
): PairPoint[] {
    const a = first.view.window;
    const b = second.view.window;
    if (a === null || b === null) return [];
    const from = a.baseDate > b.baseDate ? a.baseDate : b.baseDate;
    const to = a.endDate < b.endDate ? a.endDate : b.endDate;
    const secondByDate = new Map(
        second.closes.map(close => [close.date, close.close])
    );
    return first.closes.flatMap(close => {
        const other = secondByDate.get(close.date);
        return close.date >= from && close.date <= to && other !== undefined
            ? [{ date: close.date, first: close.close, second: other }]
            : [];
    });
}

/** Last shared date of each Monday-to-Sunday week, so both series are sampled on the same days. */
function weeklyPoints(points: readonly PairPoint[]): PairPoint[] {
    return points.filter((point, i) => {
        const next = points[i + 1];
        return (
            next === undefined || mondayOf(next.date) !== mondayOf(point.date)
        );
    });
}

function returnsOf(values: readonly number[]): number[] {
    return values
        .slice(1)
        .map((value, i) => value / (values[i] ?? Number.NaN) - 1);
}

function sumOf(values: readonly number[]): number {
    return values.reduce((total, value) => total + value, 0);
}

/** Pearson coefficient, 2 decimals; `null` for a flat series or a non-finite result. */
function pearson(x: readonly number[], y: readonly number[]): number | null {
    const n = x.length;
    const meanX = sumOf(x) / n;
    const meanY = sumOf(y) / n;
    const dx = x.map(value => value - meanX);
    const dy = y.map(value => value - meanY);
    const varX = sumOf(dx.map(d => d * d)) / n;
    const varY = sumOf(dy.map(d => d * d)) / n;
    if (varX < MIN_RETURN_VARIANCE || varY < MIN_RETURN_VARIANCE) return null;
    const covariance = sumOf(dx.map((d, i) => d * (dy[i] ?? 0))) / n;
    const coefficient = covariance / Math.sqrt(varX * varY);
    return Number.isFinite(coefficient)
        ? round2(Math.max(-1, Math.min(1, coefficient)))
        : null;
}

function correlationLeg(
    points: readonly PairPoint[],
    minimum: number
): PriceStatsCorrelationLeg {
    const observations = Math.max(points.length - 1, 0);
    return {
        coefficient:
            observations >= minimum
                ? pearson(
                      returnsOf(points.map(point => point.first)),
                      returnsOf(points.map(point => point.second))
                  )
                : null,
        observations,
        from: points[0]?.date ?? null,
        to: points.at(-1)?.date ?? null,
    };
}

/** Why a leg has no coefficient: too few shared return pairs, or a series with no variation. */
function legNotes(
    first: string,
    second: string,
    leg: 'daily' | 'weekly',
    result: PriceStatsCorrelationLeg,
    minimum: number
): string[] {
    if (result.coefficient !== null) return [];
    return result.observations < minimum
        ? [
              PRICE_STATS_NOTE_TEMPLATES.correlationTooFew(
                  first,
                  second,
                  leg,
                  result.observations,
                  minimum
              ),
          ]
        : [
              PRICE_STATS_NOTE_TEMPLATES.correlationFlat(
                  first,
                  second,
                  leg,
                  result.observations
              ),
          ];
}

interface PairResult {
    correlation: PriceStatsCorrelation;
    notes: string[];
}

function correlatePair(
    first: SubjectComputation,
    second: SubjectComputation
): PairResult {
    const a = first.input.label;
    const b = second.input.label;
    const daily = sharedPoints(first, second);
    const dailyLeg = correlationLeg(daily, PRICE_STATS_MIN_DAILY_OBSERVATIONS);
    const weeklyLeg = correlationLeg(
        weeklyPoints(daily),
        PRICE_STATS_MIN_WEEKLY_OBSERVATIONS
    );
    const endA = first.view.window?.endDate;
    const endB = second.view.window?.endDate;
    return {
        correlation: { subjects: [a, b], daily: dailyLeg, weekly: weeklyLeg },
        notes: [
            ...(first.input.market !== second.input.market
                ? [
                      PRICE_STATS_NOTE_TEMPLATES.crossMarket(
                          a,
                          b,
                          first.input.market,
                          second.input.market
                      ),
                  ]
                : []),
            ...(endA !== undefined && endB !== undefined && endA !== endB
                ? [PRICE_STATS_NOTE_TEMPLATES.endsDiffer(a, endA, b, endB)]
                : []),
            ...legNotes(
                a,
                b,
                'daily',
                dailyLeg,
                PRICE_STATS_MIN_DAILY_OBSERVATIONS
            ),
            ...legNotes(
                a,
                b,
                'weekly',
                weeklyLeg,
                PRICE_STATS_MIN_WEEKLY_OBSERVATIONS
            ),
        ],
    };
}

function windowEcho(
    window: PriceStatsWindowRequest
): PriceStatsResult['window'] {
    switch (window.kind) {
        case 'period':
            return { kind: 'period', period: window.period };
        case 'year':
            return { kind: 'year', year: window.year };
        case 'range':
            return {
                kind: 'range',
                from: window.from,
                ...(window.to === null ? {} : { to: window.to }),
            };
        case 'none':
            return { kind: 'none' };
    }
}

/**
 * Period statistics from daily closes of completed sessions, one view per
 * subject: return, annual rate, highest and lowest close, maximum drawdown and
 * requested date closes; with two or more subjects, daily and weekly return
 * correlations per pair.
 *
 * One base rule for every window: it starts at the close of the last session
 * on or before its start date (a named period anchors on the subject's last
 * close; `ytd` (the year of the subject's `today`) and a calendar year use the previous year's last close). Bar
 * dates are the calendar, so a weekend or holiday needs no table. Highs and lows
 * count the sessions after the base, plus the base itself when the window
 * starts at the history; the drawdown always starts from the base close. Closes print as given; derived values keep 2 decimals.
 * A figure that cannot be measured is `null`, never `NaN`; the result's `notes`
 * say why in words the model must follow.
 *
 * @param subjects - Up to {@link AGENT_PRICE_STATS_MAX_SUBJECTS}; the caller enforces the cap.
 * @param request - The window, dates to look up and overridden arguments.
 */
export function computePriceStats(
    subjects: readonly PriceStatsSubjectInput[],
    request: PriceStatsRequest
): PriceStatsResult {
    const computed = subjects.map(subject => computeSubject(subject, request));
    const pairs =
        request.window.kind === 'none'
            ? []
            : computed.flatMap((first, i) =>
                  computed
                      .slice(i + 1)
                      .map(second => correlatePair(first, second))
              );
    const notes = [
        ...request.ignored.map(ignored =>
            PRICE_STATS_NOTE_TEMPLATES.argumentIgnored(
                ignored,
                WINDOW_ARGUMENT_NAME[request.window.kind]
            )
        ),
        ...computed.flatMap(subject => subject.notes),
        ...pairs.flatMap(pair => pair.notes),
    ];
    const asOf = computed
        .map(
            subject =>
                subject.view.window?.endDate ??
                subject.closes.at(-1)?.date ??
                ''
        )
        .reduce((latest, date) => (date > latest ? date : latest), '');
    return {
        asOf,
        window: windowEcho(request.window),
        subjects: computed.map(subject => subject.view),
        ...(pairs.length > 0
            ? { correlation: pairs.map(pair => pair.correlation) }
            : {}),
        ...(notes.length > 0 ? { notes } : {}),
    };
}
