import type { Bar } from '@/domain/types';
import { CCI_DEFAULT_PERIOD, CCI_NORMALIZATION_CONSTANT } from './constants';
import { typicalPrice } from './utils';

export function calculateCCI(
    bars: Bar[],
    period = CCI_DEFAULT_PERIOD
): (number | null)[] {
    if (bars.length === 0) return [];
    if (bars.length < period) return bars.map(() => null);

    const typicalPrices = bars.map(bar =>
        typicalPrice(bar.high, bar.low, bar.close)
    );

    const result: (number | null)[] = [];
    let smaSum = 0;

    for (let i = 0; i < typicalPrices.length; i++) {
        smaSum += typicalPrices[i];
        if (i >= period) smaSum -= typicalPrices[i - period];
        if (i < period - 1) {
            result.push(null);
            continue;
        }
        const smaValue = smaSum / period;
        let meanDevSum = 0;
        for (let j = i - period + 1; j <= i; j++) {
            meanDevSum += Math.abs(typicalPrices[j] - smaValue);
        }
        const meanDeviation = meanDevSum / period;
        const currentTP = typicalPrices[i];
        result.push(
            meanDeviation === 0
                ? 0
                : (currentTP - smaValue) /
                      (CCI_NORMALIZATION_CONSTANT * meanDeviation)
        );
    }

    return result;
}
