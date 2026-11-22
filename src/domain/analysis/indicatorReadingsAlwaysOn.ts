import { lastOf } from '@/domain/analysis/analysisUtils';
import {
    barCloseOf,
    diff,
    fmt,
    lastNonNull,
    PERCENT_FACTOR,
    price,
    volume,
} from '@/domain/analysis/indicatorReadingFigures';
import {
    ADX_WEAK_THRESHOLD,
    stackVerdictOf,
} from '@/domain/analysis/indicatorState';
import {
    detectTrend,
    type IndicatorTrend,
} from '@/domain/analysis/indicatorTrendTag';
import { ADX_TRENDING_THRESHOLD } from '@/domain/analysis/marketReferenceConstants';
import {
    EMA_DEFAULT_PERIODS,
    MA_DEFAULT_PERIODS,
} from '@/domain/indicators/constants';
import type { IndicatorReadInput, ReadingOf } from '@/domain/types';

// ─── Always-on kinds ──────────────────────────────────────────────────────────

const trendTag = (
    series: readonly (number | null)[],
    input: IndicatorReadInput
): IndicatorTrend | null => detectTrend(series, input.print.trendSampleCount);

function readStack(
    kind: 'ma' | 'ema',
    input: IndicatorReadInput
): 'bullish_stack' | 'bearish_stack' | 'mixed' | null {
    const { indicators } = input.selection;
    const verdict =
        kind === 'ma'
            ? stackVerdictOf(MA_DEFAULT_PERIODS, indicators.ma)
            : stackVerdictOf(EMA_DEFAULT_PERIODS, indicators.ema);
    if (verdict === null) return null;
    return verdict === 'bullish'
        ? 'bullish_stack'
        : verdict === 'bearish'
          ? 'bearish_stack'
          : 'mixed';
}

export function readMa(input: IndicatorReadInput): ReadingOf<'ma'> | null {
    const state = readStack('ma', input);
    if (state === null) return null;
    const { ma } = input.selection.indicators;
    const at = (period: number): number | null =>
        price(lastNonNull(ma[period] ?? []), input.print);
    return {
        kind: 'ma',
        basis: 'always_on',
        state,
        values: {
            close: barCloseOf(input),
            ma5: at(5),
            ma20: at(20),
            ma60: at(60),
            ma120: at(120),
            ma200: at(200),
        },
        signals: [],
    };
}

export function readEma(input: IndicatorReadInput): ReadingOf<'ema'> | null {
    const state = readStack('ema', input);
    if (state === null) return null;
    const { ema } = input.selection.indicators;
    const at = (period: number): number | null =>
        price(lastNonNull(ema[period] ?? []), input.print);
    return {
        kind: 'ema',
        basis: 'always_on',
        state,
        values: { ema9: at(9), ema20: at(20), ema21: at(21), ema60: at(60) },
        signals: [],
    };
}

/** ADX (and the DI pair) as `## Indicator Values` prints them; the regime is decided on the printed ADX. */
export function readAdx(input: IndicatorReadInput): ReadingOf<'adx'> | null {
    const dmi = lastOf(input.selection.indicators.dmi);
    const adx = fmt(dmi?.adx);
    if (adx === null) return null;
    return {
        kind: 'adx',
        basis: 'always_on',
        state:
            adx >= ADX_TRENDING_THRESHOLD
                ? 'trending'
                : adx < ADX_WEAK_THRESHOLD
                  ? 'weak'
                  : 'between',
        values: { adx, diPlus: fmt(dmi?.diPlus), diMinus: fmt(dmi?.diMinus) },
        signals: [],
    };
}

export function readAtr(input: IndicatorReadInput): ReadingOf<'atr'> | null {
    const { atr } = input.selection.indicators;
    const latest = lastNonNull(atr);
    const state = trendTag(atr, input);
    const value = diff(latest, input.print);
    if (value === null || state === null) return null;
    const close = input.selection.price;
    return {
        kind: 'atr',
        basis: 'always_on',
        state,
        values: {
            atr: value,
            atrPercent:
                latest !== null && close > 0
                    ? fmt((latest / close) * PERCENT_FACTOR)
                    : null,
        },
        signals: [],
    };
}

export function readObv(input: IndicatorReadInput): ReadingOf<'obv'> | null {
    const { obv } = input.selection.indicators;
    const value = volume(lastNonNull(obv));
    const state = trendTag(obv, input);
    if (value === null || state === null) return null;
    return {
        kind: 'obv',
        basis: 'always_on',
        state,
        values: { obv: value },
        signals: [],
    };
}

/** Where the close sits against the value area, both as printed (the close at the quoted precision). */
export function readVolumeProfile(
    input: IndicatorReadInput
): ReadingOf<'volume_profile'> | null {
    const vp = input.selection.indicators.volumeProfile;
    const [poc, vah, val, close] = [
        price(vp?.poc, input.print),
        price(vp?.vah, input.print),
        price(vp?.val, input.print),
        barCloseOf(input),
    ];
    if (vah === null || val === null || close === null) return null;
    return {
        kind: 'volume_profile',
        basis: 'always_on',
        state:
            close > vah
                ? 'above_value_area'
                : close < val
                  ? 'below_value_area'
                  : 'inside_value_area',
        values: { close, poc, vah, val, bars: input.print.barCount },
        signals: [],
    };
}
