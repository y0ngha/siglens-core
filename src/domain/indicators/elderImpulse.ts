import type { Bar, ImpulseColor } from '@/domain/types';
import { calculateEMA } from './ema';
import { calculateMACD } from './macd';
import { ELDER_IMPULSE_EMA_PERIOD } from './constants';

/**
 * @internal Elder Impulse System — classifies each bar's momentum as green, red, or blue.
 *
 * For i ≥ 1, when ema[i], ema[i-1], hist[i], and hist[i-1] are all non-null:
 * - `green` if EMA is rising (ema[i] > ema[i-1]) AND histogram is rising (hist[i] > hist[i-1])
 * - `red`   if EMA is falling AND histogram is falling
 * - `blue`  otherwise (mixed or flat signals)
 *
 * Null at index 0 and during the MACD histogram warm-up window.
 */
export function calculateElderImpulse(
    bars: Bar[],
    emaPeriod = ELDER_IMPULSE_EMA_PERIOD
): (ImpulseColor | null)[] {
    if (bars.length === 0) return [];

    const emaValues = calculateEMA(bars, emaPeriod);
    const macdResults = calculateMACD(bars);

    return bars.map((_, i) => {
        if (i === 0) return null;

        const ema = emaValues[i];
        const emaPrev = emaValues[i - 1];
        const hist = macdResults[i].histogram;
        const histPrev = macdResults[i - 1].histogram;

        if (
            ema === null ||
            emaPrev === null ||
            hist === null ||
            histPrev === null
        ) {
            return null;
        }

        // Green = trend AND momentum strictly rising; red = both strictly
        // falling; blue otherwise (mixed OR flat — equal values are neither
        // rising nor falling, so a flat bar is blue, not red).
        if (ema > emaPrev && hist > histPrev) return 'green';
        if (ema < emaPrev && hist < histPrev) return 'red';
        return 'blue';
    });
}
