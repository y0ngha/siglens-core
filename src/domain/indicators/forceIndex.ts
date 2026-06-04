import type { Bar } from '@/domain/types';
import { computeEMAValues } from './ema';
import { FORCE_INDEX_PERIOD } from './constants';

/**
 * @internal Force Index — measures buying/selling pressure by combining price change and volume.
 *
 * Formula:
 * - raw[i] = (close[i] − close[i-1]) × volume[i]  for i ≥ 1
 * - result = EMA(raw, period)
 *
 * Index 0 and the EMA warm-up window are null.
 */
export function calculateForceIndex(
    bars: Bar[],
    period = FORCE_INDEX_PERIOD
): (number | null)[] {
    const n = bars.length;
    if (n === 0) return [];
    if (period <= 0) return new Array(n).fill(null);

    // Build raw force values; index 0 has no prior bar → skip
    // O(N) is unavoidable; slice avoids mutating input
    const raw: number[] = bars
        .slice(1)
        .map((bar, i) => (bar.close - bars[i].close) * bar.volume);

    const smoothed = computeEMAValues(raw, period);

    // Re-align: prepend one null for the missing index 0
    return [null, ...smoothed];
}
