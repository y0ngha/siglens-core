/**
 * Pure parts of the WP-19 weekly and higher-timeframe evaluation: the instrument's own
 * aggregation of daily bars into ISO weeks and calendar months, its own trend, RSI, SMA and
 * market-backdrop recomputation, and the unfinished-week bookkeeping. No I/O, no clock, no
 * core call (TE-16): every definition is re-implemented here from the design text, so a bug in
 * `aggregateBarsToWeekly` or `computeAnalysisTrend` cannot hide behind a reference that calls it.
 *
 * The one thing taken from core is data, never a function: the calendar windows the engine
 * fixes by construction are registered as constants below and recorded in `run.json`.
 */
import {
    emaSeries,
    roundHalfAwayFromZero,
    wilderAtrSeries,
} from './analysisFieldsEvalCompute';
import type { TrendLabel } from './analysisFieldsEvalTypes';
import { TIMEFRAMES } from '@/domain/constants/market';
import type { Bar, Timeframe } from '@/domain/types';

const SECONDS_PER_DAY = 86_400;

/** Registered constants (design WP-19 §3.2, §3.3, §4). Recorded in `run.json`. */
export const HTF_EVAL_CONSTANTS = {
    /** Calendar days of daily history a `1Day` analysis (standard window) is given. */
    dailyWindowDays: 730,
    /** Calendar days of daily history the provider returns for a `1Day` call (5 years). */
    longWindowDays: 1830,
    /** Fewest bars the trend rule can be measured on (EMA20, 20 bars back). */
    trendMinBars: 40,
    trendEmaPeriod: 20,
    trendSlopeLookback: 20,
    trendSlopeMinAtr: 1,
    atrPeriod: 14,
    rsiPeriod: 14,
    /** The average the "close vs average" figure is measured against. */
    maPeriod: 50,
    backdropMaPeriod: 200,
    /** Sessions the market-backdrop relative change is measured over. */
    backdropSessions: [20, 60] as readonly number[],
    /** Weekly rows a `1Week` prompt prints (design §3.3). */
    weeklyRecentBars: 26,
    /** Forward sessions of the M1 measure. */
    forwardSessions: 10,
} as const;

const C = HTF_EVAL_CONSTANTS;

/**
 * The timeframes the instrument measures: core's own plus `1Week`, so the same instrument
 * builds before core knows `1Week` (WP-19 core-1) and measures it after. `coreTimeframe` is the
 * only way a value reaches `runAnalysis`: it refuses what core's `TIMEFRAMES` does not list.
 */
export type HtfTimeframe = Timeframe | '1Week';

/** `tf` as a timeframe core accepts; throws when core does not know it (fails closed). */
export function coreTimeframe(tf: HtfTimeframe): Timeframe {
    const known = TIMEFRAMES.find(candidate => candidate === tf);
    if (known === undefined) {
        throw new Error(
            `${tf} is not a timeframe of this core (known: ${TIMEFRAMES.join(', ')})`
        );
    }
    return known;
}

export type HigherKind = 'daily' | 'weekly' | 'monthly';
export type Alignment = 'aligned' | 'opposed' | 'mixed';

/** A bar of a coarser period together with the number of daily sessions it was built from. */
export interface PeriodBar extends Bar {
    sessions: number;
}

/** The bars the engine's single choke point keeps: finite, positive OHLC. */
export function usableBars(bars: readonly Bar[]): readonly Bar[] {
    return bars.filter(
        bar =>
            [bar.open, bar.high, bar.low, bar.close].every(
                v => Number.isFinite(v) && v > 0
            ) && Number.isFinite(bar.volume)
    );
}

/** Midnight UTC (seconds) of an ISO date. */
export function isoDateSeconds(isoDate: string): number {
    return Date.parse(`${isoDate}T00:00:00Z`) / 1000;
}

/**
 * Bars of the calendar window a provider call returns: `time` from the UTC date `days` before
 * `asOf` (midnight, inclusive) up to and including `asOf`.
 */
export function windowBars(
    bars: readonly Bar[],
    asOf: string,
    days: number
): readonly Bar[] {
    const to = isoDateSeconds(asOf);
    const from = to - days * SECONDS_PER_DAY;
    return usableBars(bars).filter(bar => bar.time >= from && bar.time <= to);
}

/** Monday 00:00 UTC (seconds) of the ISO week holding `unixSeconds`; 1970-01-01 was a Thursday. */
export function isoWeekStart(unixSeconds: number): number {
    const day = Math.floor(unixSeconds / SECONDS_PER_DAY);
    const sinceMonday = (day + 3) % 7;
    return (day - sinceMonday) * SECONDS_PER_DAY;
}

/** The 1st of the UTC month holding `unixSeconds`, 00:00 UTC (seconds). */
export function monthStart(unixSeconds: number): number {
    const d = new Date(unixSeconds * 1000);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
}

function aggregate(
    bars: readonly Bar[],
    startOf: (unixSeconds: number) => number
): readonly PeriodBar[] {
    // CP-5: a bucket extends the previous one while consecutive bars share its period.
    const out: PeriodBar[] = [];
    usableBars(bars).forEach(bar => {
        const start = startOf(bar.time);
        const last = out[out.length - 1];
        if (last !== undefined && last.time === start) {
            last.high = Math.max(last.high, bar.high);
            last.low = Math.min(last.low, bar.low);
            last.close = bar.close;
            last.volume += bar.volume;
            last.sessions += 1;
        } else {
            out.push({
                time: start,
                open: bar.open,
                high: bar.high,
                low: bar.low,
                close: bar.close,
                volume: bar.volume,
                sessions: 1,
            });
        }
    });
    return out;
}

/** Daily bars into ISO weeks (Monday 00:00 UTC); `time` is the Monday. */
export function aggregateWeeks(bars: readonly Bar[]): readonly PeriodBar[] {
    return aggregate(bars, isoWeekStart);
}

/** Daily bars into UTC calendar months; `time` is the 1st. */
export function aggregateMonths(bars: readonly Bar[]): readonly PeriodBar[] {
    return aggregate(bars, monthStart);
}

/** Wilder-smoothed RSI at the last close (SMA seed); `null` when not computable. */
export function rsiLast(
    closes: readonly number[],
    period: number
): number | null {
    if (closes.length <= period) return null;
    const diffs = closes.slice(1).map((close, i) => close - closes[i]);
    const gain = (d: number): number => (d > 0 ? d : 0);
    const loss = (d: number): number => (d < 0 ? -d : 0);
    const seed = (pick: (d: number) => number): number =>
        diffs.slice(0, period).reduce((s, d) => s + pick(d), 0) / period;
    const smoothed = diffs.slice(period).reduce(
        (acc, d) => ({
            gain: (acc.gain * (period - 1) + gain(d)) / period,
            loss: (acc.loss * (period - 1) + loss(d)) / period,
        }),
        { gain: seed(gain), loss: seed(loss) }
    );
    if (smoothed.loss === 0) return smoothed.gain === 0 ? null : 100;
    return 100 - 100 / (1 + smoothed.gain / smoothed.loss);
}

/** Simple average of the last `period` values; `null` below `period` values. */
export function smaLast(
    values: readonly number[],
    period: number
): number | null {
    if (values.length < period) return null;
    return values.slice(-period).reduce((s, v) => s + v, 0) / period;
}

export interface TrendReading {
    trend: TrendLabel;
    slopeAtr: number;
    emaFrom: number;
    emaLast: number;
    close: number;
}

/**
 * The shipped trend rule recomputed from OHLC (design WP-15 §2.1): EMA20 (SMA seed) moved by
 * at least one ATR(14) over 20 bars and the close on the same side of it. `null` is "not
 * measurable" (DOM-1), never "neutral".
 */
export function trendOf(bars: readonly Bar[]): TrendReading | null {
    if (bars.length < C.trendMinBars) return null;
    const closes = bars.map(bar => bar.close);
    const ema = emaSeries(closes, C.trendEmaPeriod);
    const atr = wilderAtrSeries(bars, C.atrPeriod);
    const last = bars.length - 1;
    const emaLast = ema[last];
    const emaFrom = ema[last - C.trendSlopeLookback];
    const range = atr[last];
    const close = closes[last];
    if (emaLast === null || emaFrom === null || range === null) return null;
    if (!(range > 0) || !(close > 0)) return null;
    const slopeAtr = roundHalfAwayFromZero((emaLast - emaFrom) / range, 2);
    const trend: TrendLabel =
        slopeAtr >= C.trendSlopeMinAtr && close > emaLast
            ? 'bullish'
            : slopeAtr <= -C.trendSlopeMinAtr && close < emaLast
              ? 'bearish'
              : 'neutral';
    return { trend, slopeAtr, emaFrom, emaLast, close };
}

/**
 * Alignment of the analysis timeframe's trend with the higher one: both bullish or both
 * bearish aligned, bullish against bearish opposed, anything else mixed, `null` when either
 * is not measurable.
 */
export function alignmentOf(
    analysis: TrendLabel | null,
    higher: TrendLabel | null
): Alignment | null {
    if (analysis === null || higher === null) return null;
    if (analysis === higher && analysis !== 'neutral') return 'aligned';
    if (analysis !== 'neutral' && higher !== 'neutral') return 'opposed';
    return 'mixed';
}

/** Where the last higher-timeframe bar stands: in progress or finished, and the session counts. */
export interface PeriodProgress {
    /** A later session of the same period exists in the stored bars. */
    inProgress: boolean;
    /** Sessions of the period up to and including `asOf`. */
    sessionsSoFar: number;
    /** Sessions of the period in all stored bars (the period's scheduled sessions as traded). */
    sessionsTotal: number;
    /**
     * The stored bars reach past the period (a bar of a later period exists), so
     * `sessionsTotal` is the whole period. False for a period still open at the end of the
     * stored bars: its total is then only what was stored, not what was scheduled.
     */
    totalKnown: boolean;
}

/**
 * Progress of the period holding `asOf`, read off the stored bars after `asOf` (the set
 * keeps 20 bars past every case, so the future of the week is known). `null` when `asOf` is
 * the last stored bar: the future cannot be read, so the case is not computable.
 */
export function periodProgress(
    allBars: readonly Bar[],
    asOf: string,
    startOf: (unixSeconds: number) => number
): PeriodProgress | null {
    const usable = usableBars(allBars);
    const to = isoDateSeconds(asOf);
    const hasFuture = usable.some(bar => bar.time > to);
    if (!hasFuture) return null;
    const start = startOf(to);
    const inPeriod = usable.filter(bar => startOf(bar.time) === start);
    return {
        inProgress: inPeriod.some(bar => bar.time > to),
        sessionsSoFar: inPeriod.filter(bar => bar.time <= to).length,
        sessionsTotal: inPeriod.length,
        totalKnown: usable.some(bar => startOf(bar.time) > start),
    };
}

/** One independently recomputed higher-timeframe reading. */
export interface HigherReading {
    kind: HigherKind;
    trend: TrendReading | null;
    rsi14: number | null;
    /** (close - SMA50) / SMA50 * 100; `null` under 50 bars. */
    closeVsMa50Pct: number | null;
    bars: number;
    alignment: Alignment | null;
    lastBarProgress: PeriodProgress | null;
}

/**
 * The higher-timeframe reading of a case: the analysis timeframe's own trend, the higher
 * bars' trend, RSI and distance from the 50-bar average, and the progress of the last higher
 * bar. `analysisBars` is what the analysis prompt is given; `higherBars` the aggregated series.
 */
export function higherReading(input: {
    kind: HigherKind;
    analysisBars: readonly Bar[];
    higherBars: readonly Bar[];
    progress: PeriodProgress | null;
}): HigherReading {
    const trend = trendOf(input.higherBars);
    const closes = input.higherBars.map(bar => bar.close);
    const ma50 = smaLast(closes, C.maPeriod);
    const last = closes[closes.length - 1];
    return {
        kind: input.kind,
        trend,
        rsi14: rsiLast(closes, C.rsiPeriod),
        closeVsMa50Pct:
            ma50 === null || last === undefined
                ? null
                : ((last - ma50) / ma50) * 100,
        bars: input.higherBars.length,
        alignment: alignmentOf(
            trendOf(input.analysisBars)?.trend ?? null,
            trend?.trend ?? null
        ),
        lastBarProgress: input.progress,
    };
}

/** One independently recomputed market-backdrop reading. */
export interface BackdropReading {
    trend: TrendReading | null;
    closeVsMa200Pct: number | null;
    relative: readonly {
        sessions: number;
        symbolPct: number | null;
        benchmarkPct: number | null;
    }[];
    /** Latest date both series share (`YYYY-MM-DD`), `null` when they share none. */
    endDate: string | null;
}

const dayText = (unixSeconds: number): string =>
    new Date(unixSeconds * 1000).toISOString().slice(0, 10);

/** Close-to-close change (percent) over the last `sessions` sessions of a series ending on `end`. */
function changePct(
    bars: readonly Bar[],
    end: number,
    sessions: number
): number | null {
    const upTo = bars.filter(bar => bar.time <= end);
    const last = upTo[upTo.length - 1];
    const before = upTo[upTo.length - 1 - sessions];
    if (last === undefined || before === undefined) return null;
    return (last.close / before.close - 1) * 100;
}

/**
 * The backdrop of a symbol against a benchmark, both on daily bars ending at or before `asOf`:
 * the benchmark's trend and distance from its 200-day average, and both series' change over
 * 20 and 60 sessions ending on the latest date they share.
 */
export function backdropReading(input: {
    symbolDaily: readonly Bar[];
    benchmarkDaily: readonly Bar[];
}): BackdropReading {
    const closes = input.benchmarkDaily.map(bar => bar.close);
    const ma200 = smaLast(closes, C.backdropMaPeriod);
    const last = closes[closes.length - 1];
    const symbolDates = new Set(input.symbolDaily.map(bar => bar.time));
    const common = input.benchmarkDaily
        .map(bar => bar.time)
        .filter(time => symbolDates.has(time));
    const end = common[common.length - 1];
    return {
        trend: trendOf(input.benchmarkDaily),
        closeVsMa200Pct:
            ma200 === null || last === undefined
                ? null
                : ((last - ma200) / ma200) * 100,
        relative: C.backdropSessions.map(sessions => ({
            sessions,
            symbolPct:
                end === undefined
                    ? null
                    : changePct(input.symbolDaily, end, sessions),
            benchmarkPct:
                end === undefined
                    ? null
                    : changePct(input.benchmarkDaily, end, sessions),
        })),
        endDate: end === undefined ? null : dayText(end),
    };
}

/** Decimal places of a printed number (`'12.40'` is 2, `'1,234'` is 0). */
export function decimalsOf(printed: string): number {
    const dot = printed.indexOf('.');
    return dot < 0 ? 0 : printed.length - dot - 1;
}

/** Whether `printed` is `value` rounded half away from zero at the printed number's own precision. */
export function matchesPrinted(printed: string, value: number | null): boolean {
    if (value === null) return false;
    const parsed = Number(printed.replaceAll(',', ''));
    if (!Number.isFinite(parsed)) return false;
    // Within half a unit of the last printed digit: the printed number is the value rounded
    // there, ties included (a binary 228.105 may print as either neighbour).
    return Math.abs(parsed - value) <= 0.5 * 10 ** -decimalsOf(printed) + 1e-9;
}

/** The KRX share tick (KRW) a price quotes in: the instrument's own copy of the table. */
export function krxTick(price: number): number {
    if (price < 2_000) return 1;
    if (price < 5_000) return 5;
    if (price < 20_000) return 10;
    if (price < 50_000) return 50;
    if (price < 200_000) return 100;
    if (price < 500_000) return 500;
    return 1_000;
}

/** `price` rounded to the nearest KRX tick, half up: the value a Korean prompt prints for it. */
export function roundToKrxTick(price: number): number {
    const tick = krxTick(price);
    return Math.floor(price / tick + 0.5) * tick;
}

/** Day of the week (0 = Sunday .. 6 = Saturday), UTC, of a time in seconds. */
export function weekdayOf(unixSeconds: number): number {
    return new Date(unixSeconds * 1000).getUTCDay();
}
