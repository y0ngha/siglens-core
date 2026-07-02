import type { Bar } from '@/domain/types';

/**
 * Builds tight bars (high = close + 0.05, low = close - 0.05) so pivot prices
 * track the given closes deterministically. Shared across the `patterns`
 * test suite (pivots + classifiers).
 */
export function makeBars(closes: number[]): Bar[] {
    return closes.map((close, i) => ({
        time: i,
        open: close,
        high: close + 0.05,
        low: close - 0.05,
        close,
        volume: 1000,
    }));
}

/**
 * Builds bars with explicit [high, low] pairs — used where a test needs
 * exact boundary arithmetic (e.g. a retracement of exactly the threshold)
 * that `makeBars`' fixed +/-0.05 offset would obscure. `open`/`close` are
 * irrelevant to `extractPivots` and set to `high`/`low` respectively.
 */
export function makeHLBars(pairs: Array<[high: number, low: number]>): Bar[] {
    return pairs.map(([high, low], i) => ({
        time: i,
        open: high,
        high,
        low,
        close: low,
        volume: 1000,
    }));
}
