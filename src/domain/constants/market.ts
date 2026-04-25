import type { Timeframe } from '@/domain/types';

export const DEFAULT_TIMEFRAME: Timeframe = '1Day';

export const TIMEFRAMES: readonly Timeframe[] = [
    '5Min',
    '15Min',
    '30Min',
    '1Hour',
    '4Hour',
    '1Day',
];

export function isValidTimeframe(
    value: string | undefined | null
): value is Timeframe {
    if (!value) return false;
    return (TIMEFRAMES as readonly string[]).includes(value);
}

// Per-timeframe bar counts: ~3.7 trading days (5Min) to 2 years (1Day).
export const TIMEFRAME_BARS_LIMIT: Record<Timeframe, number> = {
    '5Min': 288,
    '15Min': 200,
    '30Min': 200,
    '1Hour': 200,
    '4Hour': 200,
    '1Day': 500,
};

export const DEFAULT_BARS_LIMIT = TIMEFRAME_BARS_LIMIT[DEFAULT_TIMEFRAME];

// Calendar-day lookback per timeframe — wider than trading days to absorb weekends and holidays.
export const TIMEFRAME_LOOKBACK_DAYS: Record<Timeframe, number> = {
    '5Min': 10,
    '15Min': 20,
    '30Min': 30,
    '1Hour': 60,
    '4Hour': 200,
    '1Day': 730,
};
