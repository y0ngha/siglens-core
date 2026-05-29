import type { Bar } from '@/domain/types';

/** @internal Core exponential moving average over a numeric series. */
export function computeEMAValues(
    values: number[],
    period: number
): (number | null)[] {
    if (values.length === 0 || period <= 0) return [];
    if (values.length < period) return values.map(() => null);

    const initialSMA =
        values.slice(0, period).reduce((sum, v) => sum + v, 0) / period;

    const multiplier = 2 / (period + 1);

    const seed: (number | null)[] = [
        ...new Array(period - 1).fill(null),
        initialSMA,
    ];

    const result: (number | null)[] = [...seed];
    const tail = values.slice(period);
    for (let i = 0; i < tail.length; i++) {
        // seed 마지막 값은 initialSMA(number)로 보장되므로 as number 사용
        const prev = result.at(-1) as number;
        result.push(tail[i] * multiplier + prev * (1 - multiplier));
    }
    return result;
}

/** @internal Exponential moving average of bar closes for a given period. */
export function calculateEMA(bars: Bar[], period: number): (number | null)[] {
    return computeEMAValues(
        bars.map(bar => bar.close),
        period
    );
}
