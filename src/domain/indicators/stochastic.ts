import type { Bar, StochasticResult } from '@/domain/types';
import {
    STOCHASTIC_D_PERIOD,
    STOCHASTIC_K_PERIOD,
    STOCHASTIC_SMOOTHING,
} from '@/domain/indicators/constants';

const MIDPOINT_PERCENTAGE = 50;
const PERCENTAGE_UPPER_BOUND = 100;
const PERCENTAGE_LOWER_BOUND = 0;

/**
 * Calculate Fast %K values from bars.
 * Fast %K = (close - lowest low over kPeriod) / (highest high over kPeriod - lowest low over kPeriod) * 100
 * Returns null for the first kPeriod - 1 bars.
 *
 * Uses a for loop with inner window scan to avoid per-bar bars.slice() allocations.
 */
function calculateFastPercentK(
    bars: Bar[],
    kPeriod: number
): (number | null)[] {
    const result: (number | null)[] = new Array(bars.length);
    for (let i = 0; i < bars.length; i++) {
        if (i < kPeriod - 1) {
            result[i] = null;
            continue;
        }
        let highestHigh = -Infinity;
        let lowestLow = Infinity;
        for (let j = i - kPeriod + 1; j <= i; j++) {
            if (bars[j].high > highestHigh) highestHigh = bars[j].high;
            if (bars[j].low < lowestLow) lowestLow = bars[j].low;
        }
        const range = highestHigh - lowestLow;
        result[i] =
            range === 0
                ? MIDPOINT_PERCENTAGE
                : ((bars[i].close - lowestLow) / range) * 100;
    }
    return result;
}

/**
 * Apply SMA smoothing to Fast %K to get Slow %K, then compute %D as SMA of Slow %K.
 * Slow Stochastic (14, 3, 3):
 *   - Fast %K: (close - LL14) / (HH14 - LL14) * 100
 *   - Slow %K (%K displayed): SMA(Fast %K, smoothing=3)
 *   - Slow %D (%D displayed): SMA(Slow %K, dPeriod=3)
 */
/**
 * Clamp a value to [PERCENTAGE_LOWER_BOUND, PERCENTAGE_UPPER_BOUND].
 */
function clampPercentage(value: number): number {
    return Math.min(
        PERCENTAGE_UPPER_BOUND,
        Math.max(PERCENTAGE_LOWER_BOUND, value)
    );
}

/** @internal Stochastic Oscillator — %K / %D over the high-low range. */
export function calculateStochastic(
    bars: Bar[],
    kPeriod = STOCHASTIC_K_PERIOD,
    dPeriod = STOCHASTIC_D_PERIOD,
    smoothing = STOCHASTIC_SMOOTHING
): StochasticResult[] {
    if (bars.length === 0) return [];

    const fastK = calculateFastPercentK(bars, kPeriod);

    // Extract non-null Fast %K values, then compute Slow %K via running SMA
    const validFastK = fastK.filter((v): v is number => v !== null);
    const slowKValues: (number | null)[] = new Array(validFastK.length);
    let slowKSum = 0;
    for (let i = 0; i < validFastK.length; i++) {
        slowKSum += validFastK[i];
        if (i >= smoothing) slowKSum -= validFastK[i - smoothing];
        slowKValues[i] = i >= smoothing - 1 ? slowKSum / smoothing : null;
    }
    const clampedSlowK: (number | null)[] = slowKValues.map(v =>
        v !== null ? clampPercentage(v) : null
    );

    // Extract non-null Slow %K values, then compute %D via running SMA
    const numericSlowK = clampedSlowK.filter((v): v is number => v !== null);
    const percentDValues: (number | null)[] = new Array(numericSlowK.length);
    let percentDSum = 0;
    for (let i = 0; i < numericSlowK.length; i++) {
        percentDSum += numericSlowK[i];
        if (i >= dPeriod) percentDSum -= numericSlowK[i - dPeriod];
        percentDValues[i] = i >= dPeriod - 1 ? percentDSum / dPeriod : null;
    }
    const clampedPercentD: (number | null)[] = percentDValues.map(v =>
        v !== null ? clampPercentage(v) : null
    );

    // Map back to original bar indices
    const nullOffset = kPeriod - 1;
    const slowKOffset = smoothing - 1;

    return fastK.map((fk, i): StochasticResult => {
        if (fk === null) return { percentK: null, percentD: null };

        const validIndex = i - nullOffset;
        const percentK = clampedSlowK[validIndex] ?? null;

        if (percentK === null) return { percentK: null, percentD: null };

        const slowKIndex = validIndex - slowKOffset;
        const percentD =
            slowKIndex >= 0 ? (clampedPercentD[slowKIndex] ?? null) : null;

        return { percentK, percentD };
    });
}
