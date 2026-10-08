import type { Bar } from '@/domain/types';
import { ATR_DEFAULT_PERIOD } from '@/domain/indicators/constants';

function trueRange(bar: Bar, prev: Bar): number {
    return Math.max(
        bar.high - bar.low,
        Math.abs(bar.high - prev.close),
        Math.abs(bar.low - prev.close)
    );
}

/** @internal Average True Range — volatility measure consumed by the indicator suite. */
export function calculateATR(
    bars: readonly Bar[],
    period = ATR_DEFAULT_PERIOD
): (number | null)[] {
    if (bars.length === 0) return [];
    if (bars.length <= period) return bars.map(() => null);

    const trValues = bars.slice(1).map((bar, i) => trueRange(bar, bars[i]));

    const initialATR =
        trValues.slice(0, period).reduce((sum, tr) => sum + tr, 0) / period;

    const tailTrValues = trValues.slice(period);
    const atrValues = new Array<number>(tailTrValues.length + 1);
    atrValues[0] = initialATR;
    for (let i = 0; i < tailTrValues.length; i++) {
        atrValues[i + 1] =
            (atrValues[i] * (period - 1) + tailTrValues[i]) / period;
    }

    return [...new Array(period).fill(null), ...atrValues];
}
