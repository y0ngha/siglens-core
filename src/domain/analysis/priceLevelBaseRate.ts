/**
 * The measured hold rate of the reference levels the market reference prints (WP-18, C3),
 * and the framing sentence built from it. One source for every number the sentence prints
 * (CP-11), rendered with grouped digits (DOM-11).
 *
 * **What was measured.** Offline, on the 65-symbol daily replay set (55 U.S., 10 Korean),
 * every third session from the 300th bar: each level the prompt prints on either side of the
 * close was followed for 20 bars. A level is *touched* when price comes within 0.1 ATR of it
 * and *held* when a close 0.5 ATR back on the level's side comes before a close 0.5 ATR
 * through it, within 10 bars of the touch (`labelLevelOutcome`). The comparison is a date
 * transplant placebo: the same side and the same distance in ATR from the close on three other
 * dates of the same symbol, labelled by the same rule. Levels held 49.6% of 550,171 touches;
 * the transplanted prices 49.7%. By kind family, number of coinciding kinds, prior touch
 * episodes, reactions, traded volume and recency no group sat more than about 2 points from
 * the overall rate. A fitted score (kinds, touches, volume, recency) separated held from not
 * held no better than the placebo out of sample, so no level score exists.
 *
 * **Scope (DOM-12).** Daily bars only: an intraday prompt gets the unnumbered sentence. The
 * figures are re-derived by `scripts/replay/levelEval.ts` (gates L0, L-gate); when the
 * generated `measuredBaseRates.ts` lands (WP-18 core-3) its `PRICE_LEVEL_BASE_RATE` row is the
 * same measurement and replaces this constant.
 */
import type { Timeframe } from '@/domain/types';

export interface PriceLevelHoldRate {
    /** Symbols the measurement covers, and how many are U.S. and Korean listings. */
    readonly symbols: number;
    readonly usSymbols: number;
    readonly krSymbols: number;
    /**
     * First and last calendar year of the measured study days. The bars start in 2017, but a
     * study day needs 300 bars of history, so the first one is 2018-03-14 (last 2026-10-23).
     */
    readonly fromYear: number;
    readonly toYear: number;
    /** Touches that resolved to held or not held. */
    readonly touches: number;
    /** Share of those touches that held, 0..1. */
    readonly heldShare: number;
    /** The same share for prices at the same distance on other dates, 0..1. */
    readonly placeboShare: number;
    /** No grouping (kind, coinciding levels, touches, volume) moved the rate further than this, in points. */
    readonly groupSpreadPoints: number;
}

/** Set `replay-v1`, `levelEval --step 3` on core main `f4da6757` (bars 2017-01-03 to 2026-11-20). */
export const PRICE_LEVEL_HOLD_RATE: PriceLevelHoldRate = {
    symbols: 65,
    usSymbols: 55,
    krSymbols: 10,
    fromYear: 2018,
    toYear: 2026,
    touches: 550_171,
    heldShare: 0.496498,
    placeboShare: 0.496668,
    groupSpreadPoints: 2,
};

const percent = (share: number): string => `${(share * 100).toFixed(1)}%`;

/**
 * @internal
 * The sentence the market reference framing carries about the printed levels: the measured
 * numbers on a daily chart, the same advice without numbers anywhere else (the measurement
 * is not available for intraday bars).
 */
export function formatLevelHoldFraming(
    timeframe: Timeframe,
    rate: PriceLevelHoldRate = PRICE_LEVEL_HOLD_RATE
): string {
    const advice =
        'Treat these levels as a map of where price may pause or react, not as levels that hold; do not call a level strong, firm or key because several references coincide there.';
    if (timeframe !== '1Day') {
        return `Not measured on intraday bars. ${advice}`;
    }
    return `Measured on ${rate.symbols} symbols (${rate.usSymbols} U.S., ${rate.krSymbols} Korean), daily bars ${rate.fromYear}–${rate.toYear}: after price touched one of these printed levels, it held (closed 0.5 ATR back on the level's side before closing 0.5 ATR through it, within 10 bars) in ${percent(rate.heldShare)} of ${rate.touches.toLocaleString('en-US')} touches — the same as a price at the same distance on another date (${percent(rate.placeboShare)}). No level kind, number of coinciding levels, prior touches or traded volume moved that by more than about ${rate.groupSpreadPoints} points. ${advice}`;
}
