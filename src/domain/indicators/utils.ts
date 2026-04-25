/**
 * Simple Moving Average for a number array.
 * Returns null when there are fewer values than the period.
 */
export function sma(values: number[], period: number): number | null {
    if (values.length < period) return null;
    return values.slice(-period).reduce((sum, v) => sum + v, 0) / period;
}

/**
 * Typical Price of a bar: (high + low + close) / 3
 */
export function typicalPrice(high: number, low: number, close: number): number {
    return (high + low + close) / 3;
}

/**
 * Population standard deviation of a number array.
 * Returns null when there are fewer values than the period.
 */
export function stdDev(values: number[], period: number): number | null {
    if (values.length < period) return null;
    const vals = values.slice(-period);
    const mean = vals.reduce((sum, v) => sum + v, 0) / period;
    const variance = vals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period;
    return Math.sqrt(variance);
}

/**
 * Rolling maximum of the last `period` values.
 * Returns null when there are fewer values than the period.
 */
export function rollingHighest(
    values: number[],
    period: number
): number | null {
    if (values.length < period) return null;
    return Math.max(...values.slice(-period));
}

/**
 * Rolling minimum of the last `period` values.
 * Returns null when there are fewer values than the period.
 */
export function rollingLowest(values: number[], period: number): number | null {
    if (values.length < period) return null;
    return Math.min(...values.slice(-period));
}

/**
 * Sliding window maximum (right-aligned, size = period) using a monotone deque.
 * Returns null for indices < period - 1.
 * O(N) total — each element is added and removed from the deque at most once.
 */
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

/**
 * Sliding window minimum (right-aligned, size = period) using a monotone deque.
 * Returns null for indices < period - 1.
 * O(N) total — each element is added and removed from the deque at most once.
 */
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

/**
 * Linear regression value at the end of the window (offset = 0).
 * Fits a least-squares line to the last `period` values and returns
 * the predicted value at the most recent bar.
 * Returns null when there are fewer values than the period.
 *
 * Equivalent to PineScript: linreg(source, length, 0)
 */
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
