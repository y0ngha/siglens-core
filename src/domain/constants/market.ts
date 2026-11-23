import type { ProviderTimeframe, Timeframe } from '@/domain/types';

/** @internal */
export const DEFAULT_TIMEFRAME: Timeframe = '1Day';

/** @internal Timeframes a provider serves, in display order (the pre-`1Week` list). */
export const PROVIDER_TIMEFRAMES: readonly ProviderTimeframe[] = [
    '5Min',
    '15Min',
    '30Min',
    '1Hour',
    '4Hour',
    '1Day',
];

/** @internal Every analysis timeframe: the provider ones plus the core-built `1Week`. */
export const TIMEFRAMES: readonly Timeframe[] = [
    ...PROVIDER_TIMEFRAMES,
    '1Week',
];

/**
 * Per-timeframe classification behind {@link isDailyOrLonger}. `satisfies`
 * keeps it exhaustive (a new `Timeframe` member is a compile error here instead
 * of silently falling into the intraday bucket) and `as const` keeps the literal
 * values so {@link DailyOrLongerTimeframe} is derived from the table, not
 * restated beside it.
 */
const DAILY_OR_LONGER = {
    '5Min': false,
    '15Min': false,
    '30Min': false,
    '1Hour': false,
    '4Hour': false,
    '1Day': true,
    '1Week': true,
} as const satisfies Record<Timeframe, boolean>;

/** Timeframes whose bars are dated sessions or weeks (`'1Day' | '1Week'`). */
export type DailyOrLongerTimeframe = {
    [K in Timeframe]: (typeof DAILY_OR_LONGER)[K] extends true ? K : never;
}[Timeframe];

/** Timeframes whose bars are clock times (`'5Min'` .. `'4Hour'`). */
export type IntradayTimeframe = Exclude<Timeframe, DailyOrLongerTimeframe>;

/**
 * Whether bars of this timeframe are dated sessions or weeks (`'1Day'`,
 * `'1Week'`) rather than clock times. Use it where `=== '1Day'` meant "not
 * intraday"; keep `=== '1Day'` only where a rule is measured on daily bars
 * alone. The agent-only `'1Month'` frame is not a `Timeframe`, so it is not
 * classified here.
 *
 * @param timeframe - Analysis timeframe.
 * @returns `true` (narrowing to {@link DailyOrLongerTimeframe}) for `'1Day'`
 * and `'1Week'`; `false` (narrowing to {@link IntradayTimeframe}) for
 * `5Min` .. `4Hour`.
 */
export function isDailyOrLonger(
    timeframe: Timeframe
): timeframe is DailyOrLongerTimeframe {
    return DAILY_OR_LONGER[timeframe];
}

/**
 * Whether bars of this timeframe are clock-time bars (`5Min` .. `4Hour`): the
 * exact complement of {@link isDailyOrLonger}.
 *
 * @param timeframe - Analysis timeframe.
 * @returns `true` (narrowing to {@link IntradayTimeframe}) for `5Min` ..
 * `4Hour`; `false` (narrowing to {@link DailyOrLongerTimeframe}) for `'1Day'`
 * and `'1Week'`.
 */
export function isIntraday(
    timeframe: Timeframe
): timeframe is IntradayTimeframe {
    return !DAILY_OR_LONGER[timeframe];
}

/** @internal */
export function isValidTimeframe(
    value: string | undefined | null
): value is Timeframe {
    if (!value) return false;
    return (TIMEFRAMES as readonly string[]).includes(value);
}

/** @internal Per-timeframe bar counts: ~3.7 trading days (5Min) to 2 years (1Day). */
export const TIMEFRAME_BARS_LIMIT: Record<Timeframe, number> = {
    '5Min': 288,
    '15Min': 200,
    '30Min': 200,
    '1Hour': 200,
    '4Hour': 200,
    '1Day': 500,
    // Documentation of the expected size (5 years of weeks); providers ignore `limit`.
    '1Week': 260,
};

/** @internal */
export const DEFAULT_BARS_LIMIT = TIMEFRAME_BARS_LIMIT[DEFAULT_TIMEFRAME];

/** @internal Wall-clock minutes one bar spans. */
export const TIMEFRAME_MINUTES: Record<Timeframe, number> = {
    '5Min': 5,
    '15Min': 15,
    '30Min': 30,
    '1Hour': 60,
    '4Hour': 240,
    '1Day': 1_440,
    '1Week': 10_080,
};

/**
 * Calendar-day lookback for **Fear & Greed** history (≈ 5 years).
 *
 * Fear & Greed scores are percentiles against the instrument's (or market's)
 * own past, so the length of that past is part of the definition. Two years
 * left only 3–4 extreme-zone episodes per symbol; five years gives enough
 * episodes for the after-entry aggregates to be meaningful, and a steadier
 * baseline for the score itself. Only Fear & Greed uses this window — charts,
 * indicators and analysis prompts keep `TIMEFRAME_LOOKBACK_DAYS`.
 */
export const FEAR_GREED_LOOKBACK_DAYS = 1_830;

/** @internal Calendar-day lookback per timeframe — wider than trading days to absorb weekends and holidays. */
export const TIMEFRAME_LOOKBACK_DAYS: Record<Timeframe, number> = {
    '5Min': 10,
    '15Min': 20,
    '30Min': 30,
    '1Hour': 60,
    '4Hour': 200,
    '1Day': 730,
    // Weekly bars are built from the same 5-year daily history Fear & Greed
    // already fetches, so the provider call (and its cache entry) is shared.
    '1Week': FEAR_GREED_LOOKBACK_DAYS,
};
