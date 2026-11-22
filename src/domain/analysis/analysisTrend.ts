import {
    TREND_EMA_PERIOD,
    TREND_SLOPE_LOOKBACK,
    TREND_SLOPE_MIN_ATR,
} from '@/domain/signals/constants';
import type {
    AnalysisTrendReading,
    Bar,
    IndicatorResult,
    Trend,
    TrendBasis,
} from '@/domain/types';

const SLOPE_DECIMALS = 2;

/**
 * @internal Fewest bars the rule can be measured on: EMA20 needs `TREND_EMA_PERIOD` bars
 * before it has a value, and the slope compares that value with the one
 * `TREND_SLOPE_LOOKBACK` bars later, so the first measurable bar is index
 * `TREND_EMA_PERIOD - 1 + TREND_SLOPE_LOOKBACK` (40 bars with the shipped constants).
 */
export const ANALYSIS_TREND_MIN_BARS = TREND_EMA_PERIOD + TREND_SLOPE_LOOKBACK;

/** @internal Rounds half away from zero, so a negative slope rounds like its mirror image. */
export function roundHalfAwayFromZero(value: number, decimals: number): number {
    const factor = 10 ** decimals;
    return (Math.sign(value) * Math.round(Math.abs(value) * factor)) / factor;
}

const isFinitePositive = (value: number | null | undefined): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0;

/**
 * @internal
 *
 * The top-level `trend` of an analysis, decided by arithmetic instead of by the model.
 *
 * `bullish` when EMA20 rose by at least 1 ATR(14) over the last 20 bars **and** the last
 * close is above EMA20; `bearish` when it fell by at least 1 ATR(14) and the close is
 * below EMA20; otherwise `neutral`. The slope boundary is inclusive, the close boundary
 * strict (a close equal to EMA20 is `neutral`).
 *
 * `slopeAtr` is rounded to 2 decimals half away from zero **before** it is compared, and
 * the prompt prints that rounded value: recomputing the label from the printed text gives
 * the same label (DOM-8).
 *
 * **Relation to `classifyTrend`** (`signals/trend.ts`, the dashboard scanner and the
 * confluence higher-timeframe gate): the same EMA (`TREND_EMA_PERIOD`) and the same
 * lookback (`TREND_SLOPE_LOOKBACK`), but the slope is measured in ATR instead of percent
 * (so the rule also fires on intraday bars, where a fixed 3% over 20 bars almost never
 * does). On the daily bars of the 65-symbol replay set (2017 to 2026, from bar 300) the
 * two give the same label on 92.9% of days. The dashboard keeps `classifyTrend`.
 *
 * Returns `null` (not measurable) instead of `neutral` when the rule cannot be decided:
 * fewer than {@link ANALYSIS_TREND_MIN_BARS} bars, the EMA 20 bars back or the ATR is missing or not finite, the ATR is not positive, the
 * close is not a finite positive number, or the indicator series are not aligned with the
 * bars (DOM-1: a short history is not proof of "no trend"; the caller keeps the model's
 * value).
 *
 * @param bars - OHLCV bars, oldest first.
 * @param indicators - Indicators calculated from the same `bars`.
 */
export function computeAnalysisTrend(
    bars: readonly Bar[],
    indicators: IndicatorResult
): AnalysisTrendReading | null {
    const ema = indicators.ema[TREND_EMA_PERIOD];
    const atrSeries = indicators.atr;
    if (ema === undefined) return null;
    if (ema.length !== bars.length || atrSeries.length !== bars.length) {
        return null;
    }

    if (bars.length < ANALYSIS_TREND_MIN_BARS) return null;
    const last = bars.length - 1;
    const from = last - TREND_SLOPE_LOOKBACK;

    const emaLast = ema[last];
    const emaFrom = ema[from];
    const atr = atrSeries[last];
    const close = bars[last].close;
    if (
        emaLast === null ||
        emaFrom === null ||
        !Number.isFinite(emaLast) ||
        !Number.isFinite(emaFrom)
    ) {
        return null;
    }
    if (!isFinitePositive(atr) || !isFinitePositive(close)) return null;

    const slopeAtr = roundHalfAwayFromZero(
        (emaLast - emaFrom) / atr,
        SLOPE_DECIMALS
    );
    if (!Number.isFinite(slopeAtr)) return null;

    return {
        trend: classifySlope(slopeAtr, close, emaLast),
        slopeAtr,
        emaLast,
        emaFrom,
        close,
    };
}

function classifySlope(
    slopeAtr: number,
    close: number,
    emaLast: number
): Trend {
    if (slopeAtr >= TREND_SLOPE_MIN_ATR && close > emaLast) return 'bullish';
    if (slopeAtr <= -TREND_SLOPE_MIN_ATR && close < emaLast) return 'bearish';
    return 'neutral';
}

/** @internal The stored basis of a computed reading (`AnalysisResponse.trendBasis`). */
export function trendBasisOf(reading: AnalysisTrendReading): TrendBasis {
    return {
        slopeAtr: reading.slopeAtr,
        lookbackBars: TREND_SLOPE_LOOKBACK,
        emaPeriod: TREND_EMA_PERIOD,
    };
}
