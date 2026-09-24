import { sma } from '@/domain/indicators/utils';

/**
 * Simple return over `window` sessions ending at `t`, or `null` when the
 * lookback runs past the start of the series or its base close is non-positive.
 *
 * @param closes - Date-aligned close series.
 * @param t - Index of the session the return ends at.
 * @param window - Lookback length in sessions.
 * @returns `closes[t] / closes[t - window] - 1`, or `null` when uncomputable.
 *
 * @internal Shared by the market-wide and crypto Fear & Greed factor modules.
 */
export function returnOver(
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

/**
 * Relative distance of `closes[t]` from its `window`-session simple moving
 * average (the average includes `closes[t]` itself).
 *
 * @param closes - Date-aligned close series.
 * @param t - Index of the session being measured.
 * @param window - Moving-average length in sessions.
 * @returns `(closes[t] - MA) / MA`, or `null` when the window is not yet fully
 *   populated at `t` or the average is non-positive.
 *
 * @internal Shared by the market-wide and crypto Fear & Greed factor modules.
 */
export function distanceFromMa(
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
