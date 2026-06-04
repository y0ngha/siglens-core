import type { Bar } from '@/domain/types';
import { calculateMACD } from './macd';
import { calculateATR } from './atr';
import {
    MACD_FAST_PERIOD,
    MACD_SLOW_PERIOD,
    MACD_V_ATR_PERIOD,
    MACD_V_SCALE,
} from './constants';

/**
 * @internal MACD-V — ATR-normalised MACD expressed as a percentage.
 *
 * Formula: `macdV[i] = (macd[i] / atr[i]) * 100` when both are non-null and atr > 0; else null.
 * Normalising by ATR makes the oscillator comparable across symbols and timeframes.
 */
export function calculateMacdV(
    bars: Bar[],
    fastPeriod = MACD_FAST_PERIOD,
    slowPeriod = MACD_SLOW_PERIOD,
    atrPeriod = MACD_V_ATR_PERIOD
): (number | null)[] {
    if (bars.length === 0) return [];

    const macdResults = calculateMACD(bars, fastPeriod, slowPeriod);
    const atrValues = calculateATR(bars, atrPeriod);

    return bars.map((_, i) => {
        const macd = macdResults[i].macd;
        const atr = atrValues[i];
        if (macd === null || atr === null || atr <= 0) return null;
        return (macd / atr) * MACD_V_SCALE;
    });
}
