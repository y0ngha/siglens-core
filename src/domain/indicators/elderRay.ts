import type { Bar, ElderRayResult } from '@/domain/types';
import { calculateEMA } from './ema';
import { ELDER_RAY_PERIOD } from './constants';

/**
 * @internal Elder-Ray — measures buying and selling power relative to an EMA.
 *
 * - bullPower[i] = high[i] − ema[i]  (positive → bulls pushing above trend)
 * - bearPower[i] = low[i]  − ema[i]  (negative → bears pushing below trend)
 *
 * Both are null during the EMA warm-up window (first `period − 1` bars).
 */
export function calculateElderRay(
    bars: Bar[],
    period = ELDER_RAY_PERIOD
): ElderRayResult[] {
    if (bars.length === 0) return [];

    const emaValues = calculateEMA(bars, period);

    return bars.map((bar, i) => {
        const ema = emaValues[i];
        if (ema === null) return { bullPower: null, bearPower: null };
        return {
            bullPower: bar.high - ema,
            bearPower: bar.low - ema,
        };
    });
}
