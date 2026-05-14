import { aggregateOpenInterest } from './aggregateOpenInterest';
import { calculateImpliedMove } from './calculateImpliedMove';
import { calculateMaxPain } from './calculateMaxPain';
import { calculatePutCallRatio } from './calculatePutCallRatio';
import type { OptionsChain, OptionsExpirationMetrics } from './types';

/**
 * Reduce an OptionsChain (potentially hundreds of strikes) to the metrics
 * the AI needs. Used by `buildOptionsAnalysisPrompt` and by overall-axis
 * integration. Keeps prompt token count bounded.
 *
 * @param chain - The expiration's chain.
 * @param underlyingPrice - When the caller knows the spot price (typically
 *   from the parent snapshot), pass it so `pickAtmIv` anchors on the actual
 *   ATM strike. Without it, the helper falls back to the median strike,
 *   which is a rougher proxy and can be misleading on skewed chains.
 */
export function summarizeChainForLlm(
    chain: OptionsChain,
    underlyingPrice?: number
): OptionsExpirationMetrics {
    const atmIv = pickAtmIv(chain, underlyingPrice);
    const oiByStrike = aggregateOpenInterest(chain);
    const top = [...oiByStrike]
        .sort(
            (a, b) =>
                b.callOpenInterest +
                b.putOpenInterest -
                (a.callOpenInterest + a.putOpenInterest)
        )
        .slice(0, 3);

    return {
        expirationDate: chain.expirationDate,
        maxPain: calculateMaxPain(chain),
        putCallRatio: calculatePutCallRatio(chain),
        atmImpliedVolatility: atmIv,
        topOpenInterestStrikes: top,
        impliedMovePercent: calculateImpliedMove(atmIv, chain.daysToExpiration),
    };
}

function pickAtmIv(
    chain: OptionsChain,
    underlyingPrice: number | undefined
): number | null {
    const all = [...chain.calls, ...chain.puts];
    if (all.length === 0) return null;
    // ATM proxy: contract with smallest |strike - anchor|. Prefer the real
    // underlying spot when provided; otherwise fall back to the median
    // strike (good enough for balanced chains).
    let anchor: number;
    if (
        typeof underlyingPrice === 'number' &&
        Number.isFinite(underlyingPrice)
    ) {
        anchor = underlyingPrice;
    } else {
        const strikes = all.map(c => c.strike).sort((a, b) => a - b);
        anchor = strikes[Math.floor(strikes.length / 2)];
    }

    let best: { distance: number; iv: number } | null = null;
    for (const c of all) {
        if (c.impliedVolatility === null) continue;
        const distance = Math.abs(c.strike - anchor);
        if (best === null || distance < best.distance) {
            best = { distance, iv: c.impliedVolatility };
        }
    }
    return best?.iv ?? null;
}
