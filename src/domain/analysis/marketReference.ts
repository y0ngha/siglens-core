import type {
    Bar,
    HorizonKey,
    HorizonReference,
    IndicatorResult,
    MarketReference,
    ReferenceLevel,
    SMCSwingPoint,
    Timeframe,
    TrendStructure,
} from '@/domain/types';
import {
    HORIZON_WINDOWS_BY_TIMEFRAME,
    HORIZON_MA_PERIODS,
    ADX_TRENDING_THRESHOLD,
    EFFICIENCY_RATIO_TRENDING_THRESHOLD,
} from '@/domain/analysis/marketReferenceConstants';
import {
    collectIndicatorLevels,
    splitBySide,
    roundNumberLevels,
} from '@/domain/analysis/referenceLevels';
import { computeFibonacciProjection } from '@/domain/analysis/fibLevels';
import {
    computeStandardPivot,
    computeCamarillaPivot,
} from '@/domain/analysis/pivotLevels';
import {
    efficiencyRatio,
    classifyEmaStack,
    classifySwingStructure,
} from '@/domain/analysis/trendStructure';
import { calculateVolumeProfile } from '@/domain/indicators/volume-profile';

const EFFICIENCY_PERIOD = 20;
const MIN_EFFICIENCY_PERIOD = 2;
const RATIO_TO_PERCENT = 100;

const refLevel = (
    price: number,
    label: string,
    kind: ReferenceLevel['kind'],
    currentPrice: number
): ReferenceLevel => ({
    price,
    label,
    kind,
    distancePercent: ((price - currentPrice) / currentPrice) * RATIO_TO_PERCENT,
});

const lastFiniteNum = (arr: readonly (number | null)[]): number | null => {
    for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i] != null && Number.isFinite(arr[i] as number))
            return arr[i] as number;
    }
    return null;
};

const priceVs = (
    price: number,
    level: number | null
): 'above' | 'below' | 'unknown' =>
    level == null ? 'unknown' : price >= level ? 'above' : 'below';

function buildStructure(
    window: Bar[],
    indicators: IndicatorResult,
    currentPrice: number,
    windowSwingHighs: readonly SMCSwingPoint[],
    windowSwingLows: readonly SMCSwingPoint[]
): TrendStructure {
    const closes = window.map(b => b.close);
    const er = efficiencyRatio(
        closes,
        Math.min(
            EFFICIENCY_PERIOD,
            Math.max(MIN_EFFICIENCY_PERIOD, closes.length - 1)
        )
    );
    const ema9 = lastFiniteNum(indicators.ema[9] ?? []);
    const ema20 = lastFiniteNum(indicators.ema[20] ?? []);
    const ma50 = lastFiniteNum(indicators.ma[50] ?? indicators.ma[60] ?? []);
    const ma200 = lastFiniteNum(indicators.ma[200] ?? indicators.ma[120] ?? []);
    const adx = lastFiniteNum(indicators.dmi.map(d => d.adx));
    const trending =
        (adx != null && adx >= ADX_TRENDING_THRESHOLD) ||
        (er != null && er >= EFFICIENCY_RATIO_TRENDING_THRESHOLD);
    return {
        priceVsMA50: priceVs(currentPrice, ma50),
        priceVsMA200: priceVs(currentPrice, ma200),
        emaStack:
            ema9 != null && ema20 != null
                ? classifyEmaStack(currentPrice, ema9, ema20)
                : 'mixed',
        swingStructure: classifySwingStructure(
            windowSwingHighs.map(s => s.price),
            windowSwingLows.map(s => s.price)
        ),
        adx,
        efficiencyRatio: er,
        regime: trending ? 'trending' : 'ranging',
    };
}

function buildHorizon(
    bars: Bar[],
    indicators: IndicatorResult,
    key: HorizonKey,
    windowBars: number
): HorizonReference {
    const windowLen = Math.min(windowBars, bars.length);
    const window = windowLen > 0 ? bars.slice(bars.length - windowLen) : [];
    const startIndex = bars.length - windowLen;
    const currentPrice =
        window.length > 0 ? window[window.length - 1].close : 0;

    const windowSwingHighs = indicators.smc.swingHighs.filter(
        s => s.index >= startIndex
    );
    const windowSwingLows = indicators.smc.swingLows.filter(
        s => s.index >= startIndex
    );
    const windowVp = window.length > 0 ? calculateVolumeProfile(window) : null;
    const periods = HORIZON_MA_PERIODS[key];

    const levels: ReferenceLevel[] = [
        ...collectIndicatorLevels(currentPrice, indicators, {
            volumeProfile: windowVp,
            maPeriods: periods.ma,
            emaPeriods: periods.ema,
        }),
        ...roundNumberLevels(currentPrice),
    ];

    const windowSmc = {
        ...indicators.smc,
        swingHighs: windowSwingHighs,
        swingLows: windowSwingLows,
    };
    const fib = computeFibonacciProjection(windowSmc);
    if (fib) {
        for (const r of fib.retracements)
            levels.push(
                refLevel(
                    r.price,
                    `Fib ${(r.ratio * RATIO_TO_PERCENT).toFixed(1)}%`,
                    'fib_retracement',
                    currentPrice
                )
            );
        for (const e of fib.extensions)
            levels.push(
                refLevel(
                    e.price,
                    `Fib ext ${(e.ratio * RATIO_TO_PERCENT).toFixed(1)}%`,
                    'fib_extension',
                    currentPrice
                )
            );
    }
    const priorBar = window.length >= 2 ? window[window.length - 2] : null;
    if (priorBar) {
        const sp = computeStandardPivot(priorBar);
        if (sp)
            for (const [k, v] of Object.entries(sp))
                levels.push(
                    refLevel(
                        v,
                        `Pivot ${k.toUpperCase()}`,
                        'pivot_standard',
                        currentPrice
                    )
                );
        const cam = computeCamarillaPivot(priorBar);
        if (cam)
            for (const k of ['r4', 'r3', 's3', 's4'] as const)
                levels.push(
                    refLevel(
                        cam[k],
                        `Camarilla ${k.toUpperCase()}`,
                        'pivot_camarilla',
                        currentPrice
                    )
                );
    }
    for (const s of windowSwingHighs)
        levels.push(
            refLevel(s.price, 'Swing high', 'swing_high', currentPrice)
        );
    for (const s of windowSwingLows)
        levels.push(refLevel(s.price, 'Swing low', 'swing_low', currentPrice));

    return {
        window: {
            bars: window.length,
            fromTime: window[0]?.time ?? null,
            toTime: window[window.length - 1]?.time ?? null,
        },
        levels:
            currentPrice > 0
                ? splitBySide(levels, currentPrice)
                : { support: [], resistance: [] },
        structure: buildStructure(
            window,
            indicators,
            currentPrice,
            windowSwingHighs,
            windowSwingLows
        ),
    };
}

/**
 * Assemble a deterministic multi-horizon advisory reference from precomputed
 * indicators and bars. Each horizon (short / medium / long) uses a trailing
 * window sized per timeframe (capped at `bars.length`) and surfaces a
 * horizon-specific set of moving averages, recomputing levels and trend
 * structure over its own lookback window. Advisory context only — never a
 * directional prediction.
 *
 * @param bars - OHLCV bars, oldest-first.
 * @param indicators - Precomputed indicator suite aligned with `bars`.
 * @param timeframe - Bar resolution driving per-horizon window sizing.
 * @returns The short/medium/long horizon references.
 */
export function computeMarketReference(
    bars: Bar[],
    indicators: IndicatorResult,
    timeframe: Timeframe
): MarketReference {
    const w = HORIZON_WINDOWS_BY_TIMEFRAME[timeframe];
    const horizon = (key: HorizonKey): HorizonReference =>
        buildHorizon(bars, indicators, key, w[key]);
    return {
        short: horizon('short'),
        medium: horizon('medium'),
        long: horizon('long'),
    };
}
