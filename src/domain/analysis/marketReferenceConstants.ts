import type { HorizonKey, RoundNumberTier, Timeframe } from '@/domain/types';

/** @internal Trailing-bar lookback window per horizon, per timeframe (capped at bars.length). */
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

/** @internal Which MA/EMA periods each horizon surfaces as levels. */
export const HORIZON_MA_PERIODS: Record<
    HorizonKey,
    { ma: readonly number[]; ema: readonly number[] }
> = {
    short: { ma: [20], ema: [9, 20] },
    medium: { ma: [60], ema: [60] },
    long: { ma: [120, 200], ema: [] },
};

/** @internal Round-number increments by price tier (ascending ceiling). */
export const ROUND_NUMBER_TIERS: readonly RoundNumberTier[] = [
    { maxPrice: 5, increment: 0.5 },
    { maxPrice: 50, increment: 1 },
    { maxPrice: 200, increment: 5 },
    { maxPrice: Number.POSITIVE_INFINITY, increment: 10 },
];

/** @internal ADX threshold above which a horizon is labelled trending. */
export const ADX_TRENDING_THRESHOLD = 25;
/** @internal Efficiency-ratio threshold above which a horizon is labelled trending. */
export const EFFICIENCY_RATIO_TRENDING_THRESHOLD = 0.3;

/** @internal Camarilla pivot factor: level = C ± (H−L)·1.1/divisor. */
export const CAMARILLA_FACTOR = 1.1;
/** @internal Camarilla R3/S3 divisor. */
export const CAMARILLA_R3_S3_DIVISOR = 4;
/** @internal Camarilla R4/S4 divisor. */
export const CAMARILLA_R4_S4_DIVISOR = 2;

/** @internal Max reference levels surfaced per side, per horizon (prompt-size control). */
export const MAX_REFERENCE_LEVELS_PER_SIDE = 6;

/** @internal Factor converting a fraction to a percentage (distance %, fib ratio labels). */
export const RATIO_TO_PERCENT = 100;
