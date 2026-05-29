import type {
    Bar,
    BollingerResult,
    IndicatorResult,
    Signal,
} from '@/domain/types';
import {
    DIVERGENCE_FRESHNESS_BARS,
    DIVERGENCE_LOOKBACK_BARS,
    HISTOGRAM_CONVERGENCE_BARS,
    PIVOT_WINDOW,
    SQUEEZE_LOOKBACK_BARS,
    SQUEEZE_PCT_B_THRESHOLD,
    SQUEEZE_PERCENTILE,
    SR_APPROACH_LOOKBACK,
    SR_MA_PERIODS,
    SR_PROXIMITY_PCT,
    TREND_EMA_PERIOD,
    TREND_SLOPE_LOOKBACK,
} from '@/domain/signals/constants';
import { calculateMA } from '@/domain/indicators/ma';

type DivergenceKind = 'bullish' | 'bearish';

function findPivots(
    values: number[],
    window: number,
    compare: (cur: number, neighbor: number) => boolean
): number[] {
    const neighborOffsets = Array.from({ length: window }, (_, k) => k + 1);
    return values
        .slice(window, values.length - window)
        .flatMap((cur, localIdx) => {
            const i = localIdx + window;
            const isPivot = neighborOffsets.every(
                k => compare(cur, values[i - k]) && compare(cur, values[i + k])
            );
            return isPivot ? [i] : [];
        });
}

/** @internal Indices of pivot lows within a rolling window (divergence helper). */
export function findPivotLows(lows: number[], window: number): number[] {
    return findPivots(lows, window, (cur, n) => cur < n);
}

/** @internal Indices of pivot highs within a rolling window (divergence helper). */
export function findPivotHighs(highs: number[], window: number): number[] {
    return findPivots(highs, window, (cur, n) => cur > n);
}

/** @internal Bollinger band width ratio ((upper-lower)/middle). */
export function computeBbWidth(bb: BollingerResult): number | null {
    if (bb.upper === null || bb.middle === null || bb.lower === null)
        return null;
    if (bb.middle === 0) return null;
    return (bb.upper - bb.lower) / bb.middle;
}

/** @internal Bollinger %B position of close within the bands. */
export function computePctB(close: number, bb: BollingerResult): number | null {
    if (bb.upper === null || bb.lower === null) return null;
    const denom = bb.upper - bb.lower;
    if (denom === 0) return null;
    return (close - bb.lower) / denom;
}

/** @internal Relative EMA slope over a lookback window. */
export function computeEmaSlope(
    ema: (number | null)[],
    lookback: number
): number | null {
    if (ema.length < lookback + 1) return null;
    const last = ema[ema.length - 1];
    const prev = ema[ema.length - 1 - lookback];
    if (last === null || prev === null || prev === 0) return null;
    return (last - prev) / prev;
}

/** @internal Rank-based percentile (0..1) used by squeeze detection. */
// 표준 mean-rank 아닌 rank-based — squeeze 감지에서 min→0, max→1이 되도록 설계.
export function percentileRank(value: number, xs: number[]): number | null {
    const n = xs.length;
    if (n === 0) return null;
    if (n === 1) {
        if (value === xs[0]) return 0.5;
        return value > xs[0] ? 1 : 0;
    }
    const { below, equal } = xs.reduce(
        (acc, x) => ({
            below: acc.below + (x < value ? 1 : 0),
            equal: acc.equal + (x === value ? 1 : 0),
        }),
        { below: 0, equal: 0 }
    );
    // all-equal degenerate case — 분산 0에서 min/max 오분류 방지.
    if (equal === n) return 0.5;
    if (equal === 0) {
        return below / n;
    }
    return below / (n - 1);
}

function detectRegularDivergence(
    bars: Bar[],
    rsi: (number | null)[],
    kind: DivergenceKind
): number | null {
    if (bars.length < DIVERGENCE_LOOKBACK_BARS) return null;
    const windowStart = bars.length - DIVERGENCE_LOOKBACK_BARS;
    const lastIdx = bars.length - 1;

    const series =
        kind === 'bullish'
            ? bars.slice(windowStart).map(b => b.low)
            : bars.slice(windowStart).map(b => b.high);
    const pivotsLocal =
        kind === 'bullish'
            ? findPivotLows(series, PIVOT_WINDOW)
            : findPivotHighs(series, PIVOT_WINDOW);

    if (pivotsLocal.length < 2) return null;

    // Convert local-window indices back to absolute indices
    const pivots = pivotsLocal.map(i => i + windowStart);
    const pivotsLen = pivots.length;
    const p1 = pivots[pivotsLen - 2];
    const p2 = pivots[pivotsLen - 1];

    // Freshness: second pivot must be within last N bars
    if (lastIdx - p2 > DIVERGENCE_FRESHNESS_BARS) return null;

    const price1 = kind === 'bullish' ? bars[p1].low : bars[p1].high;
    const price2 = kind === 'bullish' ? bars[p2].low : bars[p2].high;
    const rsi1 = rsi[p1];
    const rsi2 = rsi[p2];
    if (rsi1 == null || rsi2 == null) {
        return null;
    }

    if (kind === 'bullish') {
        // Regular: price lower low, rsi higher low
        if (price2 >= price1) return null;
        if (rsi2 <= rsi1) return null;
    } else {
        // Regular: price higher high, rsi lower high
        if (price2 <= price1) return null;
        if (rsi2 >= rsi1) return null;
    }
    return p2;
}

/** @internal Detects regular bullish RSI divergence (anticipation signal). */
export function detectRsiBullishDivergence(
    bars: Bar[],
    indicators: IndicatorResult
): Signal | null {
    const idx = detectRegularDivergence(bars, indicators.rsi, 'bullish');
    if (idx === null) return null;
    return {
        type: 'rsi_bullish_divergence',
        direction: 'bullish',
        phase: 'expected',
        detectedAt: idx,
    };
}

/** @internal Detects regular bearish RSI divergence (anticipation signal). */
export function detectRsiBearishDivergence(
    bars: Bar[],
    indicators: IndicatorResult
): Signal | null {
    const idx = detectRegularDivergence(bars, indicators.rsi, 'bearish');
    if (idx === null) return null;
    return {
        type: 'rsi_bearish_divergence',
        direction: 'bearish',
        phase: 'expected',
        detectedAt: idx,
    };
}

/** @internal Detects narrowing negative MACD histogram (bullish anticipation signal). */
export function detectMacdHistogramBullishConvergence(
    _bars: Bar[],
    indicators: IndicatorResult
): Signal | null {
    const macd = indicators.macd;
    if (macd.length < HISTOGRAM_CONVERGENCE_BARS) return null;
    const tail = macd.slice(-HISTOGRAM_CONVERGENCE_BARS);
    for (const p of tail) {
        if (p.histogram === null || !(p.histogram < 0)) return null;
    }
    for (let i = 1; i < HISTOGRAM_CONVERGENCE_BARS; i++) {
        // Non-null asserted: prior loop guarantees histogram !== null for all tail elements.
        const prev = tail[i - 1]!.histogram!;
        const cur = tail[i]!.histogram!;
        // magnitude strictly decreasing (absolute value)
        if (!(Math.abs(cur) < Math.abs(prev))) return null;
    }
    return {
        type: 'macd_histogram_bullish_convergence',
        direction: 'bullish',
        phase: 'expected',
        detectedAt: macd.length - 1,
    };
}

/** @internal Detects narrowing positive MACD histogram (bearish anticipation signal). */
export function detectMacdHistogramBearishConvergence(
    _bars: Bar[],
    indicators: IndicatorResult
): Signal | null {
    const macd = indicators.macd;
    if (macd.length < HISTOGRAM_CONVERGENCE_BARS) return null;
    const tail = macd.slice(-HISTOGRAM_CONVERGENCE_BARS);
    for (const p of tail) {
        if (p.histogram === null || !(p.histogram > 0)) return null;
    }
    for (let i = 1; i < HISTOGRAM_CONVERGENCE_BARS; i++) {
        // Non-null asserted: prior loop guarantees histogram !== null for all tail elements.
        const prev = tail[i - 1]!.histogram!;
        const cur = tail[i]!.histogram!;
        if (!(Math.abs(cur) < Math.abs(prev))) return null;
    }
    return {
        type: 'macd_histogram_bearish_convergence',
        direction: 'bearish',
        phase: 'expected',
        detectedAt: macd.length - 1,
    };
}

function computeSqueezeState(
    bars: Bar[],
    indicators: IndicatorResult
): { lastIdx: number; pctB: number; slope: number } | null {
    const bb = indicators.bollinger;
    const bbLength = bb.length;
    if (bbLength < SQUEEZE_LOOKBACK_BARS) return null;
    if (bars.length !== bbLength) return null;
    const lastIdx = bbLength - 1;
    const lastBB = bb[lastIdx];
    const widthLast = computeBbWidth(lastBB);
    if (widthLast === null) return null;

    // Exclude lastIdx from slice — widthLast already computed above and appended at end
    const widths = [
        ...bb
            .slice(lastIdx - SQUEEZE_LOOKBACK_BARS + 1, lastIdx)
            .map(computeBbWidth)
            .filter((w): w is number => w !== null),
        widthLast,
    ];
    const rank = percentileRank(widthLast, widths);
    if (rank === null || rank > SQUEEZE_PERCENTILE) return null;

    const pctB = computePctB(bars[lastIdx].close, lastBB);
    if (pctB === null) return null;

    const ema20 = indicators.ema[TREND_EMA_PERIOD];
    if (ema20 === undefined) return null;
    const slope = computeEmaSlope(ema20, TREND_SLOPE_LOOKBACK);
    if (slope === null) return null;

    return { lastIdx, pctB, slope };
}

/** @internal Detects a Bollinger squeeze with bullish bias (anticipation signal). */
export function detectBollingerSqueezeBullish(
    bars: Bar[],
    indicators: IndicatorResult
): Signal | null {
    const s = computeSqueezeState(bars, indicators);
    if (s === null) return null;
    if (s.pctB < SQUEEZE_PCT_B_THRESHOLD) return null;
    if (s.slope < 0) return null;
    return {
        type: 'bollinger_squeeze_bullish',
        direction: 'bullish',
        phase: 'expected',
        detectedAt: s.lastIdx,
    };
}

/** @internal Detects a Bollinger squeeze with bearish bias (anticipation signal). */
export function detectBollingerSqueezeBearish(
    bars: Bar[],
    indicators: IndicatorResult
): Signal | null {
    const s = computeSqueezeState(bars, indicators);
    if (s === null) return null;
    if (s.pctB >= SQUEEZE_PCT_B_THRESHOLD) return null;
    if (s.slope > 0) return null;
    return {
        type: 'bollinger_squeeze_bearish',
        direction: 'bearish',
        phase: 'expected',
        detectedAt: s.lastIdx,
    };
}

function isWithinProximity(
    close: number,
    ma: number,
    side: 'above' | 'below'
): boolean {
    if (ma === 0) return false;
    const distance = Math.abs(close - ma) / ma;
    if (distance > SR_PROXIMITY_PCT) return false;
    if (side === 'above') return close > ma;
    return close < ma;
}

/** @internal Detects price falling into support-MA proximity (bullish anticipation signal). */
export function detectSupportProximityBullish(
    bars: Bar[],
    indicators: IndicatorResult
): Signal | null {
    const barsLength = bars.length;
    if (barsLength < SR_APPROACH_LOOKBACK + 1) return null;
    const lastIdx = barsLength - 1;
    const closeLast = bars[lastIdx].close;
    const closePrev5 = bars[lastIdx - SR_APPROACH_LOOKBACK].close;
    if (!(closeLast < closePrev5)) return null; // must be falling

    for (const period of SR_MA_PERIODS) {
        if (barsLength < period) continue;
        // calculateMA: non-null at lastIdx when bars.length >= period (checked above).
        // indicators.ma[period]: assumed same length as bars — caller contract.
        const ma = (indicators.ma[period] ?? calculateMA(bars, period))[
            lastIdx
        ]!;
        if (isWithinProximity(closeLast, ma, 'above')) {
            return {
                type: 'support_proximity_bullish',
                direction: 'bullish',
                phase: 'expected',
                detectedAt: lastIdx,
            };
        }
    }
    return null;
}

/** @internal Detects price rising into resistance-MA proximity (bearish anticipation signal). */
export function detectResistanceProximityBearish(
    bars: Bar[],
    indicators: IndicatorResult
): Signal | null {
    const barsLength = bars.length;
    if (barsLength < SR_APPROACH_LOOKBACK + 1) return null;
    const lastIdx = barsLength - 1;
    const closeLast = bars[lastIdx].close;
    const closePrev5 = bars[lastIdx - SR_APPROACH_LOOKBACK].close;
    if (!(closeLast > closePrev5)) return null; // must be rising

    for (const period of SR_MA_PERIODS) {
        if (barsLength < period) continue;
        // calculateMA: non-null at lastIdx when bars.length >= period (checked above).
        // indicators.ma[period]: assumed same length as bars — caller contract.
        const ma = (indicators.ma[period] ?? calculateMA(bars, period))[
            lastIdx
        ]!;
        if (isWithinProximity(closeLast, ma, 'below')) {
            return {
                type: 'resistance_proximity_bearish',
                direction: 'bearish',
                phase: 'expected',
                detectedAt: lastIdx,
            };
        }
    }
    return null;
}
