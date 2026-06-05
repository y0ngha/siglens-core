import type { Bar, BollingerDerivedResult } from '@/domain/types';
import { calculateBollinger } from './bollinger';
import {
    BOLLINGER_DEFAULT_PERIOD,
    BOLLINGER_DEFAULT_STD_DEV,
} from './constants';

/**
 * @internal Bollinger %B and BandWidth derived from standard Bollinger Bands.
 *
 * - pctB      = (close − lower) / (upper − lower)
 *               null when the band is null or zero-width (flat price → no divide-by-zero).
 * - bandwidth = (upper − lower) / middle
 *               null when the band is null or middle = 0.
 *
 * Both fields are null during the warm-up window (first `period − 1` bars).
 */
export function calculateBollingerDerived(
    bars: Bar[],
    period = BOLLINGER_DEFAULT_PERIOD,
    stdDev = BOLLINGER_DEFAULT_STD_DEV
): BollingerDerivedResult[] {
    const n = bars.length;
    if (n === 0) return [];
    if (period <= 0)
        return Array.from({ length: n }, () => ({
            pctB: null,
            bandwidth: null,
        }));
    const bands = calculateBollinger(bars, period, stdDev);

    return Array.from({ length: n }, (_, i) => {
        const band = bands[i];
        if (
            band.upper === null ||
            band.middle === null ||
            band.lower === null
        ) {
            return { pctB: null, bandwidth: null };
        }

        const width = band.upper - band.lower;
        const pctB = width > 0 ? (bars[i].close - band.lower) / width : null;
        const bandwidth = band.middle !== 0 ? width / band.middle : null;

        return { pctB, bandwidth };
    });
}
