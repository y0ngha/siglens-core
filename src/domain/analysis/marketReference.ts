import type {
    AssetClass,
    Bar,
    CamarillaPivotLevels,
    CurrencyCode,
    HorizonKey,
    HorizonReference,
    IndicatorResult,
    MarketReference,
    PriceVsLevel,
    ReferenceLevel,
    SMCSwingPoint,
    StandardPivotLevels,
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
    AT_PRICE_BAR_RANGE_FRACTION,
    collectIndicatorLevels,
    splitBySide,
    roundNumberLevels,
    makeReferenceLevel,
    lastFiniteNumber,
    meanBarRangePercent,
} from '@/domain/analysis/referenceLevels';
import { hasUsablePrices } from '@/domain/analysis/analysisUtils';
import { etCalendarDate } from '@/domain/marketCalendar';
import { anchoredVwap } from '@/domain/analysis/anchoredVwap';
import {
    computeFibonacciProjection,
    computeAbcExtension,
} from '@/domain/analysis/fibLevels';
import {
    computeStandardPivot,
    computeCamarillaPivot,
    computeFibonacciPivot,
    computeWoodiePivot,
    computeDeMarkPivot,
    STANDARD_PIVOT_KEYS,
    CAMARILLA_LEVEL_KEYS,
} from '@/domain/analysis/pivotLevels';
import {
    efficiencyRatio,
    classifyEmaStack,
    classifySwingStructure,
} from '@/domain/analysis/trendStructure';
import {
    KST_OFFSET_HOURS,
    MS_PER_SECOND,
    SECONDS_PER_DAY,
    SECONDS_PER_HOUR,
} from '@/domain/constants/time';
import { calculateVolumeProfile } from '@/domain/indicators/volume-profile';
import { findLastIndex } from '@/domain/arrayCompat';

const EFFICIENCY_PERIOD = 20;

/** Maps a bar to a key shared by every bar of the same trading session. */
type SessionKey = (bar: Bar) => number;

const DATE_KEY_YEAR_FACTOR = 10_000;
const DATE_KEY_MONTH_FACTOR = 100;

/** Crypto trades a UTC day. */
const utcSessionDay: SessionKey = bar => Math.floor(bar.time / SECONDS_PER_DAY);

/** KRX sessions (09:00–15:30 KST) fall inside one KST calendar date. */
const kstSessionDay: SessionKey = bar =>
    Math.floor(
        (bar.time + KST_OFFSET_HOURS * SECONDS_PER_HOUR) / SECONDS_PER_DAY
    );

/**
 * U.S. sessions fall inside one **Eastern** calendar date. A UTC date split them: after-hours
 * bars run to 20:00 ET, which is 00:00–01:00 UTC the next day, so a chart that includes
 * extended hours had the evening tail of one session counted into the next.
 */
const etSessionDay: SessionKey = bar => {
    const { year, month, day } = etCalendarDate(
        new Date(bar.time * MS_PER_SECOND)
    );
    return year * DATE_KEY_YEAR_FACTOR + month * DATE_KEY_MONTH_FACTOR + day;
};

/** The session calendar of the listing: supplied, never inferred from the symbol. */
const sessionKeyFor = (
    assetClass: AssetClass,
    currency: CurrencyCode
): SessionKey => {
    if (assetClass === 'crypto') return utcSessionDay;
    return currency === 'KRW' ? kstSessionDay : etSessionDay;
};

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
 *
 * Bars without usable prices are left out of the aggregate: one NaN high made the session
 * high NaN, every pivot NaN, and every pivot level then fell out of both sides silently.
 */
function pivotSourceBar(
    bars: readonly Bar[],
    timeframe: Timeframe,
    sessionKey: SessionKey
): Bar | null {
    if (bars.length < 2) return null;
    if (timeframe === '1Day') {
        const prior = bars[bars.length - 2];
        return hasUsablePrices(prior) ? prior : null;
    }

    const lastDay = sessionKey(bars[bars.length - 1]);
    const priorEnd = findLastIndex(bars, b => sessionKey(b) !== lastDay);
    if (priorEnd < 0) return null;
    const priorDay = sessionKey(bars[priorEnd]);
    const priorStart =
        findLastIndex(
            bars,
            (b, i) => i < priorEnd && sessionKey(b) !== priorDay
        ) + 1;
    const session = bars
        .slice(priorStart, priorEnd + 1)
        .filter(hasUsablePrices);
    if (session.length === 0) return null;
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

/**
 * @internal `0.618` → `61.8%`, `1.0` → `100%` (no trailing `.0`) — the one
 * ratio label format shared by the `Fib …%` level rows and the prompt's
 * `Fib table:`/`Fib ABC table:` lines, so all three always read alike.
 */
export const formatFibRatio = (ratio: number): string => {
    const text = (ratio * RATIO_TO_PERCENT).toFixed(FIB_RATIO_DECIMAL_PLACES);
    return `${text.endsWith('.0') ? text.slice(0, -2) : text}%`;
};

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
    standardPivot: StandardPivotLevels | null,
    camarillaPivot: CamarillaPivotLevels | null,
    atPriceBandPercent: number
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
                      `Fib ${formatFibRatio(r.ratio)}`,
                      'fib_retracement',
                      currentPrice
                  )
              ),
              ...fib.extensions.map(e =>
                  makeReferenceLevel(
                      e.price,
                      `Fib ext ${formatFibRatio(e.ratio)}`,
                      'fib_extension',
                      currentPrice
                  )
              ),
          ]
        : [];

    // ABC extension — a separate, longer-tail swing triplet from the same
    // window (spec 2026-09-18 §A3): only renders once a real retracement
    // swing (C) has confirmed after B, so it is `null` far more often than
    // `fib` above.
    const abc = computeAbcExtension(windowSmc);
    const abcExtensionLevels: ReferenceLevel[] = abc
        ? abc.extensions.map(e =>
              makeReferenceLevel(
                  e.price,
                  `Fib ABC ext ${formatFibRatio(e.ratio)}`,
                  'fib_abc_extension',
                  currentPrice
              )
          )
        : [];

    const standardPivotLevels: ReferenceLevel[] = standardPivot
        ? STANDARD_PIVOT_KEYS.map(k =>
              makeReferenceLevel(
                  standardPivot[k],
                  `Pivot ${k.toUpperCase()}`,
                  'pivot_standard',
                  currentPrice
              )
          )
        : [];
    const camarillaLevels: ReferenceLevel[] = camarillaPivot
        ? CAMARILLA_LEVEL_KEYS.map(k =>
              makeReferenceLevel(
                  camarillaPivot[k],
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

    // Fibonacci/Woodie/DeMark pivots (spec 2026-09-18) live ONLY
    // in the `Pivot table:` line, not in this capped nearest-level list —
    // `splitBySide`'s ~6/side cap meant Standard/Camarilla (the levels
    // traders actually watch) were competing with, and sometimes losing to,
    // three more pivot families for the same handful of slots.
    const levels: ReferenceLevel[] = [
        ...collectIndicatorLevels(currentPrice, indicators, {
            volumeProfile: windowVp,
            maPeriods: periods.ma,
            emaPeriods: periods.ema,
        }),
        ...roundNumberLevels(currentPrice),
        ...fibLevels,
        ...abcExtensionLevels,
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
                ? splitBySide(levels, currentPrice, atPriceBandPercent)
                : { support: [], resistance: [] },
        structure: buildStructure(
            barWindow,
            indicators,
            currentPrice,
            windowSwingHighs,
            windowSwingLows
        ),
        fibProjection: fib,
        abcExtension: abc,
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
 * Levels closer to the price than half the recent mean bar range are flagged `atPrice` and
 * kept outside the per-side cap (see `splitBySide`).
 *
 * @param bars - OHLCV bars, oldest-first.
 * @param indicators - Precomputed indicator suite aligned with `bars`.
 * @param timeframe - Bar resolution driving per-horizon window sizing.
 * @param options - Listing facts that pick the pivot session calendar: crypto uses the UTC
 *   day, a `KRW` listing the KST date, anything else the U.S. Eastern date. Defaults to a
 *   USD equity.
 * @returns The short/medium/long horizon references.
 */
export function computeMarketReference(
    bars: Bar[],
    indicators: IndicatorResult,
    timeframe: Timeframe,
    options: { assetClass?: AssetClass; currency?: CurrencyCode } = {}
): MarketReference {
    const w = HORIZON_WINDOWS_BY_TIMEFRAME[timeframe];
    const pivotBar = pivotSourceBar(
        bars,
        timeframe,
        sessionKeyFor(options.assetClass ?? 'equity', options.currency ?? 'USD')
    );
    // Computed once and shared by every horizon plus `pivots` below — pivotBar is the
    // same prior-session bar regardless of horizon, so this used to be recomputed 4x.
    const standardPivot = pivotBar ? computeStandardPivot(pivotBar) : null;
    const camarillaPivot = pivotBar ? computeCamarillaPivot(pivotBar) : null;
    const atPriceBandPercent =
        meanBarRangePercent(bars) * AT_PRICE_BAR_RANGE_FRACTION;
    const horizon = (key: HorizonKey): HorizonReference =>
        buildHorizon(
            bars,
            indicators,
            key,
            w[key],
            standardPivot,
            camarillaPivot,
            atPriceBandPercent
        );
    return {
        short: horizon('short'),
        medium: horizon('medium'),
        long: horizon('long'),
        pivots: {
            standard: standardPivot,
            camarilla: camarillaPivot,
            fibonacci: pivotBar ? computeFibonacciPivot(pivotBar) : null,
            woodie: pivotBar ? computeWoodiePivot(pivotBar) : null,
            demark: pivotBar ? computeDeMarkPivot(pivotBar) : null,
        },
    };
}
