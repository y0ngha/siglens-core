import type { Bar, BollingerResult } from '@/domain/types';
import {
    BOLLINGER_DEFAULT_PERIOD,
    BOLLINGER_DEFAULT_STD_DEV,
} from '@/domain/indicators/constants';

export function calculateBollinger(
    bars: Bar[],
    period = BOLLINGER_DEFAULT_PERIOD,
    stdDev = BOLLINGER_DEFAULT_STD_DEV
): BollingerResult[] {
    if (bars.length < period)
        return bars.map(() => ({ upper: null, middle: null, lower: null }));

    const closes = bars.map(bar => bar.close);
    const result: BollingerResult[] = [];
    let windowSum = 0;
    let windowSumSq = 0;

    for (let i = 0; i < closes.length; i++) {
        windowSum += closes[i];
        windowSumSq += closes[i] ** 2;
        if (i >= period) {
            windowSum -= closes[i - period];
            windowSumSq -= closes[i - period] ** 2;
        }
        if (i < period - 1) {
            result.push({ upper: null, middle: null, lower: null });
            continue;
        }
        const middle = windowSum / period;
        const variance = Math.max(0, windowSumSq / period - middle ** 2);
        const std = Math.sqrt(variance);
        result.push({
            upper: middle + stdDev * std,
            middle,
            lower: middle - stdDev * std,
        });
    }

    return result;
}
