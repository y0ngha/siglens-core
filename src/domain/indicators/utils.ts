import { findLast } from '@/domain/arrayCompat';

/** @internal Simple moving average of the last `period` values. */
export function sma(values: number[], period: number): number | null {
    if (values.length < period) return null;
    return values.slice(-period).reduce((sum, v) => sum + v, 0) / period;
}

/** @internal Typical price — mean of high, low, and close. */
export function typicalPrice(high: number, low: number, close: number): number {
    return (high + low + close) / 3;
}

/** @internal Population standard deviation over the last `period` values. */
export function stdDev(values: number[], period: number): number | null {
    if (values.length < period) return null;
    const vals = values.slice(-period);
    const mean = vals.reduce((sum, v) => sum + v, 0) / period;
    const variance = vals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period;
    return Math.sqrt(variance);
}

/** @internal Highest value within the last `period` values. */
export function rollingHighest(
    values: number[],
    period: number
): number | null {
    if (values.length < period) return null;
    return Math.max(...values.slice(-period));
}

/** @internal Lowest value within the last `period` values. */
export function rollingLowest(values: number[], period: number): number | null {
    if (values.length < period) return null;
    return Math.min(...values.slice(-period));
}

/** @internal O(N) sliding-window maximum via monotone deque. */
// Each index is pushed/popped at most once, so the whole pass stays O(N).
export function slidingMax(
    values: number[],
    period: number
): (number | null)[] {
    const result: (number | null)[] = new Array(values.length).fill(null);
    const deq: number[] = []; // indices with decreasing values
    let front = 0;
    for (let i = 0; i < values.length; i++) {
        while (front < deq.length && deq[front] <= i - period) front++;
        while (front < deq.length && values[deq[deq.length - 1]] <= values[i])
            deq.pop();
        deq.push(i);
        if (i >= period - 1) result[i] = values[deq[front]];
    }
    return result;
}

/** @internal O(N) sliding-window minimum via monotone deque. */
// Each index is pushed/popped at most once, so the whole pass stays O(N).
export function slidingMin(
    values: number[],
    period: number
): (number | null)[] {
    const result: (number | null)[] = new Array(values.length).fill(null);
    const deq: number[] = []; // indices with increasing values
    let front = 0;
    for (let i = 0; i < values.length; i++) {
        while (front < deq.length && deq[front] <= i - period) front++;
        while (front < deq.length && values[deq[deq.length - 1]] >= values[i])
            deq.pop();
        deq.push(i);
        if (i >= period - 1) result[i] = values[deq[front]];
    }
    return result;
}

/** @internal Last non-null value in the array, or null if none. */
export function lastNonNull(arr: readonly (number | null)[]): number | null {
    return findLast(arr, (v): v is number => v !== null) ?? null;
}

/** @internal Linear-regression endpoint value over the last `period` values. */
// Equivalent to PineScript linreg(source, length, 0).
export function linreg(values: number[], period: number): number | null {
    if (values.length < period) return null;
    const vals = values.slice(-period);
    const n = period;
    // x = [0, 1, ..., n-1], y = vals
    const sumX = (n * (n - 1)) / 2;
    const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
    const sumY = vals.reduce((sum, v) => sum + v, 0);
    const sumXY = vals.reduce((sum, v, i) => sum + i * v, 0);
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    return intercept + slope * (n - 1);
}

/**
 * @internal Median of a numeric list (sorted ascending on a copy), or `null`
 * for an empty input. Shared by the fundamental prompt's peer medians and the
 * Fear & Greed forward-change aggregation.
 */
export function median(values: readonly number[]): number | null {
    const n = values.length;
    if (n === 0) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(n / 2);
    return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
