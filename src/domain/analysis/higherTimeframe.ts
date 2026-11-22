import { aggregateBarsToMonthly } from '@/domain/analysis/aggregateBarsToMonthly';
import { aggregateBarsToWeekly } from '@/domain/analysis/aggregateBarsToWeekly';
import { lastOf } from '@/domain/analysis/analysisUtils';
import {
    computeAnalysisTrend,
    roundHalfAwayFromZero,
} from '@/domain/analysis/analysisTrend';
import {
    lastPeriodProgress,
    type BarPeriod,
    type PeriodClock,
    type PeriodProgress,
} from '@/domain/analysis/barPeriods';
import { isLastDailyBarFinished } from '@/domain/analysis/marketReference';
import { MS_PER_DAY, MS_PER_SECOND } from '@/domain/constants/time';
import { calculateIndicators } from '@/domain/indicators';
import type {
    AnalysisTrendReading,
    Bar,
    BarsData,
    HigherTimeframeKind,
    HigherTimeframeReading,
    IndicatorResult,
    MarketBackdropChange,
    MarketBackdropReading,
    MarketBackdropSessions,
    Timeframe,
    Trend,
    TrendAlignment,
} from '@/domain/types';

/** @internal The average the higher-timeframe reading measures the close against (in higher-timeframe bars). */
export const HIGHER_TIMEFRAME_MA_PERIOD = 50;

/** @internal The average the market backdrop measures the benchmark's close against (in daily bars). */
export const BACKDROP_MA_PERIOD = 200;

/** @internal The windows, in daily sessions, the market backdrop compares the symbol with its benchmark over. */
export const BACKDROP_SESSIONS: readonly MarketBackdropSessions[] = [20, 60];

/** Printed precision of the percentages: the stored value is the printed one (DOM-8). */
const PERCENT_DECIMALS = 1;

/**
 * The higher timeframe of each analysis timeframe: an intraday chart reads the daily series
 * the run already fetches for Fear & Greed, `1Day` the weekly series built from its 5-year
 * history, `1Week` the monthly series built from the same history. No new fetch for any.
 * Exhaustive on purpose: a new timeframe does not compile until its higher timeframe is chosen.
 */
const HIGHER_KIND_BY_TIMEFRAME: Record<Timeframe, HigherTimeframeKind> = {
    '5Min': 'daily',
    '15Min': 'daily',
    '30Min': 'daily',
    '1Hour': 'daily',
    '4Hour': 'daily',
    '1Day': 'weekly',
    '1Week': 'monthly',
};

const PERIOD_BY_KIND: Record<
    Exclude<HigherTimeframeKind, 'daily'>,
    BarPeriod
> = {
    weekly: 'week',
    monthly: 'month',
};

/** @internal The higher-timeframe bars of a run and what they were built from. */
export interface HigherTimeframeSeries {
    readonly kind: HigherTimeframeKind;
    /** The higher-timeframe bars, oldest first; the last one may still be forming. */
    readonly bars: readonly Bar[];
    /** Indicators calculated from `bars`. */
    readonly indicators: IndicatorResult;
    /** The daily series `bars` were built from (the daily series itself for `daily`). Counts the sessions of a forming week or month. */
    readonly dailyBars: readonly Bar[];
}

/**
 * @internal
 *
 * The daily history a run holds next to the chart it analyses, from the daily data it fetched
 * (`1Day`'s own request, the daily fetch an intraday chart makes for Fear & Greed, or the
 * daily source a `1Week` request carries): the long `fearGreedBars` history when there is one,
 * else the standard `bars`. On `1Week`, `bars` is the weekly series itself, so without the
 * daily source there is no daily history (`[]`), never the weekly bars read as daily ones.
 */
export function dailyHistoryOf(
    timeframe: Timeframe,
    daily: BarsData
): readonly Bar[] {
    const long = daily.fearGreedBars;
    if (long !== undefined && long.length > 0) return long;
    return timeframe === '1Week' ? [] : daily.bars;
}

/**
 * @internal
 *
 * The higher-timeframe series of an analysis timeframe, or `null` when there is no daily
 * history to build it from (an empty series proves nothing about the higher timeframe, so the
 * prompt states nothing, DOM-12). An intraday chart gets the daily bars and indicators as
 * fetched; `1Day` and `1Week` aggregate the long daily history into ISO weeks and UTC months
 * and calculate indicators on those.
 *
 * @param timeframe - The timeframe being analysed.
 * @param daily - The daily data of the run (see {@link dailyHistoryOf}).
 */
export function higherTimeframeSeriesOf(
    timeframe: Timeframe,
    daily: BarsData
): HigherTimeframeSeries | null {
    const kind = HIGHER_KIND_BY_TIMEFRAME[timeframe];
    const dailyBars = dailyHistoryOf(timeframe, daily);
    if (dailyBars.length === 0) return null;
    if (kind === 'daily') {
        return {
            kind,
            bars: daily.bars,
            indicators: daily.indicators,
            dailyBars,
        };
    }
    const bars =
        kind === 'weekly'
            ? aggregateBarsToWeekly(dailyBars)
            : aggregateBarsToMonthly(dailyBars);
    return {
        kind,
        bars,
        indicators: calculateIndicators(bars),
        dailyBars,
    };
}

/** Both trends bullish or both bearish is aligned, bullish against bearish opposed, else mixed; `null` when either is unknown. */
function alignmentOf(
    analysis: Trend | null,
    higher: Trend | null
): TrendAlignment | null {
    if (analysis === null || higher === null) return null;
    if (analysis === higher && analysis !== 'neutral') return 'aligned';
    if (analysis !== 'neutral' && higher !== 'neutral') return 'opposed';
    return 'mixed';
}

/** Rounds a figure to the precision the prompt prints it at. */
const toPrinted = (value: number): number =>
    roundHalfAwayFromZero(value, PERCENT_DECIMALS);

/** SMA of the last `period` closes, `null` under `period` bars. */
function smaOfLast(bars: readonly Bar[], period: number): number | null {
    if (bars.length < period) return null;
    return (
        bars.slice(-period).reduce((sum, bar) => sum + bar.close, 0) / period
    );
}

/** The close's distance from its average in percent (1 dp), `null` under `period` bars or without a positive average. */
function closeVsAveragePct(
    bars: readonly Bar[],
    period: number
): number | null {
    const average = smaOfLast(bars, period);
    const close = bars.at(-1)?.close;
    if (average === null || close === undefined || !(average > 0)) return null;
    return toPrinted(((close - average) / average) * 100);
}

const utcDay = (ms: number): number => Math.floor(ms / MS_PER_DAY);

/**
 * Whether the last daily bar is still forming at `clock.now`, `false` when that cannot be
 * proven (no clock). A scheduled session reads the exchange calendar; a 24/7 session's daily
 * bar ends at the UTC boundary, so it is forming while it is today's.
 */
function dailyBarInProgress(
    lastBar: Bar | undefined,
    clock: PeriodClock | undefined
): boolean {
    if (lastBar === undefined || clock === undefined) return false;
    if (clock.session.kind === 'always-open') {
        return (
            utcDay(lastBar.time * MS_PER_SECOND) === utcDay(clock.now.getTime())
        );
    }
    return !isLastDailyBarFinished(lastBar, clock);
}

/**
 * What a prompt build is handed besides the chart's own bars: the higher-timeframe series and
 * the benchmark's daily bars with the symbol's own daily history to compare them with. Either
 * is `null` when the caller had no data for it (the matching block is then absent).
 *
 * @internal
 */
export interface HigherContextInput {
    readonly higher: HigherTimeframeSeries | null;
    readonly backdrop: {
        readonly label: string;
        readonly symbolDaily: readonly Bar[];
        readonly benchmark: MarketBackdropBenchmarkBars;
    } | null;
}

/** @internal What `computeHigherTimeframe` found: the stored reading and the figures its prompt block prints beyond it. */
export interface HigherTimeframeComputation {
    readonly reading: HigherTimeframeReading;
    /** The trend rule's full reading (EMA endpoints and close), `null` = not measurable. */
    readonly trend: AnalysisTrendReading | null;
    /** Sessions of the forming week or month; `null` for `daily`, a finished period and an unknown one. */
    readonly progress: PeriodProgress | null;
}

/**
 * @internal
 *
 * The higher-timeframe reading of an analysis: the trend rule (`computeAnalysisTrend`, one
 * rule for every timeframe) on the higher-timeframe bars, their RSI(14), the close's distance
 * from the 50-bar average, whether the last bar is still forming, and the alignment with the
 * analysed chart's trend. No price levels: a higher-timeframe high or low would become a second
 * level source the model cites as a key level. Pure: the instant comes from `clock`.
 *
 * Unknown stays unknown (DOM-1, DOM-12): too few bars give a `null` trend, never `neutral`;
 * without a clock (or, for a week or month, without the daily series) nothing is claimed about
 * the last bar's progress.
 *
 * @param input.series - The higher-timeframe series, see {@link higherTimeframeSeriesOf}.
 * @param input.analysisTrend - The analysed chart's own computed trend, `null` = not measurable.
 * @param input.clock - The listing's session and the analysis instant.
 */
export function computeHigherTimeframe(input: {
    series: HigherTimeframeSeries;
    analysisTrend: Trend | null;
    clock?: PeriodClock;
}): HigherTimeframeComputation {
    const { series, analysisTrend, clock } = input;
    const { kind, bars, indicators, dailyBars } = series;
    const trend = computeAnalysisTrend(bars, indicators);
    const progress =
        kind === 'daily'
            ? null
            : lastPeriodProgress(
                  PERIOD_BY_KIND[kind],
                  bars.at(-1),
                  dailyBars,
                  clock
              );
    const rsi = lastOf(indicators.rsi);
    return {
        reading: {
            kind,
            trend: trend?.trend ?? null,
            slopeAtr: trend?.slopeAtr ?? null,
            rsi14: rsi === null ? null : toPrinted(rsi),
            closeVsMa50Pct: closeVsAveragePct(bars, HIGHER_TIMEFRAME_MA_PERIOD),
            lastBarInProgress:
                kind === 'daily'
                    ? dailyBarInProgress(bars.at(-1), clock)
                    : progress !== null,
            bars: bars.length,
            alignment: alignmentOf(analysisTrend, trend?.trend ?? null),
        },
        trend,
        progress,
    };
}

/** The close-to-close change (percent, 1 dp) over `sessions` bars of `bars` ending at the bar stamped `end`, `null` with too little history. */
function changeToEnd(
    bars: readonly Bar[],
    end: number,
    sessions: number
): number | null {
    const endIndex = bars.findIndex(bar => bar.time === end);
    const last = bars[endIndex];
    const before = bars[endIndex - sessions];
    if (last === undefined || before === undefined) return null;
    return toPrinted((last.close / before.close - 1) * 100);
}

/** The latest time both series have a bar at, `null` when they share none. */
function latestCommonTime(
    first: readonly Bar[],
    second: readonly Bar[]
): number | null {
    const firstTimes = new Set(first.map(bar => bar.time));
    return (
        second.map(bar => bar.time).findLast(time => firstTimes.has(time)) ??
        null
    );
}

/** @internal The benchmark's daily bars and the indicators calculated from them. */
export interface MarketBackdropBenchmarkBars {
    readonly bars: readonly Bar[];
    readonly indicators: IndicatorResult;
}

/**
 * @internal
 *
 * The market backdrop of a symbol: the benchmark's own daily trend (the same rule as the
 * chart trend) and its close's distance from the 200-day average, and the symbol's change
 * against the benchmark's over the last 20 and 60 daily sessions. Both series end on the
 * latest date they share (so a holiday of one market never compares a stale close with a live
 * one) and each window counts that series' own sessions back from it; `endDate` names that
 * date (DOM-13). Percentages only: an index price in a prompt would join the pool of printed
 * prices a plan price can be grounded on.
 *
 * @param input.label - The benchmark's printed name.
 * @param input.symbolDaily - The symbol's daily bars, oldest first.
 * @param input.benchmark - The benchmark's daily bars and indicators, oldest first.
 */
export function computeMarketBackdrop(input: {
    label: string;
    symbolDaily: readonly Bar[];
    benchmark: MarketBackdropBenchmarkBars;
}): MarketBackdropReading {
    const { label, symbolDaily, benchmark } = input;
    const end = latestCommonTime(symbolDaily, benchmark.bars);
    const relative: readonly MarketBackdropChange[] = BACKDROP_SESSIONS.map(
        sessions => ({
            sessions,
            symbolPct:
                end === null ? null : changeToEnd(symbolDaily, end, sessions),
            benchmarkPct:
                end === null
                    ? null
                    : changeToEnd(benchmark.bars, end, sessions),
        })
    );
    return {
        label,
        trend:
            computeAnalysisTrend(benchmark.bars, benchmark.indicators)?.trend ??
            null,
        closeVsMa200Pct: closeVsAveragePct(benchmark.bars, BACKDROP_MA_PERIOD),
        endDate:
            end === null
                ? null
                : new Date(end * MS_PER_SECOND).toISOString().slice(0, 10),
        relative,
    };
}
