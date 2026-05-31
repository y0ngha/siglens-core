import type { Bar, IndicatorResult, Signal } from '@/domain/types';
import {
    detectBollingerLowerBounce,
    detectBollingerUpperBreakout,
    detectCciBearishCross,
    detectCciBullishCross,
    detectCmfBearishFlip,
    detectCmfBullishFlip,
    detectDeathCross,
    detectDmiBearishCross,
    detectDmiBullishCross,
    detectGoldenCross,
    detectIchimokuCloudBreakdown,
    detectIchimokuCloudBreakout,
    detectKeltnerLowerBreakout,
    detectKeltnerUpperBreakout,
    detectMacdBearishCross,
    detectMacdBullishCross,
    detectMfiOverboughtReversal,
    detectMfiOversoldBounce,
    detectParabolicSarBearishFlip,
    detectParabolicSarFlip,
    detectRsiOverbought,
    detectRsiOversold,
    detectSqueezeMomentumBearish,
    detectSqueezeMomentumBullish,
    detectSupertrendBearishFlip,
    detectSupertrendBullishFlip,
} from '@/domain/signals/confirmed';
import {
    detectBollingerSqueezeBearish,
    detectBollingerSqueezeBullish,
    detectMacdHistogramBearishConvergence,
    detectMacdHistogramBullishConvergence,
    detectResistanceProximityBearish,
    detectRsiBearishDivergence,
    detectRsiBullishDivergence,
    detectSupportProximityBullish,
} from '@/domain/signals/anticipation';

export { classifyTrend } from '@/domain/signals/trend';

type Detector = (bars: Bar[], indicators: IndicatorResult) => Signal | null;

const DETECTORS: readonly Detector[] = [
    detectRsiOversold,
    detectRsiOverbought,
    detectGoldenCross,
    detectDeathCross,
    detectMacdBullishCross,
    detectMacdBearishCross,
    detectBollingerLowerBounce,
    detectBollingerUpperBreakout,
    detectSupertrendBullishFlip,
    detectSupertrendBearishFlip,
    detectIchimokuCloudBreakout,
    detectIchimokuCloudBreakdown,
    detectCciBullishCross,
    detectCciBearishCross,
    detectDmiBullishCross,
    detectDmiBearishCross,
    detectCmfBullishFlip,
    detectCmfBearishFlip,
    detectMfiOversoldBounce,
    detectMfiOverboughtReversal,
    detectParabolicSarFlip,
    detectParabolicSarBearishFlip,
    detectKeltnerUpperBreakout,
    detectKeltnerLowerBreakout,
    detectSqueezeMomentumBullish,
    detectSqueezeMomentumBearish,
    detectRsiBullishDivergence,
    detectRsiBearishDivergence,
    detectMacdHistogramBullishConvergence,
    detectMacdHistogramBearishConvergence,
    detectBollingerSqueezeBullish,
    detectBollingerSqueezeBearish,
    detectSupportProximityBullish,
    detectResistanceProximityBearish,
];

/**
 * Run every bundled signal detector against bars + indicators and collect
 * the non-null results.
 *
 * Combines 26 confirmed-signal detectors — bullish/bearish mirror pairs for
 * RSI overbought / oversold, golden / death cross, MACD cross, Bollinger band
 * touches, Supertrend / Parabolic SAR flips, Ichimoku breakout / breakdown,
 * CCI / DMI / CMF crosses, MFI bounce / reversal, Keltner breakouts, and
 * squeeze momentum — with 8 anticipation-signal detectors (RSI / MACD
 * histogram divergences, Bollinger squeeze, support / resistance proximity,
 * etc.).
 *
 * @param bars - OHLCV bars sorted oldest-first.
 * @param indicators - Indicator suite produced by {@link calculateIndicators}.
 * @returns A read-only array of detected signals; empty when no detectors fire.
 *
 * @example
 * ```ts
 * const signals = detectSignals(bars, calculateIndicators(bars));
 * for (const s of signals) console.log(s.type, s.direction);
 * ```
 *
 * @see calculateIndicators
 * @see classifyTrend
 */
export function detectSignals(
    bars: Bar[],
    indicators: IndicatorResult
): readonly Signal[] {
    if (bars.length === 0) return [];
    return DETECTORS.map(d => d(bars, indicators)).filter(
        (s): s is Signal => s !== null
    );
}
