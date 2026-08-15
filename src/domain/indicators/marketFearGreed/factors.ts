import { sma } from '@/domain/indicators/utils';
import type {
    AlignedMarketSeries,
    MarketFactorValues,
} from '@/domain/indicators/marketFearGreed/types';

/**
 * Rolling windows, in trading sessions. `MOMENTUM_MA` follows CNN's
 * "S&P 500 versus its 125-day moving average"; `VOLATILITY_MA` follows
 * "VIX versus its 50-day moving average"; `RETURN` is the 20-session lookback
 * shared by the safe-haven, junk-bond, and breadth spreads.
 *
 * @internal
 */
export const MARKET_FEAR_GREED_WINDOWS = {
    MOMENTUM_MA: 125,
    VOLATILITY_MA: 50,
    RETURN: 20,
} as const;

/**
 * First index at which every factor window is fully populated. Sessions before
 * this index produce `null` factors and therefore a `null` history score.
 *
 * @internal
 */
export const MARKET_FEAR_GREED_WARMUP =
    MARKET_FEAR_GREED_WINDOWS.MOMENTUM_MA - 1;

/** Simple return over `window` sessions ending at `t`, or null when out of range. */
function returnOver(
    closes: number[],
    t: number,
    window: number
): number | null {
    const from = t - window;
    if (from < 0) return null;
    const base = closes[from];
    if (!(base > 0)) return null;
    return closes[t] / base - 1;
}

/** Relative distance of `closes[t]` from its `window`-session moving average. */
function distanceFromMa(
    closes: number[],
    t: number,
    window: number
): number | null {
    // Slice only the window itself, not the whole prefix — this runs once per
    // session per factor, so a prefix copy would make the history O(n²).
    const ma = sma(closes.slice(Math.max(0, t + 1 - window), t + 1), window);
    if (ma === null || !(ma > 0)) return null;
    return (closes[t] - ma) / ma;
}

/**
 * Raw factor bundle for session `t`, using only sessions ≤ `t` (no look-ahead).
 *
 * Every factor is oriented so a larger value means *greedier*: `volatility` is
 * the negated VIX/MA distance, because a VIX below its own average is calm, not
 * fearful.
 *
 * @param series - Date-aligned close series from `alignSeries`.
 * @param t - Index into `series.dates`.
 * @returns The five raw factor values, or `null` when any window is not yet
 *   fully populated at `t`.
 *
 * @internal Used by the walk-forward module.
 */
export function computeMarketFactorsAtT(
    series: AlignedMarketSeries,
    t: number
): MarketFactorValues | null {
    const { closes } = series;
    const w = MARKET_FEAR_GREED_WINDOWS;

    const momentum = distanceFromMa(closes.sp500, t, w.MOMENTUM_MA);
    const vixDistance = distanceFromMa(closes.vix, t, w.VOLATILITY_MA);
    const sp500Return = returnOver(closes.sp500, t, w.RETURN);
    const treasuryReturn = returnOver(closes.longTreasury, t, w.RETURN);
    const highYieldReturn = returnOver(closes.highYield, t, w.RETURN);
    const investmentGradeReturn = returnOver(
        closes.investmentGrade,
        t,
        w.RETURN
    );
    const equalWeightReturn = returnOver(closes.equalWeight, t, w.RETURN);

    if (
        momentum === null ||
        vixDistance === null ||
        sp500Return === null ||
        treasuryReturn === null ||
        highYieldReturn === null ||
        investmentGradeReturn === null ||
        equalWeightReturn === null
    ) {
        return null;
    }

    return {
        momentum,
        volatility: -vixDistance,
        safeHaven: sp500Return - treasuryReturn,
        junkBond: highYieldReturn - investmentGradeReturn,
        breadth: equalWeightReturn - sp500Return,
    };
}
