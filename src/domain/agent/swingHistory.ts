import { medianOfSorted, round2 } from '@/domain/agent/statsMath';
import { MS_PER_DAY } from '@/domain/constants/time';
import type { MarketDailyClose } from '@/domain/types';
import { maxOf, minOf } from '@/domain/extent';

/** `get_swing_history`'s `minSwingPct` bounds and default (percent, integer). */
export const SWING_MIN_PCT = { min: 3, max: 50, default: 10 } as const;
/** `get_swing_history`'s `lookbackYears` bounds (integer). */
export const SWING_LOOKBACK_YEARS = { min: 1, max: 60 } as const;
/** Most recent declines (and, separately, rallies) listed in full; older ones still count. */
export const SWING_EPISODES_LISTED_MAX = 20;
/**
 * How the agent picks `minSwingPct` from the user's words. Shared by the tool description and
 * its routing row so the two never drift apart.
 */
export const SWING_THRESHOLD_GUIDE =
    'minSwingPct 10 for 조정 or an ordinary rally, 20 for 약세장 or 강세장 (a bear or bull market), 5 for 눌림목 or a short swing; for a coin or a volatile theme or small-cap stock a 10% swing is routine (it comes every few weeks), so use 20 when the user means a real correction of such a name';

/**
 * Questions that route to `get_swing_history`. Shared by the tool description and its routing
 * row so the two trigger lists never drift apart.
 */
export const SWING_TRIGGER_EXAMPLES =
    '조정은 보통 며칠 가?, 월봉 조정 기간, 상승 구간은 보통 얼마나 가?, 평균 낙폭, 평균 상승폭, 고점 회복까지 얼마나 걸려, 역대 하락장·상승장, 지금 조정 깊은 편이야?, 이번 상승 오래된 편이야?, 조정 며칠째야?, 이번 하락은 보통 며칠 더 가?';

/** Lower edges (percent) of the size bands above `minSwingPct`. */
const DECLINE_BAND_EDGES: readonly number[] = [10, 20, 30, 50];
const RALLY_BAND_EDGES: readonly number[] = [10, 20, 30, 50, 100];
/** Slack on the threshold comparisons so an exact `minSwingPct` move counts despite float error. */
const THRESHOLD_EPSILON = 1e-9;
/** Fewest samples whose nearest-rank quartiles are both inner values (below it p25 is the minimum). */
const QUARTILE_MIN_SAMPLES = 5;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A completed decline: a confirmed swing high, the lowest close after it, ended by a rebound. */
export interface DeclineEpisode {
    peakDate: string;
    peakClose: number;
    troughDate: string;
    troughClose: number;
    /** Trough vs peak close, negative. */
    changePct: number;
    /** Calendar days from the peak close to the trough close. */
    days: number;
    /** Trading sessions from the peak close to the trough close. */
    sessions: number;
    /** First close at or above the peak close after the trough; `null` if it never got back. */
    recoveryDate: string | null;
    /** Calendar days from the trough to `recoveryDate`; `null` when not recovered. */
    daysToRecover: number | null;
}

/** A completed rally: a confirmed swing low, the highest close after it, ended by a decline. */
export interface RallyEpisode {
    troughDate: string;
    troughClose: number;
    peakDate: string;
    peakClose: number;
    /** Peak vs trough close, positive. */
    changePct: number;
    /** Calendar days from the trough close to the peak close. */
    days: number;
    /** Trading sessions from the trough close to the peak close. */
    sessions: number;
}

export interface DayStats {
    samples: number;
    medianDays: number | null;
    avgDays: number | null;
    minDays: number | null;
    maxDays: number | null;
}

export interface ChangeStats {
    medianPct: number | null;
    avgPct: number | null;
    /** Deepest decline or largest rally. */
    extremePct: number | null;
}

/** What a decline and a rally summary share. */
export interface SwingSummary {
    episodes: number;
    days: DayStats;
    sessionsMedian: number | null;
    change: ChangeStats;
}

export type RallySummary = SwingSummary;

export interface DeclineSummary extends SwingSummary {
    /** Declines whose close later got back to the peak close. */
    recovered: number;
    /** Trough → recovery, recovered declines only. */
    daysToRecover: DayStats;
    /** Peak → recovery, recovered declines only. */
    peakToRecoveryDays: DayStats;
}

/** A size range (absolute percent) `[fromPct, toPct)`; `toPct` `null` is open-ended. */
export interface SizeBandBounds {
    fromPct: number;
    toPct: number | null;
}

/** What a decline and a rally size band share. */
export interface SwingBand extends SizeBandBounds {
    episodes: number;
    medianDays: number | null;
}

export type RallyBand = SwingBand;

export interface DeclineBand extends SwingBand {
    recovered: number;
    medianDaysToRecover: number | null;
}

export interface DeclineHistory {
    summary: DeclineSummary;
    bySize: DeclineBand[];
    /** Newest first, at most {@link SWING_EPISODES_LISTED_MAX}. */
    episodes: DeclineEpisode[];
    /** Completed declines left out of `episodes` (still in `summary` and `bySize`). */
    notListed: number;
}

export interface RallyHistory {
    summary: RallySummary;
    bySize: RallyBand[];
    /** Newest first, at most {@link SWING_EPISODES_LISTED_MAX}. */
    episodes: RallyEpisode[];
    /** Completed rallies left out of `episodes` (still in `summary` and `bySize`). */
    notListed: number;
}

/**
 * Spread of the extra calendar days in {@link AgeConditional}. Quartiles are nearest-rank (at
 * least a quarter / three quarters of the samples took that many days or fewer) and `null` below
 * {@link QUARTILE_MIN_SAMPLES} samples, where they would just be the minimum and the maximum.
 */
export interface ExtraDayStats {
    samples: number;
    medianDays: number | null;
    p25Days: number | null;
    p75Days: number | null;
    maxDays: number | null;
}

/**
 * Base rate for an open leg of this age. The open leg is known to have started (its start was
 * confirmed by a `minSwingPct` move) and not to have ended (no `minSwingPct` reversal yet), so it
 * is compared with the completed episodes of the same direction that were in the same state
 * `ageDays` calendar days after their start: start already confirmed, ending reversal still to
 * come. Some of those had already set their extreme by then; the rest set it later. A past
 * distribution, not a forecast.
 */
export interface AgeConditional {
    /** The open leg's age in calendar days (same as `daysSinceStart`). */
    ageDays: number;
    /** Completed episodes already confirmed but not yet ended `ageDays` after their start. */
    unendedAtThisAge: number;
    /** Of those, the ones whose extreme had already come by `ageDays` (0 more days needed). */
    extremeAlreadyIn: number;
    /** The rest: calendar days from `ageDays` to their extreme (`days - ageDays`). */
    extraDaysToExtreme: ExtraDayStats;
}

/** The open leg, measured from its confirmed starting swing point to the last close. */
export interface SwingOpenLeg {
    /** The confirmed swing point the leg started from (a high for a decline, a low for a rally). */
    startDate: string;
    startClose: number;
    /** The lowest close (decline) or highest close (rally) since the start. */
    extremeDate: string;
    extremeClose: number;
    /** Extreme vs start. */
    extremePct: number;
    lastClose: number;
    /** Last close vs start. */
    changePct: number;
    /** Calendar days from the start to the last close. */
    daysSinceStart: number;
    /** Calendar days from the start to the extreme so far. */
    daysToExtreme: number;
    /** Completed episodes of the same direction (same as that side's `summary.episodes`). */
    pastEpisodes: number;
    /**
     * @deprecated No longer filled (always absent): it counted against `daysToExtreme` while
     * `afterThisAge` counts against `daysSinceStart`, and near-equal counts were quoted together
     * as one. Use `afterThisAge`.
     */
    pastLongerThanNow?: number;
    /** Completed episodes whose size went beyond `extremePct` (deeper decline or larger rally). */
    pastBiggerThanNow: number;
    /**
     * How much longer past episodes in the same state at this leg's age (start already confirmed,
     * ending reversal still to come) went on.
     */
    afterThisAge: AgeConditional;
    /**
     * The close that would end this leg under this tool's rule: `minSwingPct` above the low so
     * far (decline, rounded up) or below the high so far (rally, rounded down), so a close at the
     * shown level does end it. It moves when a new extreme is set.
     */
    endsAtClose: number;
}

/**
 * Where the last close stands. `in_decline`: the close fell at least `minSwingPct` from the latest
 * confirmed swing high and has not rebounded `minSwingPct` off its low since. `in_rally`: it rose
 * at least `minSwingPct` from the latest confirmed swing low and has not fallen `minSwingPct` from
 * its high since (`fromExtremePct` is the pullback from that high). `no_confirmed_swing`: the
 * window holds no confirmed swing point yet, so neither leg has a known start.
 */
export type SwingCurrent =
    | ({ state: 'in_decline' } & SwingOpenLeg)
    | ({
          state: 'in_rally';
          /** Last close vs the rally's highest close, ≤ 0. */
          fromExtremePct: number;
      } & SwingOpenLeg)
    | { state: 'no_confirmed_swing'; lastClose: number };

/** The window's highest close, for "how far from the high" questions a swing high misses. */
export interface WindowHigh {
    date: string;
    close: number;
    /** Last close vs this close, ≤ 0. */
    fromHighPct: number;
}

export interface SwingHistory {
    minSwingPct: number;
    firstDate: string;
    lastDate: string;
    sessions: number;
    windowHigh: WindowHigh;
    declines: DeclineHistory;
    rallies: RallyHistory;
    current: SwingCurrent;
}

export interface SwingHistoryOptions {
    /** Integer within {@link SWING_MIN_PCT}. */
    minSwingPct: number;
    /** Integer within {@link SWING_LOOKBACK_YEARS}; omit for the whole history. */
    lookbackYears?: number;
}

/** A confirmed decline as swing indices: its peak (high) and trough (low). */
interface SwingPair {
    peak: number;
    trough: number;
    /** The close that confirmed the peak (the first `threshold` decline from it). */
    peakConfirmedAt: number;
    /** The close that confirmed the trough and ended the decline (the rebound). */
    troughConfirmedAt: number;
}

/** Completed declines in order, and the open leg's running high and (if falling) its low. */
interface Swings {
    declines: SwingPair[];
    /** Running high (up leg) or the high the open decline started from. */
    openPeak: number;
    /** Low of the open decline; `null` while the leg is up. */
    openLow: number | null;
    /** The close that confirmed `openPeak` (ended the rally before the open decline); `null` while up. */
    openPeakConfirmedAt: number | null;
}

/** When a completed episode reached its extreme and when its ending reversal came. */
interface EpisodeTiming {
    /** Calendar days from the start to the extreme. */
    days: number;
    /** Calendar days from the start to the close that confirmed the start (the `threshold` move). */
    startConfirmedDays: number;
    /** Calendar days from the start to the close that ended the episode. */
    endDays: number;
    changePct: number;
}

function isRealIsoDate(value: string): boolean {
    if (!ISO_DATE.test(value)) return false;
    const time = Date.parse(value);
    return (
        Number.isFinite(time) &&
        new Date(time).toISOString().slice(0, 10) === value
    );
}

function isIntegerWithin(
    value: number,
    bounds: { min: number; max: number }
): boolean {
    return (
        Number.isInteger(value) && value >= bounds.min && value <= bounds.max
    );
}

function calendarDays(from: string, to: string): number {
    return Math.round((Date.parse(to) - Date.parse(from)) / MS_PER_DAY);
}

/**
 * Rounds a price for output: cents at one unit and above, five significant digits below it, so a
 * sub-unit coin (SHIB, PEPE) keeps its precision instead of rounding to 0. Percentages are always
 * computed from the raw closes, never from these rounded values.
 */
function roundPrice(value: number): number {
    return value >= 1 ? round2(value) : Number(value.toPrecision(5));
}

function pct(from: number, to: number): number {
    return round2((to / from - 1) * 100);
}

function median(values: readonly number[]): number | null {
    return medianOfSorted(values.toSorted((a, b) => a - b));
}

function average(values: readonly number[]): number | null {
    return values.length === 0
        ? null
        : round2(values.reduce((sum, v) => sum + v, 0) / values.length);
}

/** Nearest-rank quantile (`q` in (0, 1]) of an ascending-sorted list of at least one value. */
function nearestRank(sorted: readonly number[], q: number): number {
    return sorted[Math.ceil(q * sorted.length) - 1]!;
}

function extraDayStats(values: readonly number[]): ExtraDayStats {
    const sorted = values.toSorted((a, b) => a - b);
    const quartiles = sorted.length >= QUARTILE_MIN_SAMPLES;
    return {
        samples: sorted.length,
        medianDays: medianOfSorted(sorted),
        p25Days: quartiles ? nearestRank(sorted, 0.25) : null,
        p75Days: quartiles ? nearestRank(sorted, 0.75) : null,
        maxDays: sorted.at(-1) ?? null,
    };
}

function ageConditional(
    past: readonly EpisodeTiming[],
    ageDays: number
): AgeConditional {
    const unended = past.filter(
        e => e.startConfirmedDays <= ageDays && e.endDays > ageDays
    );
    const later = unended.filter(e => e.days > ageDays);
    return {
        ageDays,
        unendedAtThisAge: unended.length,
        extremeAlreadyIn: unended.length - later.length,
        extraDaysToExtreme: extraDayStats(later.map(e => e.days - ageDays)),
    };
}

/** Rounds `value` toward `direction` at the precision {@link roundPrice} shows. */
function roundPriceToward(value: number, direction: 'up' | 'down'): number {
    const decimals = value >= 1 ? 2 : 4 - Math.floor(Math.log10(value));
    const scale = 10 ** decimals;
    const scaled = value * scale;
    const rounded =
        direction === 'up'
            ? Math.ceil(scaled - THRESHOLD_EPSILON)
            : Math.floor(scaled + THRESHOLD_EPSILON);
    return Number((rounded / scale).toFixed(decimals));
}

function dayStats(values: readonly number[]): DayStats {
    return {
        samples: values.length,
        medianDays: median(values),
        avgDays: average(values),
        minDays: values.length === 0 ? null : minOf(values),
        maxDays: values.length === 0 ? null : maxOf(values),
    };
}

/** Valid closes sorted by date, one per date (the later row wins). */
function normalize(closes: readonly MarketDailyClose[]): MarketDailyClose[] {
    const byDate = new Map(
        closes
            .filter(
                row =>
                    isRealIsoDate(row.date) &&
                    Number.isFinite(row.close) &&
                    row.close > 0
            )
            .map(row => [row.date, row.close] as const)
    );
    return [...byDate.entries()]
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([date, close]) => ({ date, close }));
}

function yearsBefore(date: string, years: number): string {
    return `${Number(date.slice(0, 4)) - years}${date.slice(4)}`;
}

/**
 * Zigzag over closes with one threshold both ways: a decline of `threshold` from the running high
 * confirms that high as a peak; a rise of `threshold` from the running low confirms that low as a
 * trough. A state machine over every close, so a counter loop (CONVENTIONS.md#CP-5).
 */
function findSwings(
    rows: readonly MarketDailyClose[],
    threshold: number
): Swings {
    const declines: SwingPair[] = [];
    let peak = 0;
    let low: number | null = null;
    let peakConfirmedAt = 0;
    for (let i = 1; i < rows.length; i++) {
        const close = rows[i]!.close;
        if (low === null) {
            if (close > rows[peak]!.close) peak = i;
            else if (
                close / rows[peak]!.close - 1 <=
                -threshold + THRESHOLD_EPSILON
            ) {
                low = i;
                peakConfirmedAt = i;
            }
        } else if (close < rows[low]!.close) {
            low = i;
        } else if (
            close / rows[low]!.close - 1 >=
            threshold - THRESHOLD_EPSILON
        ) {
            declines.push({
                peak,
                trough: low,
                peakConfirmedAt,
                troughConfirmedAt: i,
            });
            // Every close since the low stayed under this one, so it is the new running high.
            peak = i;
            low = null;
        }
    }
    return {
        declines,
        openPeak: peak,
        openLow: low,
        openPeakConfirmedAt: low === null ? null : peakConfirmedAt,
    };
}

/** First index after `from` whose close is at or above `level`, or `null`. */
function firstCloseAtOrAbove(
    rows: readonly MarketDailyClose[],
    from: number,
    level: number
): number | null {
    for (let i = from + 1; i < rows.length; i++)
        if (rows[i]!.close >= level) return i;
    return null;
}

function toDecline(
    rows: readonly MarketDailyClose[],
    { peak, trough }: SwingPair
): DeclineEpisode {
    const p = rows[peak]!;
    const t = rows[trough]!;
    const recovery = firstCloseAtOrAbove(rows, trough, p.close);
    const recoveryDate = recovery === null ? null : rows[recovery]!.date;
    return {
        peakDate: p.date,
        peakClose: roundPrice(p.close),
        troughDate: t.date,
        troughClose: roundPrice(t.close),
        changePct: pct(p.close, t.close),
        days: calendarDays(p.date, t.date),
        sessions: trough - peak,
        recoveryDate,
        daysToRecover:
            recoveryDate === null ? null : calendarDays(t.date, recoveryDate),
    };
}

function toRally(
    rows: readonly MarketDailyClose[],
    trough: number,
    peak: number
): RallyEpisode {
    const t = rows[trough]!;
    const p = rows[peak]!;
    return {
        troughDate: t.date,
        troughClose: roundPrice(t.close),
        peakDate: p.date,
        peakClose: roundPrice(p.close),
        changePct: pct(t.close, p.close),
        days: calendarDays(t.date, p.date),
        sessions: peak - trough,
    };
}

type RecoveredDecline = DeclineEpisode & {
    recoveryDate: string;
    daysToRecover: number;
};

function isRecovered(e: DeclineEpisode): e is RecoveredDecline {
    return e.recoveryDate !== null && e.daysToRecover !== null;
}

function changeStats(
    changes: readonly number[],
    direction: 'down' | 'up'
): ChangeStats {
    return {
        medianPct: median(changes),
        avgPct: average(changes),
        extremePct:
            changes.length === 0
                ? null
                : direction === 'down'
                  ? minOf(changes)
                  : maxOf(changes),
    };
}

function rallySummary(episodes: readonly RallyEpisode[]): SwingSummary {
    return {
        episodes: episodes.length,
        days: dayStats(episodes.map(e => e.days)),
        sessionsMedian: median(episodes.map(e => e.sessions)),
        change: changeStats(
            episodes.map(e => e.changePct),
            'up'
        ),
    };
}

function declineSummary(episodes: readonly DeclineEpisode[]): DeclineSummary {
    const recovered = episodes.filter(isRecovered);
    return {
        episodes: episodes.length,
        days: dayStats(episodes.map(e => e.days)),
        sessionsMedian: median(episodes.map(e => e.sessions)),
        change: changeStats(
            episodes.map(e => e.changePct),
            'down'
        ),
        recovered: recovered.length,
        daysToRecover: dayStats(recovered.map(e => e.daysToRecover)),
        peakToRecoveryDays: dayStats(
            recovered.map(e => e.days + e.daysToRecover)
        ),
    };
}

/** Band lower edges: `minSwingPct`, then every fixed edge above it. */
function bandBounds(
    minSwingPct: number,
    edges: readonly number[]
): SizeBandBounds[] {
    const lowers = [minSwingPct, ...edges.filter(edge => edge > minSwingPct)];
    return lowers.map((fromPct, i) => ({
        fromPct,
        toPct: lowers[i + 1] ?? null,
    }));
}

function inBand<E extends { changePct: number }>(
    episodes: readonly E[],
    band: SizeBandBounds
): E[] {
    return episodes.filter(e => {
        const size = Math.abs(e.changePct);
        return (
            size >= band.fromPct && (band.toPct === null || size < band.toPct)
        );
    });
}

function rallyBands(
    episodes: readonly RallyEpisode[],
    minSwingPct: number
): SwingBand[] {
    return bandBounds(minSwingPct, RALLY_BAND_EDGES).map(band => {
        const rows = inBand(episodes, band);
        return {
            ...band,
            episodes: rows.length,
            medianDays: median(rows.map(e => e.days)),
        };
    });
}

function declineBands(
    episodes: readonly DeclineEpisode[],
    minSwingPct: number
): DeclineBand[] {
    return bandBounds(minSwingPct, DECLINE_BAND_EDGES).map(band => {
        const rows = inBand(episodes, band);
        const recovered = rows.filter(isRecovered);
        return {
            ...band,
            episodes: rows.length,
            medianDays: median(rows.map(e => e.days)),
            recovered: recovered.length,
            medianDaysToRecover: median(recovered.map(e => e.daysToRecover)),
        };
    });
}

function openLeg(
    rows: readonly MarketDailyClose[],
    leg: { start: number; extreme: number; direction: 'down' | 'up' },
    threshold: number,
    past: readonly EpisodeTiming[]
): SwingOpenLeg {
    const { start, extreme, direction } = leg;
    const s = rows[start]!;
    const x = rows[extreme]!;
    const last = rows.at(-1)!;
    const extremePct = pct(s.close, x.close);
    const daysToExtreme = calendarDays(s.date, x.date);
    const daysSinceStart = calendarDays(s.date, last.date);
    return {
        startDate: s.date,
        startClose: roundPrice(s.close),
        extremeDate: x.date,
        extremeClose: roundPrice(x.close),
        extremePct,
        lastClose: roundPrice(last.close),
        changePct: pct(s.close, last.close),
        daysSinceStart,
        daysToExtreme,
        pastEpisodes: past.length,
        pastBiggerThanNow: past.filter(
            e => Math.abs(e.changePct) > Math.abs(extremePct)
        ).length,
        afterThisAge: ageConditional(past, daysSinceStart),
        endsAtClose:
            direction === 'down'
                ? roundPriceToward(x.close * (1 + threshold), 'up')
                : roundPriceToward(x.close * (1 - threshold), 'down'),
    };
}

function currentState(
    rows: readonly MarketDailyClose[],
    swings: Swings,
    declines: readonly EpisodeTiming[],
    rallies: readonly EpisodeTiming[],
    threshold: number
): SwingCurrent {
    const lastTrough = swings.declines.at(-1)?.trough;
    if (swings.openLow !== null) {
        // The open decline's high is a confirmed swing high only when a confirmed low came before it.
        if (lastTrough === undefined)
            return {
                state: 'no_confirmed_swing',
                lastClose: roundPrice(rows.at(-1)!.close),
            };
        return {
            state: 'in_decline',
            ...openLeg(
                rows,
                {
                    start: swings.openPeak,
                    extreme: swings.openLow,
                    direction: 'down',
                },
                threshold,
                declines
            ),
        };
    }
    if (lastTrough === undefined)
        return {
            state: 'no_confirmed_swing',
            lastClose: roundPrice(rows.at(-1)!.close),
        };
    return {
        state: 'in_rally',
        ...openLeg(
            rows,
            { start: lastTrough, extreme: swings.openPeak, direction: 'up' },
            threshold,
            rallies
        ),
        fromExtremePct: pct(rows[swings.openPeak]!.close, rows.at(-1)!.close),
    };
}

function windowHigh(rows: readonly MarketDailyClose[]): WindowHigh {
    const high = rows.reduce((best, row) =>
        row.close > best.close ? row : best
    );
    return {
        date: high.date,
        close: roundPrice(high.close),
        fromHighPct: pct(high.close, rows.at(-1)!.close),
    };
}

/**
 * Swing statistics of one instrument from its daily closes, for `get_swing_history`: completed
 * declines and completed rallies with how long and how far each went, and the open leg compared
 * with them.
 *
 * One threshold works both ways (a zigzag): a close `minSwingPct` below the running high confirms
 * that high as a swing high and starts a decline; a close `minSwingPct` above the running low
 * confirms that low, ends the decline and starts a rally, which ends at the next confirmed swing
 * high. A bear market's relief rallies therefore split it into several declines. Recovery (back to
 * a decline's peak close) is measured separately and may come several swings later.
 *
 * The first leg starts at the window's first close, which is not a confirmed swing point: the first
 * rally (first close to first high) is never counted, the first decline is dropped because its high
 * was not reached from a confirmed low, and `current` is `no_confirmed_swing` until a confirmed low
 * exists. Rally and decline counts can still differ by one, by the open leg. With `lookbackYears`,
 * closes more than that many years before the last close are dropped first. Invalid closes and
 * impossible dates are dropped and dates deduplicated. Options outside {@link SWING_MIN_PCT} /
 * {@link SWING_LOOKBACK_YEARS}, or fewer than two closes, return `null`. Pure.
 *
 * Server entry (`index.ts`) only, not `index.client.ts`: only the agent tool executor computes it,
 * and no browser bundle needs it.
 *
 * @param closes - Daily closes, ascending by date.
 * @param options - The swing threshold and the optional lookback window.
 * @returns The swing statistics, or `null` for options out of range or fewer than two closes.
 */
export function computeSwingHistory(
    closes: readonly MarketDailyClose[],
    options: SwingHistoryOptions
): SwingHistory | null {
    const { minSwingPct, lookbackYears } = options;
    if (!isIntegerWithin(minSwingPct, SWING_MIN_PCT)) return null;
    if (
        lookbackYears !== undefined &&
        !isIntegerWithin(lookbackYears, SWING_LOOKBACK_YEARS)
    )
        return null;
    const all = normalize(closes);
    const lastDate = all.at(-1)?.date;
    const rows =
        lookbackYears === undefined || lastDate === undefined
            ? all
            : all.filter(
                  row => row.date >= yearsBefore(lastDate, lookbackYears)
              );
    if (rows.length < 2) return null;

    const swings = findSwings(rows, minSwingPct / 100);
    // The first decline's high was reached from the window's first close, not a confirmed low.
    const confirmedDeclines = swings.declines.slice(1);
    const declines = confirmedDeclines.map(pair => toDecline(rows, pair));
    const declineTimings: EpisodeTiming[] = confirmedDeclines.map(
        (pair, i) => ({
            days: declines[i]!.days,
            startConfirmedDays: calendarDays(
                rows[pair.peak]!.date,
                rows[pair.peakConfirmedAt]!.date
            ),
            endDays: calendarDays(
                rows[pair.peak]!.date,
                rows[pair.troughConfirmedAt]!.date
            ),
            changePct: declines[i]!.changePct,
        })
    );
    // A rally runs from a decline's trough to the next confirmed peak, and ends at the close that
    // confirmed that peak.
    const rallyEnds = [
        ...confirmedDeclines.map(pair => ({
            peak: pair.peak,
            confirmedAt: pair.peakConfirmedAt,
        })),
        ...(swings.openPeakConfirmedAt === null
            ? []
            : [
                  {
                      peak: swings.openPeak,
                      confirmedAt: swings.openPeakConfirmedAt,
                  },
              ]),
    ];
    const rallyPairs = swings.declines.flatMap((pair, i) => {
        const end = rallyEnds[i];
        return end === undefined
            ? []
            : [
                  {
                      trough: pair.trough,
                      troughConfirmedAt: pair.troughConfirmedAt,
                      ...end,
                  },
              ];
    });
    const rallies = rallyPairs.map(pair =>
        toRally(rows, pair.trough, pair.peak)
    );
    const rallyTimings: EpisodeTiming[] = rallyPairs.map((pair, i) => ({
        days: rallies[i]!.days,
        startConfirmedDays: calendarDays(
            rows[pair.trough]!.date,
            rows[pair.troughConfirmedAt]!.date
        ),
        endDays: calendarDays(
            rows[pair.trough]!.date,
            rows[pair.confirmedAt]!.date
        ),
        changePct: rallies[i]!.changePct,
    }));

    return {
        minSwingPct,
        firstDate: rows[0]!.date,
        lastDate: rows.at(-1)!.date,
        sessions: rows.length,
        windowHigh: windowHigh(rows),
        declines: {
            summary: declineSummary(declines),
            bySize: declineBands(declines, minSwingPct),
            episodes: declines.toReversed().slice(0, SWING_EPISODES_LISTED_MAX),
            notListed: Math.max(0, declines.length - SWING_EPISODES_LISTED_MAX),
        },
        rallies: {
            summary: rallySummary(rallies),
            bySize: rallyBands(rallies, minSwingPct),
            episodes: rallies.toReversed().slice(0, SWING_EPISODES_LISTED_MAX),
            notListed: Math.max(0, rallies.length - SWING_EPISODES_LISTED_MAX),
        },
        current: currentState(
            rows,
            swings,
            declineTimings,
            rallyTimings,
            minSwingPct / 100
        ),
    };
}
