import type { HorizonKey, Timeframe } from '@/domain/types';

/** Trailing-bar lookback window per horizon, per timeframe (capped at bars.length). */
export const HORIZON_WINDOWS_BY_TIMEFRAME: Record<
    Timeframe,
    Record<HorizonKey, number>
> = {
    '5Min': { short: 24, medium: 78, long: 200 },
    '15Min': { short: 26, medium: 78, long: 200 },
    '30Min': { short: 26, medium: 78, long: 200 },
    '1Hour': { short: 24, medium: 72, long: 200 },
    '4Hour': { short: 20, medium: 60, long: 180 },
    '1Day': { short: 20, medium: 60, long: 200 },
};

/** Round-number increment by price tier (ascending ceiling). */
export interface RoundNumberTier {
    maxPrice: number;
    increment: number;
}
export const ROUND_NUMBER_TIERS: readonly RoundNumberTier[] = [
    { maxPrice: 5, increment: 0.5 },
    { maxPrice: 50, increment: 1 },
    { maxPrice: 200, increment: 5 },
    { maxPrice: Number.POSITIVE_INFINITY, increment: 10 },
];

/** Regime descriptor thresholds. */
export const ADX_TRENDING_THRESHOLD = 25;
export const EFFICIENCY_RATIO_TRENDING_THRESHOLD = 0.3;

/** Camarilla pivot constants: level = C ± (H−L)·1.1/divisor. */
export const CAMARILLA_FACTOR = 1.1;
export const CAMARILLA_R3_S3_DIVISOR = 4;
export const CAMARILLA_R4_S4_DIVISOR = 2;

/** Max reference levels surfaced per side, per horizon (prompt-size control). */
export const MAX_REFERENCE_LEVELS_PER_SIDE = 6;
