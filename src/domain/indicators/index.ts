import type { Bar, IndicatorResult } from '@/domain/types';
import { calculateRSI } from './rsi';
import { calculateMACD } from './macd';
import { calculateBollinger } from './bollinger';
import { calculateDMI } from './dmi';
import { calculateVWAP } from './vwap';
import { calculateEMA } from './ema';
import { calculateMA } from './ma';
import { calculateStochastic } from './stochastic';
import { calculateStochRSI } from './stochastic-rsi';
import { calculateCCI } from './cci';
import { calculateVolumeProfile } from './volume-profile';
import { calculateIchimoku } from './ichimoku';
import { calculateATR } from './atr';
import { calculateOBV } from './obv';
import { calculateParabolicSAR } from './parabolicSar';
import { calculateWilliamsR } from './williamsR';
import { calculateSupertrend } from './supertrend';
import { calculateMFI } from './mfi';
import { calculateKeltnerChannel } from './keltnerChannel';
import { calculateCMF } from './cmf';
import { calculateDonchianChannel } from './donchianChannel';
import { calculateBuySellVolume } from './buySellVolume';
import { calculateSmc } from './smc';
import { calculateSqueezeMomentum } from './squeezeMomentum';
import { calculateMacdV } from './macdV';
import { calculateConnorsRsi } from './connorsRsi';
import { calculateForceIndex } from './forceIndex';
import { calculateElderRay } from './elderRay';
import { calculateElderImpulse } from './elderImpulse';
import { calculateBollingerDerived } from './bollingerDerived';
import { calculateChandelierExit } from './chandelierExit';
import { calculateYangZhang } from './yangZhang';
import { calculateEwmaVolatility } from './ewmaVolatility';
import { calculateHurst } from './hurst';
import { calculateVarianceRatio } from './varianceRatio';
import { calculateRegression } from './regression';
import { EMA_DEFAULT_PERIODS, MA_DEFAULT_PERIODS } from './constants';

export * from './rsi';
export * from './macd';
export * from './bollinger';
export * from './dmi';
export * from './vwap';
export * from './ema';
export * from './ma';
export * from './stochastic';
export * from './stochastic-rsi';
export * from './cci';
export * from './volume-profile';
export * from './ichimoku';
export * from './atr';
export * from './obv';
export * from './parabolicSar';
export * from './williamsR';
export * from './supertrend';
export * from './mfi';
export * from './keltnerChannel';
export * from './cmf';
export * from './donchianChannel';
export * from './buySellVolume';
export * from './smc';
export * from './squeezeMomentum';
// Pro-indicator (Phase 1) calculation functions — wired into
// calculateIndicators / IndicatorResult below.
export * from './bollingerDerived';
export * from './chandelierExit';
export * from './connorsRsi';
export * from './elderImpulse';
export * from './elderRay';
export * from './ewmaVolatility';
export * from './forceIndex';
export * from './hurst';
export * from './macdV';
export * from './regression';
export * from './varianceRatio';
export * from './yangZhang';
export {
    computeFearGreedIndex,
    computeFearGreedHistory,
    FEAR_GREED_LABEL_CUTOFFS,
    scoreToLabel,
    POC_WINDOW_DEFAULT,
} from './fearGreed';
export {
    computeMarketFearGreedIndex,
    computeMarketFearGreedHistory,
    MARKET_FEAR_GREED_SERIES_KEYS,
    MARKET_FEAR_GREED_FACTOR_KEYS,
} from './marketFearGreed';
export {
    computeCryptoFearGreedIndex,
    computeCryptoFearGreedHistory,
    CRYPTO_FEAR_GREED_FACTOR_KEYS,
} from './cryptoFearGreed';
export * from './constants';
export * from './utils';

/**
 * Compute the full indicator suite for an array of OHLCV bars.
 *
 * Populates an {@link IndicatorResult} with every indicator the package
 * supports — RSI, MACD, Bollinger Bands, DMI, Stochastic, StochRSI, CCI,
 * VWAP, several MA / EMA periods, Volume Profile, Ichimoku, ATR, OBV,
 * Parabolic SAR, Williams %R, Supertrend, MFI, Keltner Channel, CMF,
 * Donchian Channel, buy / sell volume split, SMC structure, Squeeze
 * Momentum, plus the Phase 1 pro-indicators (MACD-V, Connors RSI, Force
 * Index, Elder-Ray, Elder Impulse, Bollinger %B / BandWidth, Chandelier
 * Exit, Yang-Zhang volatility, EWMA volatility, Hurst exponent, Variance
 * Ratio, and rolling linear regression).
 *
 * Bars must be in chronological order (oldest first). The function is pure
 * and does not mutate `bars`. Each indicator's warm-up period is filled
 * with `null` so callers can distinguish "not yet computed" from a real `0`.
 *
 * @param bars - OHLCV bars sorted oldest-first.
 * @returns Full indicator suite — see {@link IndicatorResult}.
 *
 * @example
 * ```ts
 * const indicators = calculateIndicators(bars);
 * const lastRsi = indicators.rsi.at(-1);
 * ```
 *
 * @see detectSignals
 */
export function calculateIndicators(bars: Bar[]): IndicatorResult {
    const closes = bars.map(b => b.close);
    return {
        rsi: calculateRSI(closes),
        macd: calculateMACD(bars),
        bollinger: calculateBollinger(bars),
        dmi: calculateDMI(bars),
        stochastic: calculateStochastic(bars),
        stochRsi: calculateStochRSI(closes),
        cci: calculateCCI(bars),
        vwap: calculateVWAP(bars),
        ma: Object.fromEntries(
            MA_DEFAULT_PERIODS.map(period => [
                period,
                calculateMA(bars, period),
            ])
        ) as Record<number, (number | null)[]>,
        ema: Object.fromEntries(
            EMA_DEFAULT_PERIODS.map(period => [
                period,
                calculateEMA(bars, period),
            ])
        ) as Record<number, (number | null)[]>,
        volumeProfile: calculateVolumeProfile(bars),
        ichimoku: calculateIchimoku(bars),
        atr: calculateATR(bars),
        obv: calculateOBV(bars),
        parabolicSar: calculateParabolicSAR(bars),
        williamsR: calculateWilliamsR(bars),
        supertrend: calculateSupertrend(bars),
        mfi: calculateMFI(bars),
        keltnerChannel: calculateKeltnerChannel(bars),
        cmf: calculateCMF(bars),
        donchianChannel: calculateDonchianChannel(bars),
        buySellVolume: calculateBuySellVolume(bars),
        smc: calculateSmc(bars),
        squeezeMomentum: calculateSqueezeMomentum(bars),
        macdV: calculateMacdV(bars),
        connorsRsi: calculateConnorsRsi(closes),
        forceIndex: calculateForceIndex(bars),
        elderRay: calculateElderRay(bars),
        elderImpulse: calculateElderImpulse(bars),
        bollingerDerived: calculateBollingerDerived(bars),
        chandelierExit: calculateChandelierExit(bars),
        yangZhang: calculateYangZhang(bars),
        ewmaVolatility: calculateEwmaVolatility(closes),
        hurst: calculateHurst(closes),
        varianceRatio: calculateVarianceRatio(closes),
        regression: calculateRegression(closes),
    };
}
