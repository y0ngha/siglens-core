/**
 * The framing sentence about the reference levels the market reference prints (WP-18, C3),
 * built from the measured hold rate of the generated table (`PRICE_LEVEL_BASE_RATE`, the one
 * source of every number it prints, CP-11) and rendered with grouped digits (DOM-11).
 *
 * **What was measured.** Offline, on the daily replay set, every third session from the
 * 300th bar: each level the prompt prints on either side of the close was followed for 20
 * bars. A level is *touched* when price comes within 0.1 ATR of it and *held* when a close
 * 0.5 ATR back on the level's side comes before a close 0.5 ATR through it, within 10 bars of
 * the touch (`labelLevelOutcome`). The comparison is a date transplant placebo: the same side
 * and the same distance in ATR from the close on three other dates of the same symbol,
 * labelled by the same rule. A fitted score (kinds, touches, volume, recency) separated held
 * from not held no better than the placebo out of sample, so no level score exists.
 *
 * **Scope (DOM-12).** Daily bars only: an intraday prompt gets the unnumbered sentence. The
 * figures are re-derived by `scripts/replay/levelEval.ts` (gates L0, L-gate) and written into
 * `measuredBaseRates.ts` by `scripts/replay/baseRateTable.ts`.
 */
import { PRICE_LEVEL_BASE_RATE } from '@/domain/analysis/measuredBaseRates';
import type { MeasuredBaseRate } from '@/domain/analysis/measuredBaseRates';
import type { Timeframe } from '@/domain/types';

const percent = (share: number): string => `${(share * 100).toFixed(1)}%`;

/** The calendar year of an ISO date (`2018-03-14` -> `2018`). */
const yearOf = (isoDate: string): string => isoDate.slice(0, 4);

/**
 * @internal
 * The sentence the market reference framing carries about the printed levels: the measured
 * numbers on a daily chart, the same advice without numbers anywhere else (the measurement
 * is not available for intraday bars).
 */
export function formatLevelHoldFraming(
    timeframe: Timeframe,
    rate: MeasuredBaseRate = PRICE_LEVEL_BASE_RATE
): string {
    const advice =
        'Treat these levels as a map of where price may pause or react, not as levels that hold; do not call a level strong, firm or key because several references coincide there.';
    if (timeframe !== '1Day') {
        return `Not measured on intraday bars. ${advice}`;
    }
    const { scope } = rate;
    return `Measured on ${scope.symbols} symbols (U.S. and Korean), daily bars ${yearOf(scope.from)}–${yearOf(scope.to)}: after price touched one of these printed levels, it held (closed 0.5 ATR back on the level's side before closing 0.5 ATR through it, within 10 bars) in ${percent(rate.eventShare)} of ${rate.n.toLocaleString('en-US')} touches — the same as a price at the same distance on another date (${percent(rate.placeboShare)}). ${advice}`;
}
