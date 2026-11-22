import { findLastIndex } from '@/domain/arrayCompat';
import { calculateMA } from '@/domain/indicators/ma';
import { findMaCrosses, type MaCrossScan } from '@/domain/indicators/maCrosses';
import type { Bar } from '@/domain/types';

/**
 * Bar statistics an agent tool reports next to raw bars ("how far below the
 * 60-bar high", "how many days in a row down", "50/200 crosses in the last
 * year", "how did the stock move across each earnings report").
 *
 * Every function here returns RAW numbers: distances and changes are plain
 * ratios (`(current - base) / base`, so 0.05 = +5%), dates are bar times
 * (Unix seconds), and nothing is rounded. Presentation (percent scale,
 * significant-digit rounding, date strings, key names) belongs to the caller,
 * so the bytes a consumer prints stay under its own control.
 *
 * Shared null rule: a ratio is `null` unless both inputs are finite and the
 * base is greater than zero. A zero or negative base makes "% of base"
 * meaningless, and a missing or `NaN` input is unknown, never silently 0.
 */

/** Bars a consumer must pass oldest-first; every function reads them in that order. */
type OrderedBars = readonly Bar[];

const SECONDS_TO_MS = 1000;
const ISO_DATE_LENGTH = 10;
/** Volume baseline window of {@link computeBarChangeStats}: the 20 completed bars before the last one. */
const VOLUME_BASELINE_BARS = 20;
/** Fixed SMA period behind {@link BarChangeStats.ma50DistanceRatio}. */
const FIXED_MA_PERIOD = 50;

/**
 * `(current - base) / base`, or `null` unless both are finite numbers and
 * `base > 0`.
 */
function ratioVs(
    current: number | null | undefined,
    base: number | null | undefined
): number | null {
    if (
        current === null ||
        current === undefined ||
        base === null ||
        base === undefined ||
        !Number.isFinite(current) ||
        !Number.isFinite(base) ||
        base <= 0
    )
        return null;
    return (current - base) / base;
}

function lastOrNull<T>(values: readonly T[] | undefined): T | null {
    return values?.at(-1) ?? null;
}

/**
 * UTC calendar date (`YYYY-MM-DD`) of a daily bar, or `null` when its `time`
 * is not a usable timestamp (NaN, Infinity, or beyond the Date range), where
 * `toISOString` would throw.
 */
function barUtcDate(bar: Bar): string | null {
    const date = new Date(bar.time * SECONDS_TO_MS);
    return Number.isFinite(date.getTime())
        ? date.toISOString().slice(0, ISO_DATE_LENGTH)
        : null;
}

/** One extreme of a window: its value, the bar it was set on, and the last close's distance from it. */
export interface BarExtreme {
    value: number;
    /** `time` (Unix seconds) of the bar that set the extreme. */
    time: number;
    /**
     * `(lastClose - value) / value`, unrounded; `null` when `lastClose` is not
     * a finite number or `value` is not above zero.
     */
    fromLastCloseRatio: number | null;
}

/** Result of {@link computeBarRangeStats}. Each extreme is `null` when no bar in the window has a finite value. */
export interface BarRangeStats {
    /** Highest intraday high. */
    high: BarExtreme | null;
    /** Lowest intraday low. */
    low: BarExtreme | null;
    /** Highest close. */
    highClose: BarExtreme | null;
    /** Lowest close. */
    lowClose: BarExtreme | null;
}

/**
 * The bar holding the extreme of `value` over `window`. Only finite values
 * count; `beats` uses `>=`/`<=` so a LATER bar wins a tie (the time is the most
 * recent touch).
 */
function extremeBar(
    window: OrderedBars,
    value: (bar: Bar) => number,
    beats: (candidate: number, best: number) => boolean
): Bar | null {
    return window.reduce<Bar | null>((best, b) => {
        const v = value(b);
        if (!Number.isFinite(v)) return best;
        return best === null || beats(v, value(best)) ? b : best;
    }, null);
}

function extremeOf(
    window: OrderedBars,
    value: (bar: Bar) => number,
    beats: (candidate: number, best: number) => boolean,
    lastClose: number | null
): BarExtreme | null {
    const bar = extremeBar(window, value, beats);
    if (bar === null) return null;
    return {
        value: value(bar),
        time: bar.time,
        fromLastCloseRatio: ratioVs(lastClose, value(bar)),
    };
}

/**
 * High/low and close high/low over `window`, the bar each was set on, and the
 * last close's distance from each.
 *
 * Only finite values count: a single bad bar (NaN/Infinity from an upstream
 * data glitch) must not poison the whole window's max/min. A tie goes to the
 * LATER bar, so `time` is the most recent touch. An empty window, or one with
 * no finite value for a field, gives `null` for that extreme.
 *
 * @param window - Bars oldest-first (any length).
 * @param lastClose - The close the distances are measured from; `null` or a
 *   non-finite value makes every `fromLastCloseRatio` `null`.
 */
export function computeBarRangeStats(
    window: OrderedBars,
    lastClose: number | null
): BarRangeStats {
    return {
        high: extremeOf(
            window,
            b => b.high,
            (a, best) => a >= best,
            lastClose
        ),
        low: extremeOf(
            window,
            b => b.low,
            (a, best) => a <= best,
            lastClose
        ),
        highClose: extremeOf(
            window,
            b => b.close,
            (a, best) => a >= best,
            lastClose
        ),
        lowClose: extremeOf(
            window,
            b => b.close,
            (a, best) => a <= best,
            lastClose
        ),
    };
}

/** Direction of a close streak. `flat` = the last close equals the previous one. */
export type CloseStreakDirection = 'up' | 'down' | 'flat';

/** Result of {@link computeCloseStreak}. */
export interface CloseStreak {
    direction: CloseStreakDirection;
    /**
     * Consecutive closes moving in `direction` (closes 10,9,8 → down, 2; a
     * single down day after an up day → down, 1). For `flat` it is the run of
     * unchanged closes.
     */
    days: number;
    /**
     * `time` (Unix seconds) of the first bar whose close moved in `direction`
     * from the close before it (the first down day for a down streak). For
     * `flat` that is the first bar whose close EQUALS the previous close, i.e.
     * the second bar at the unchanged level, not the bar that first printed
     * that level (closes 9,10,10,10 → flat, 2, `sinceTime` of the second 10);
     * so `days` counts repeats of the close, not bars at the level.
     */
    sinceTime: number;
    /**
     * `true` when the streak runs back to the FIRST loaded bar without a
     * direction change: the real streak may be longer than `days`. Then
     * `sinceTime` is the second loaded bar (`completed[1]`, where the first
     * move happened), never the first loaded bar, which only supplies the
     * close the first move is measured against. Report it as "at least N".
     */
    truncated: boolean;
}

/** Options of {@link computeCloseStreak}. */
export interface CloseStreakOptions {
    /**
     * Drop the last bar before counting. Set it while the last bar is still
     * forming: its "close" is the live price, not a completed close.
     */
    excludeLastBar: boolean;
}

function directionOf(sign: number): CloseStreakDirection {
    if (sign > 0) return 'up';
    return sign < 0 ? 'down' : 'flat';
}

/**
 * Streak of same-direction closes ending at the last completed bar. Scans
 * only the bars passed in; any non-finite close inside the walked run makes
 * the result `null` rather than a silently shortened streak. `null` as well
 * with fewer than 2 bars left after `excludeLastBar`.
 *
 * Callers decide whether the series is daily: this function only compares
 * consecutive closes and does not look at bar spacing.
 *
 * @param bars - Bars oldest-first.
 */
export function computeCloseStreak(
    bars: OrderedBars,
    options: CloseStreakOptions
): CloseStreak | null {
    const completed = options.excludeLastBar ? bars.slice(0, -1) : bars;
    if (completed.length < 2) return null;
    // moves[j] = direction of the close move INTO bar j + 1 (NaN when either close is non-finite).
    const moves = completed.slice(1).map((b, j) => {
        // j < completed.length - 1, so completed[j] always exists.
        const diff = b.close - completed[j].close;
        return Number.isFinite(diff) ? Math.sign(diff) : Number.NaN;
    });
    const lastMove = moves.at(-1);
    if (lastMove === undefined || Number.isNaN(lastMove)) return null;
    // Last move that differs from the final one; -1 = the streak spans every loaded bar.
    const breakIdx = findLastIndex(moves, m => m !== lastMove);
    if (breakIdx >= 0 && Number.isNaN(moves[breakIdx])) return null;
    const sinceBar = completed[breakIdx + 2];
    if (sinceBar === undefined) return null;
    return {
        direction: directionOf(lastMove),
        days: moves.length - 1 - breakIdx,
        sinceTime: sinceBar.time,
        truncated: breakIdx === -1,
    };
}

/**
 * SMA periods and window behind the long-term cross scan: 50-bar over 200-bar,
 * checked across the last 252 bars (about a year of daily bars).
 */
export const LONG_TERM_MA_CROSS = {
    fast: 50,
    slow: 200,
    lookbackBars: 252,
} as const;

/**
 * 50/200-bar SMA crossings over the last 252 bars ({@link LONG_TERM_MA_CROSS}),
 * oldest first: `findMaCrosses` with those parameters. Callers pass daily bars
 * and run it on the full series, never a trimmed view.
 *
 * `complete: false` means the loaded history is too short to check the whole
 * window: an empty `crosses` then does NOT mean "no cross in a year".
 *
 * @param bars - Bars oldest-first.
 */
export function scanLongTermMaCrosses(bars: OrderedBars): MaCrossScan {
    return findMaCrosses(
        bars.slice(),
        LONG_TERM_MA_CROSS.fast,
        LONG_TERM_MA_CROSS.slow,
        LONG_TERM_MA_CROSS.lookbackBars
    );
}

/** The indicator series {@link computeBarChangeStats} reads (a structural subset of `IndicatorResult`). */
export interface BarChangeStatsIndicators {
    /** ATR per bar. */
    atr: readonly (number | null)[];
    /** SMAs keyed by period. */
    ma: Readonly<Record<number, readonly (number | null)[]>>;
    /** EMAs keyed by period. */
    ema: Readonly<Record<number, readonly (number | null)[]>>;
}

/** Options of {@link computeBarChangeStats}. */
export interface BarChangeStatsOptions<K extends string> {
    /**
     * Bars back for each change key — a fixed bar count (not calendar days) on
     * every timeframe: `{ '1bar': 1, '5bars': 5 }`. A key is `null` unless more
     * than that many bars are loaded.
     */
    barsBack: Readonly<Record<K, number>>;
    /**
     * `true` when the last bar is a partial week or month. It holds only part
     * of a period's volume, so its ratio to 20 full periods would read as a
     * collapse; `volumeVsAvg20` is then `null`.
     */
    partialPeriod: boolean;
}

/** Result of {@link computeBarChangeStats}. Every ratio is unrounded; `null` follows the shared null rule. */
export interface BarChangeStats<K extends string> {
    /** Close of the last bar, echoed as given (even a non-finite one); `null` for no bars. */
    lastClose: number | null;
    /** `(lastClose - close N bars back) / close N bars back`, per `barsBack` key. */
    changeRatio: Record<K, number | null>;
    /**
     * Last bar's volume over the mean volume of the 20 bars before it. `null`
     * with fewer than 21 bars, a non-finite volume anywhere in the window, a
     * non-positive mean, or `partialPeriod`.
     */
    volumeVsAvg20: number | null;
    /** Last ATR over the last close (a ratio OF price, not a distance from a base). */
    atrRatio: number | null;
    /**
     * `(lastClose - SMA50) / SMA50`, with the SMA computed here from `bars`
     * (not read from `indicators.ma`, which carries only the caller's
     * configured periods), so it exists even when 50 is not configured.
     */
    ma50DistanceRatio: number | null;
    /** Same distance for each SMA period in `indicators.ma`, keyed by period. */
    maDistanceRatio: Record<string, number | null>;
    /** Same distance for each EMA period in `indicators.ema`, keyed by period. */
    emaDistanceRatio: Record<string, number | null>;
}

function distancesFromLast(
    series: Readonly<Record<number, readonly (number | null)[]>>,
    lastClose: number | null
): Record<string, number | null> {
    return Object.fromEntries(
        Object.entries(series).map(([period, values]) => [
            period,
            ratioVs(lastClose, lastOrNull(values)),
        ])
    );
}

/**
 * Returns, volume ratio, ATR ratio and moving-average distances of the last
 * bar: the numbers a model would otherwise compute itself from raw bars.
 *
 * @param bars - Bars oldest-first.
 * @param indicators - Indicator series aligned to `bars` (`IndicatorResult`
 *   fits).
 */
export function computeBarChangeStats<K extends string>(
    bars: OrderedBars,
    indicators: BarChangeStatsIndicators,
    options: BarChangeStatsOptions<K>
): BarChangeStats<K> {
    const lastClose = lastOrNull(bars.map(b => b.close));
    // Cast: `Object.fromEntries` widens to `{ [k: string]: ... }`, which
    // TypeScript cannot narrow back to the key union `K`. Safe: the entries
    // are built from `Object.entries(options.barsBack)` with one value per
    // key, so the result has exactly the keys of `barsBack` (typed `K`).
    const changeRatio = Object.fromEntries(
        Object.entries<number>(options.barsBack).map(([key, barsBack]) => {
            const base =
                bars.length > barsBack
                    ? (bars[bars.length - 1 - barsBack]?.close ?? null)
                    : null;
            return [key, ratioVs(lastClose, base)];
        })
    ) as Record<K, number | null>;

    const prevVolumes = bars
        .slice(-(VOLUME_BASELINE_BARS + 1), -1)
        .map(b => b.volume);
    const lastVolume = lastOrNull(bars.map(b => b.volume));
    const avgVolume =
        prevVolumes.length === VOLUME_BASELINE_BARS &&
        prevVolumes.every(Number.isFinite)
            ? prevVolumes.reduce((sum, v) => sum + v, 0) / prevVolumes.length
            : null;
    const volumeVsAvg20 =
        !options.partialPeriod &&
        lastVolume !== null &&
        Number.isFinite(lastVolume) &&
        avgVolume !== null &&
        avgVolume > 0
            ? lastVolume / avgVolume
            : null;

    // ATR is a ratio OF price (atr / price), not a distance from a base like
    // the other ratios, so `ratioVs` (which computes (atr - price) / price)
    // does not apply.
    const lastAtr = lastOrNull(indicators.atr);
    const atrRatio =
        lastAtr !== null &&
        Number.isFinite(lastAtr) &&
        lastClose !== null &&
        Number.isFinite(lastClose) &&
        lastClose > 0
            ? lastAtr / lastClose
            : null;

    // `calculateMA` needs a mutable array; `.slice()` is a defensive copy.
    const ma50 = lastOrNull(calculateMA(bars.slice(), FIXED_MA_PERIOD));

    return {
        lastClose,
        changeRatio,
        volumeVsAvg20,
        atrRatio,
        ma50DistanceRatio: ratioVs(lastClose, ma50),
        maDistanceRatio: distancesFromLast(indicators.ma, lastClose),
        emaDistanceRatio: distancesFromLast(indicators.ema, lastClose),
    };
}

/** One past earnings report and how the stock moved across it. */
export interface EarningsReaction {
    /** The report date (`YYYY-MM-DD`), as passed in. */
    date: string;
    /**
     * `(close of the first session AFTER the date - close of the last session
     * BEFORE it) / the earlier close`, unrounded; `null` when either close is
     * not a finite number or the earlier close is not above zero. The window
     * spans the report day and the next session because the data has no
     * before-open/after-close timing: a pre-market report moves the stock on
     * `date`, an after-close one on the next session, and this window covers
     * both.
     */
    moveRatio: number | null;
}

/** Options of {@link computeEarningsReactions}. */
export interface EarningsReactionOptions {
    /**
     * Leave out the last bar. Set it while the daily series ends with today's
     * live bar: its close is the current price, so an after-close report on D
     * read during D+1 would otherwise get a half-day "reaction".
     */
    excludeLastBar: boolean;
    /** How many of the newest report dates to return (after skipping the ones the bars cannot measure). */
    limit: number;
}

/**
 * Price reaction to each of the newest `limit` reported earnings dates, newest
 * first, from DAILY `bars` (oldest-first, `time` at UTC midnight). Duplicate
 * dates count once. Bars whose `time` is not a usable timestamp are ignored.
 * A date is skipped when the loaded bars do not have a
 * COMPLETED session on both sides of it (too old for the series, or no
 * finished session after it yet).
 *
 * @param reportedDates - `YYYY-MM-DD` strings, any order.
 */
export function computeEarningsReactions(
    bars: OrderedBars,
    reportedDates: readonly string[],
    options: EarningsReactionOptions
): EarningsReaction[] {
    // A bar without a usable `time` has no session date: it is left out like
    // any other unusable row instead of throwing (the dates stay aligned with
    // `completed` because both come from the same filtered list).
    const dated = (options.excludeLastBar ? bars.slice(0, -1) : bars).flatMap(
        (b): { bar: Bar; date: string }[] => {
            const date = barUtcDate(b);
            return date === null ? [] : [{ bar: b, date }];
        }
    );
    const completed = dated.map(d => d.bar);
    const dates = dated.map(d => d.date);
    const newestFirst = [...new Set(reportedDates)].sort((a, b) =>
        b.localeCompare(a)
    );
    return newestFirst
        .flatMap((date): EarningsReaction[] => {
            const afterIndex = dates.findIndex(d => d > date);
            // -1: no session after the report yet; 0: the series starts after it.
            if (afterIndex <= 0) return [];
            const beforeIndex =
                dates[afterIndex - 1] === date
                    ? afterIndex - 2
                    : afterIndex - 1;
            const after = completed[afterIndex];
            const before = completed[beforeIndex];
            if (after === undefined || before === undefined) return [];
            return [{ date, moveRatio: ratioVs(after.close, before.close) }];
        })
        .slice(0, options.limit);
}
