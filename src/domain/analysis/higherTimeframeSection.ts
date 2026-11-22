import { ANALYSIS_TREND_MIN_BARS } from '@/domain/analysis/analysisTrend';
import {
    BACKDROP_MA_PERIOD,
    HIGHER_TIMEFRAME_MA_PERIOD,
    type HigherTimeframeComputation,
} from '@/domain/analysis/higherTimeframe';
import {
    formatNullableNumber,
    formatQuotedPrice,
    formatSignedNumber,
    type PriceQuoting,
} from '@/domain/analysis/promptFormat';
import { ATR_DEFAULT_PERIOD } from '@/domain/indicators/constants';
import {
    TREND_EMA_PERIOD,
    TREND_SLOPE_LOOKBACK,
} from '@/domain/signals/constants';
import type {
    HigherTimeframeKind,
    MarketBackdropChange,
    MarketBackdropReading,
    Trend,
} from '@/domain/types';

/** How each higher timeframe is worded in the block (the unit of its average, the name of its forming bar, how it was built). */
const KIND_WORDING: Record<
    HigherTimeframeKind,
    { unit: string; current: string; source: string }
> = {
    daily: { unit: 'day', current: 'session', source: 'daily bars' },
    weekly: {
        unit: 'week',
        current: 'week',
        source: 'weekly bars built from daily history',
    },
    monthly: {
        unit: 'month',
        current: 'month',
        source: 'monthly bars built from daily history',
    },
};

const capitalized = (word: string): string =>
    `${word[0].toUpperCase()}${word.slice(1)}`;

/**
 * The claim that agreement between the daily and the weekly trend carried no forward edge. It is
 * measured on the replay set pooled across both markets (WP-19 M1: 65 symbols, 55 U.S. and 10
 * Korean stocks and ETFs, no crypto; every session from bar 300; the forward return over the next
 * 10 sessions). M1 gates only the aligned-bullish and aligned-bearish cells (week-clustered 95%
 * intervals) and splits nothing by market, so the sentence says "pooled" and claims nothing per
 * market. It is printed only for the daily-and-weekly pairing on an `equity` chart (DOM-12).
 */
const NO_MEASURED_EDGE_CLAIM =
    "on a pooled SIGLENS sample of U.S. and Korean stocks and ETFs, days when the daily and weekly trends agreed showed no measured edge in the next 10 sessions' return.";

/** What the block says about the value of agreement for every pairing nothing was measured on. */
const unmeasuredAgreementClaim = (kind: HigherTimeframeKind): string =>
    `the agreement between this chart's trend and the ${kind} trend was not measured.`;

/**
 * What `mixed` means, said where it is printed: `aligned` and `opposed` read as they are, but a
 * model reading `mixed` might take it for "disagreeing". It is the most common label (576 of
 * the 838 daily replay cases, WP-19 core-2), so the clause is short.
 */
const MIXED_MEANING = '(at least one of the two trends is neutral)';

/**
 * `### Higher Timeframe (computed, ...)`: the trend of the timeframe above the chart, by the
 * same rule and wording as `### Trend (computed)` (DOM-8), its RSI and distance from its
 * 50-bar average, whether its last bar is still forming, and the alignment with this chart's
 * trend. Every figure is the one stored on the result (`computation.reading`).
 *
 * `Not measurable` says so with the bar count and never reads as "no trend" (DOM-1). A
 * forming-bar sentence needs a clock (and, for a week or month, the daily series): without
 * them nothing is claimed (DOM-12), and a total of sessions is printed only when the calendar
 * proves it.
 *
 * @param computation - See {@link computeHigherTimeframe}.
 * @param analysisTrend - This chart's computed trend, `null` = not measurable (no alignment line).
 * @param quoting - The prompt's price precision.
 * @param measuredScope - Whether the chart lies inside what the agreement claim was measured on
 *   (an equity chart; crypto was not in the measured set). Outside it, even a weekly block says the
 *   agreement was not measured.
 *
 * @internal
 */
export function formatHigherTimeframeBlock(
    computation: HigherTimeframeComputation,
    analysisTrend: Trend | null,
    quoting: PriceQuoting,
    measuredScope: boolean
): string[] {
    const { reading, trend, progress } = computation;
    const { kind } = reading;
    const wording = KIND_WORDING[kind];
    const name = capitalized(kind);
    const heading = `### Higher Timeframe (computed, ${wording.source})`;

    const trendLine =
        trend === null
            ? `${name} trend: Not measurable: the rule needs at least ${ANALYSIS_TREND_MIN_BARS} ${kind} bars (EMA${TREND_EMA_PERIOD} ${TREND_SLOPE_LOOKBACK} bars back), a positive ATR(${ATR_DEFAULT_PERIOD}) and a positive close; received ${reading.bars} bars. This is an absence of measurement, not an absence of a trend.`
            : `${name} trend: ${trend.trend}. EMA${TREND_EMA_PERIOD} moved ${formatSignedNumber(trend.slopeAtr)} ATR(${ATR_DEFAULT_PERIOD}) over the last ${TREND_SLOPE_LOOKBACK} ${kind} bars (from ${formatQuotedPrice(trend.emaFrom, quoting)} to ${formatQuotedPrice(trend.emaLast, quoting)}) and the ${kind} close ${formatQuotedPrice(trend.close, quoting)} is ${
                  trend.close > trend.emaLast
                      ? 'above'
                      : trend.close < trend.emaLast
                        ? 'below'
                        : 'equal to'
              } EMA${TREND_EMA_PERIOD}.`;

    const { rsi14, closeVsMa50Pct } = reading;
    const figures = [
        ...(rsi14 === null
            ? []
            : [`${name} RSI(14) ${formatNullableNumber(rsi14, 1)}`]),
        ...(closeVsMa50Pct === null
            ? []
            : [
                  `${kind} close ${formatNullableNumber(Math.abs(closeVsMa50Pct), 1)}% ${
                      closeVsMa50Pct >= 0 ? 'above' : 'below'
                  } its ${HIGHER_TIMEFRAME_MA_PERIOD}-${wording.unit} average`,
              ]),
    ];

    const progressLine =
        kind === 'daily'
            ? reading.lastBarInProgress
                ? 'The last daily bar is the current session, still open.'
                : null
            : progress === null
              ? null
              : `The last ${kind} bar is the current ${wording.current} (${progress.sessionsSoFar}${
                    progress.sessionsTotal === null
                        ? ''
                        : ` of ${progress.sessionsTotal}`
                } sessions so far).`;

    const alignmentLine =
        reading.alignment === null || analysisTrend === null
            ? null
            : `Alignment with this chart's trend (${analysisTrend}): ${reading.alignment}.${
                  reading.alignment === 'mixed' ? ` ${MIXED_MEANING}` : ''
              }`;

    const guidance =
        trend === null
            ? `Descriptive only: no ${kind} trend is computed here; a remark on the ${kind} picture is your own weak estimate from the moving averages and must be labelled as one. It does not change the top-level trend, the plan or the entry zone.`
            : `Descriptive only: ${kind === 'weekly' && measuredScope ? NO_MEASURED_EDGE_CLAIM : unmeasuredAgreementClaim(kind)} Mention whether the ${kind} trend agrees with this chart in summary, in the response language's own words (do not print the English labels there). It does not change the top-level trend, the plan or the entry zone.`;

    return [
        heading,
        trendLine,
        ...(figures.length === 0 ? [] : [`${figures.join('; ')}.`]),
        ...(progressLine === null ? [] : [progressLine]),
        ...(alignmentLine === null ? [] : [alignmentLine]),
        guidance,
    ];
}

/** `+4.1%`, or `n/a` for a window the history is too short for. */
const formatChange = (pct: number | null): string =>
    pct === null ? 'n/a' : `${formatSignedNumber(pct, 1)}%`;

const formatChangePair = (change: MarketBackdropChange): string =>
    `last ${change.sessions} sessions: ${formatChange(change.symbolPct)} vs ${formatChange(change.benchmarkPct)}`;

/**
 * `### Market Backdrop (computed, daily bars)`: the benchmark's own trend (the chart trend's
 * rule) and distance from its 200-day average, then the symbol's change against the
 * benchmark's over the last 20 and 60 sessions with the date both end on (DOM-13).
 * Percentages only: an index price would join the pool of printed prices that can ground a
 * plan price. The relative line is dropped when the two series share no session.
 *
 * @param reading - See {@link computeMarketBackdrop}.
 * @param symbol - The analysed symbol, as printed in the relative line.
 *
 * @internal
 */
export function formatMarketBackdropBlock(
    reading: MarketBackdropReading,
    symbol: string
): string[] {
    const { label, trend, closeVsMa200Pct, endDate, relative } = reading;
    const average =
        closeVsMa200Pct === null
            ? ''
            : `; close ${formatNullableNumber(Math.abs(closeVsMa200Pct), 1)}% ${
                  closeVsMa200Pct >= 0 ? 'above' : 'below'
              } its ${BACKDROP_MA_PERIOD}-day average`;
    const trendLine = `${label}: trend ${
        trend === null
            ? 'not measurable (too little benchmark history)'
            : `${trend} (same rule as the chart trend above)`
    }${average}.`;
    return [
        '### Market Backdrop (computed, daily bars)',
        trendLine,
        ...(endDate === null
            ? []
            : [
                  `${symbol} vs ${label}, ${relative.map(formatChangePair).join('; ')} (both to ${endDate}).`,
              ]),
        'Descriptive only: market context; quote these percentages as printed and do not infer an index price from them. It does not change the top-level trend, the plan or the entry zone.',
    ];
}
