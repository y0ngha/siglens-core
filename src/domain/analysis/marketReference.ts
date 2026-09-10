import type {
    Bar,
    HorizonKey,
    HorizonReference,
    IndicatorResult,
    MarketReference,
    PriceVsLevel,
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
    EMA_STACK_SHORT_PERIOD,
    EMA_STACK_LONG_PERIOD,
    TREND_STRUCTURE_MA_MEDIUM_PERIOD,
    TREND_STRUCTURE_MA_LONG_PERIOD,
} from '@/domain/analysis/marketReferenceConstants';
import {
    collectIndicatorLevels,
    splitBySide,
    roundNumberLevels,
    makeReferenceLevel,
    lastFiniteNumber,
} from '@/domain/analysis/referenceLevels';
import { anchoredVwap } from '@/domain/analysis/anchoredVwap';
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
import { SECONDS_PER_DAY } from '@/domain/constants/time';

const EFFICIENCY_PERIOD = 20;

/**
 * UTC calendar day of a bar. U.S. regular hours (13:30–21:00 UTC), KRX (00:00–06:30 UTC)
 * and the crypto UTC day each fall inside a single UTC date, so the date is a session key.
 */
const utcDay = (bar: Bar): number => Math.floor(bar.time / SECONDS_PER_DAY);

/**
 * The bar floor pivots are computed from: the previous bar on a daily chart, the previous
 * **session** otherwise.
 *
 * Pivots used to come from the previous bar on every timeframe. Standard and Camarilla
 * pivots are defined on the prior session's high/low/close, and on an intraday chart the
 * previous bar is a sliver of that — its pivot point lands on top of the price (`Pivot PP
 * … 0.01% away` on hourly AAPL) and its "S3" can sit above the price. Those levels then
 * became the nearest support/resistance the prompt handed to the model for stops.
 * Aggregating the prior session's bars restores the levels traders actually watch.
 */
function pivotSourceBar(
    bars: readonly Bar[],
    timeframe: Timeframe
): Bar | null {
    if (bars.length < 2) return null;
    if (timeframe === '1Day') return bars[bars.length - 2];

    const lastDay = utcDay(bars[bars.length - 1]);
    const priorEnd = bars.findLastIndex(b => utcDay(b) !== lastDay);
    if (priorEnd < 0) return null;
    const priorDay = utcDay(bars[priorEnd]);
    const priorStart =
        bars.findLastIndex((b, i) => i < priorEnd && utcDay(b) !== priorDay) +
        1;
    const session = bars.slice(priorStart, priorEnd + 1);
    return {
        time: session[0].time,
        open: session[0].open,
        high: Math.max(...session.map(b => b.high)),
        low: Math.min(...session.map(b => b.low)),
        close: session[session.length - 1].close,
        volume: session.reduce((sum, b) => sum + b.volume, 0),
    };
}
const MIN_EFFICIENCY_PERIOD = 2;
const FIB_RATIO_DECIMAL_PLACES = 1;

// `price === level` resolves to 'above' (tie-breaking — PriceVsLevel has no 'at').
const priceVs = (price: number, level: number | null): PriceVsLevel =>
    level == null ? 'unknown' : price >= level ? 'above' : 'below';

/**
 * Anchored-VWAP reference level for one anchor swing (0 or 1 levels): empty when
 * there is no anchor or the AVWAP is undefined for the anchored range.
 */
function resolveAvwapLevel(
    bars: Bar[],
    swing: SMCSwingPoint | null,
    label: string,
    currentPrice: number
): ReferenceLevel[] {
    if (swing === null) return [];
    const value = anchoredVwap(bars, swing.index);
    return value != null
        ? [makeReferenceLevel(value, label, 'avwap', currentPrice)]
        : [];
}

// ema/ma/adx read their latest value from the GLOBAL `indicators` (full-history
// series — e.g. MA200 needs the full lookback, so a per-window recompute would be
// wrong), so priceVsMA60/priceVsMA200/emaStack/adx are identical across horizons.
// Only swingStructure (window-filtered swings) and efficiencyRatio differ per horizon.
function buildStructure(
    barWindow: Bar[],
    indicators: IndicatorResult,
    currentPrice: number,
    windowSwingHighs: readonly SMCSwingPoint[],
    windowSwingLows: readonly SMCSwingPoint[]
): TrendStructure {
    const closes = barWindow.map(b => b.close);
    const er = efficiencyRatio(
        closes,
        Math.min(
            EFFICIENCY_PERIOD,
            Math.max(MIN_EFFICIENCY_PERIOD, closes.length - 1)
        )
    );
    const ema9 = lastFiniteNumber(indicators.ema[EMA_STACK_SHORT_PERIOD] ?? []);
    const ema20 = lastFiniteNumber(indicators.ema[EMA_STACK_LONG_PERIOD] ?? []);
    const ma60 = lastFiniteNumber(
        indicators.ma[TREND_STRUCTURE_MA_MEDIUM_PERIOD] ?? []
    );
    const ma200 = lastFiniteNumber(
        indicators.ma[TREND_STRUCTURE_MA_LONG_PERIOD] ?? []
    );
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
    windowBars: number,
    pivotBar: Bar | null
): HorizonReference {
    const barsLen = bars.length;
    const windowLen = Math.min(windowBars, barsLen);
    const barWindow = windowLen > 0 ? bars.slice(barsLen - windowLen) : [];
    const startIndex = barsLen - windowLen;
    const lastBar = windowLen > 0 ? barWindow[windowLen - 1] : null;
    const currentPrice = lastBar?.close ?? 0;

    const windowSwingHighs = indicators.smc.swingHighs.filter(
        s => s.index >= startIndex
    );
    const windowSwingLows = indicators.smc.swingLows.filter(
        s => s.index >= startIndex
    );
    const windowVp = windowLen > 0 ? calculateVolumeProfile(barWindow) : null;
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

    const sp = pivotBar ? computeStandardPivot(pivotBar) : null;
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
    const cam = pivotBar ? computeCamarillaPivot(pivotBar) : null;
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

    // Anchor AVWAP to the window's most significant (price-extreme) swings:
    // the highest-priced swing high and the lowest-priced swing low.
    const anchorHigh =
        windowSwingHighs.length > 0
            ? windowSwingHighs.reduce((a, b) => (b.price > a.price ? b : a))
            : null;
    const anchorLow =
        windowSwingLows.length > 0
            ? windowSwingLows.reduce((a, b) => (b.price < a.price ? b : a))
            : null;
    const avwapLevels: ReferenceLevel[] = [
        ...resolveAvwapLevel(
            bars,
            anchorHigh,
            'AVWAP (swing high)',
            currentPrice
        ),
        ...resolveAvwapLevel(
            bars,
            anchorLow,
            'AVWAP (swing low)',
            currentPrice
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
        ...avwapLevels,
    ];

    return {
        window: {
            bars: windowLen,
            fromTime: barWindow[0]?.time ?? null,
            toTime: lastBar?.time ?? null,
        },
        levels:
            currentPrice > 0
                ? splitBySide(levels, currentPrice)
                : { support: [], resistance: [] },
        structure: buildStructure(
            barWindow,
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
    const pivotBar = pivotSourceBar(bars, timeframe);
    const horizon = (key: HorizonKey): HorizonReference =>
        buildHorizon(bars, indicators, key, w[key], pivotBar);
    return {
        short: horizon('short'),
        medium: horizon('medium'),
        long: horizon('long'),
    };
}
