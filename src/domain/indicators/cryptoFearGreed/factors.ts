import type {
    AlignedCryptoSeries,
    CryptoFactorValues,
} from '@/domain/indicators/cryptoFearGreed/types';
import {
    distanceFromMa,
    returnOver,
} from '@/domain/indicators/fearGreed/returns';

/**
 * Rolling windows, in sessions of the 7-day crypto calendar. Chosen during the
 * 2026-09-25 validation against alternative.me's crypto index: 90 sessions is
 * the alt-season window that tracked it best (30/60 were noisier), and 30
 * sessions for downside volatility and volume flow.
 *
 * @internal
 */
export const CRYPTO_FEAR_GREED_WINDOWS = {
    MOMENTUM_MA: 125,
    DOWNSIDE_VOLATILITY: 30,
    SAFE_HAVEN: 20,
    BREADTH_MA: 50,
    ALT_SEASON: 90,
    VOLUME_FLOW: 30,
} as const;

/**
 * First index at which every factor window is fully populated. Sessions before
 * this index produce `null` factors and therefore a `null` history score.
 *
 * @internal
 */
export const CRYPTO_FEAR_GREED_WARMUP = Math.max(
    CRYPTO_FEAR_GREED_WINDOWS.MOMENTUM_MA - 1,
    CRYPTO_FEAR_GREED_WINDOWS.ALT_SEASON,
    CRYPTO_FEAR_GREED_WINDOWS.DOWNSIDE_VOLATILITY,
    CRYPTO_FEAR_GREED_WINDOWS.VOLUME_FLOW
);

/**
 * Minimum number of universe coins. Below it, breadth and alt-season are shares
 * of a handful of coins and swing in coarse jumps, so the index returns `null`.
 *
 * @internal
 */
export const CRYPTO_FEAR_GREED_MIN_UNIVERSE = 5;

/**
 * Negated downside semi-deviation: `−sqrt(mean(min(0, ln(Cᵢ/Cᵢ₋₁))²))` over the
 * `window` log returns ending at `t`. Up-days contribute zero, so a rally never
 * reads as fear — plain realized volatility failed validation for exactly that
 * reason (crypto volatility spikes on rallies too).
 */
function downsideVolatility(
    closes: number[],
    t: number,
    window: number
): number | null {
    if (t < window) return null;
    let sumSq = 0;
    for (let i = t - window + 1; i <= t; i++) {
        const r = Math.min(0, Math.log(closes[i] / closes[i - 1]));
        sumSq += r * r;
    }
    const deviation = Math.sqrt(sumSq / window);
    // Avoid returning -0 for an all-up window: `Intl.NumberFormat` renders it as "-0".
    return deviation === 0 ? 0 : -deviation;
}

/**
 * Share of total quote volume over the `window` sessions ending at `t` that
 * traded on benchmark up-days (close ≥ previous close). `null` when the window
 * is not populated or carries no volume at all.
 */
function volumeFlow(
    benchmark: number[],
    totalVolume: number[],
    t: number,
    window: number
): number | null {
    if (t < window) return null;
    let up = 0;
    let total = 0;
    for (let i = t - window + 1; i <= t; i++) {
        total += totalVolume[i];
        if (benchmark[i] >= benchmark[i - 1]) up += totalVolume[i];
    }
    return total > 0 ? up / total : null;
}

/** Share of `coins` whose close at `t` is above their own `window`-session MA. */
function breadth(coins: number[][], t: number, window: number): number | null {
    let above = 0;
    for (const closes of coins) {
        const distance = distanceFromMa(closes, t, window);
        if (distance === null) return null;
        if (distance > 0) above++;
    }
    return above / coins.length;
}

/** Share of `universe` coins whose `window`-session return beats the benchmark's. */
function altSeason(
    benchmark: number[],
    universe: number[][],
    t: number,
    window: number
): number | null {
    const benchmarkReturn = returnOver(benchmark, t, window);
    if (benchmarkReturn === null) return null;
    let beating = 0;
    for (const closes of universe) {
        const coinReturn = returnOver(closes, t, window);
        if (coinReturn === null) return null;
        if (coinReturn > benchmarkReturn) beating++;
    }
    return beating / universe.length;
}

/**
 * Raw factor bundle for session `t`, using only sessions ≤ `t` (no look-ahead).
 *
 * Every factor is oriented so a larger value means *greedier*.
 *
 * @param series - Aligned series from `alignCryptoSeries`. `universe` must be
 *   non-empty (the walk-forward module enforces the minimum universe size).
 * @param t - Index into `series.dates`.
 * @returns The six raw factor values, or `null` when any window is not yet
 *   fully populated at `t` or a factor is otherwise uncomputable.
 *
 * @internal Used by the crypto walk-forward module.
 */
export function computeCryptoFactorsAtT(
    series: AlignedCryptoSeries,
    t: number
): CryptoFactorValues | null {
    const { benchmark, safeHaven, universe, totalVolume } = series;
    const w = CRYPTO_FEAR_GREED_WINDOWS;

    const momentum = distanceFromMa(benchmark, t, w.MOMENTUM_MA);
    const downside = downsideVolatility(benchmark, t, w.DOWNSIDE_VOLATILITY);
    const benchmarkReturn = returnOver(benchmark, t, w.SAFE_HAVEN);
    const havenReturn = returnOver(safeHaven, t, w.SAFE_HAVEN);
    const breadthShare = breadth([benchmark, ...universe], t, w.BREADTH_MA);
    const altShare = altSeason(benchmark, universe, t, w.ALT_SEASON);
    const flow = volumeFlow(benchmark, totalVolume, t, w.VOLUME_FLOW);

    if (
        momentum === null ||
        downside === null ||
        benchmarkReturn === null ||
        havenReturn === null ||
        breadthShare === null ||
        altShare === null ||
        flow === null
    ) {
        return null;
    }

    return {
        momentum,
        downside_volatility: downside,
        safe_haven: benchmarkReturn - havenReturn,
        breadth: breadthShare,
        alt_season: altShare,
        volume_flow: flow,
    };
}
