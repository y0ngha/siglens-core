/**
 * How many bars after a candle pattern the base-rate label looks ahead: the candle row of
 * `MeasuredBaseRate.eventShare` is the share of events whose close moved in the label's
 * direction over this many bars ("next-5-bar move").
 *
 * The replay measurement (`scripts/replay/engineEvalTypes.ts` `HORIZONS.h5`) and the
 * generator's emitted "next-N-bar" wording (`baseRateTableRender.ts`) both read this, so the
 * published number, the measured horizon and the prose cannot drift apart. Changing it changes what
 * `CANDLE_BASE_RATES` means: regenerate `measuredBaseRates.ts` in the same change. Pure; both
 * entrypoints.
 */
export const CANDLE_OUTCOME_BARS = 5;
