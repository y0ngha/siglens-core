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
    RATIO_TO_PERCENT,
} from '@/domain/analysis/marketReferenceConstants';
import {
    collectIndicatorLevels,
    splitBySide,
    roundNumberLevels,
    makeReferenceLevel,
    lastFiniteNumber,
} from '@/domain/analysis/referenceLevels';
import { computeFibonacciProjection } from '@/domain/analysis/fibLevels';
import {
    computeStandardPivot,
    computeCamarillaPivot,
    STANDARD_PIVOT_KEYS,
    CAMARILLA_LEVEL_KEYS,
} from '@/domain/analysis/pivotLevels';
import {
    efficiencyRatio,
    classifyEmaStack,
    classifySwingStructure,
} from '@/domain/analysis/trendStructure';
import { calculateVolumeProfile } from '@/domain/indicators/volume-profile';

const EFFICIENCY_PERIOD = 20;
const MIN_EFFICIENCY_PERIOD = 2;
const FIB_RATIO_DECIMAL_PLACES = 1;

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
    const ema9 = lastFiniteNumber(indicators.ema[9] ?? []);
    const ema20 = lastFiniteNumber(indicators.ema[20] ?? []);
    const ma60 = lastFiniteNumber(indicators.ma[60] ?? []);
    const ma200 = lastFiniteNumber(indicators.ma[200] ?? []);
    const adx = lastFiniteNumber(indicators.dmi.map(d => d.adx));
    const trending =
        (adx != null && adx >= ADX_TRENDING_THRESHOLD) ||
        (er != null && er >= EFFICIENCY_RATIO_TRENDING_THRESHOLD);
    return {
        priceVsMA60: priceVs(currentPrice, ma60),
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
    const barsLen = bars.length;
    const windowLen = Math.min(windowBars, barsLen);
    const window = windowLen > 0 ? bars.slice(barsLen - windowLen) : [];
    const startIndex = barsLen - windowLen;
    const currentPrice = windowLen > 0 ? window[windowLen - 1].close : 0;

    const windowSwingHighs = indicators.smc.swingHighs.filter(
        s => s.index >= startIndex
    );
    const windowSwingLows = indicators.smc.swingLows.filter(
        s => s.index >= startIndex
    );
    const windowVp = windowLen > 0 ? calculateVolumeProfile(window) : null;
    const periods = HORIZON_MA_PERIODS[key];

    const windowSmc = {
        ...indicators.smc,
        swingHighs: windowSwingHighs,
        swingLows: windowSwingLows,
    };
    const fib = computeFibonacciProjection(windowSmc);
    const fibLevels: ReferenceLevel[] = fib
        ? [
              ...fib.retracements.map(r =>
                  makeReferenceLevel(
                      r.price,
                      `Fib ${(r.ratio * RATIO_TO_PERCENT).toFixed(FIB_RATIO_DECIMAL_PLACES)}%`,
                      'fib_retracement',
                      currentPrice
                  )
              ),
              ...fib.extensions.map(e =>
                  makeReferenceLevel(
                      e.price,
                      `Fib ext ${(e.ratio * RATIO_TO_PERCENT).toFixed(FIB_RATIO_DECIMAL_PLACES)}%`,
                      'fib_extension',
                      currentPrice
                  )
              ),
          ]
        : [];

    const priorBar = windowLen >= 2 ? window[windowLen - 2] : null;
    const sp = priorBar ? computeStandardPivot(priorBar) : null;
    const standardPivotLevels: ReferenceLevel[] = sp
        ? STANDARD_PIVOT_KEYS.map(k =>
              makeReferenceLevel(
                  sp[k],
                  `Pivot ${k.toUpperCase()}`,
                  'pivot_standard',
                  currentPrice
              )
          )
        : [];
    const cam = priorBar ? computeCamarillaPivot(priorBar) : null;
    const camarillaLevels: ReferenceLevel[] = cam
        ? CAMARILLA_LEVEL_KEYS.map(k =>
              makeReferenceLevel(
                  cam[k],
                  `Camarilla ${k.toUpperCase()}`,
                  'pivot_camarilla',
                  currentPrice
              )
          )
        : [];

    const swingLevels: ReferenceLevel[] = [
        ...windowSwingHighs.map(s =>
            makeReferenceLevel(
                s.price,
                'Swing high',
                'swing_high',
                currentPrice
            )
        ),
        ...windowSwingLows.map(s =>
            makeReferenceLevel(s.price, 'Swing low', 'swing_low', currentPrice)
        ),
    ];

    const levels: ReferenceLevel[] = [
        ...collectIndicatorLevels(currentPrice, indicators, {
            volumeProfile: windowVp,
            maPeriods: periods.ma,
            emaPeriods: periods.ema,
        }),
        ...roundNumberLevels(currentPrice),
        ...fibLevels,
        ...standardPivotLevels,
        ...camarillaLevels,
        ...swingLevels,
    ];

    return {
        window: {
            bars: windowLen,
            fromTime: window[0]?.time ?? null,
            toTime: window[windowLen - 1]?.time ?? null,
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
