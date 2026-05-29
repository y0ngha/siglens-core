import type { Trendline, TrendlinePoint } from '@/domain/types';

// Zero denominator guard: start.time === end.time returns end.price unchanged.
/** @internal Extrapolates a trendline to a target time. */
export function extendTrendline(
    trendline: Trendline,
    targetTime: number
): TrendlinePoint {
    const { start, end } = trendline;
    const timeDelta = end.time - start.time;

    if (timeDelta === 0) {
        return { time: targetTime, price: end.price };
    }

    const slope = (end.price - start.price) / timeDelta;
    const price = start.price + slope * (targetTime - start.time);

    return { time: targetTime, price };
}
