import { aggregateOpenInterest } from './aggregateOpenInterest';
import { calculateImpliedMove } from './calculateImpliedMove';
import { calculateMaxPain } from './calculateMaxPain';
import { calculatePutCallRatio } from './calculatePutCallRatio';
import type { OptionsChain, OptionsExpirationMetrics } from './types';

/**
 * Reduce an OptionsChain (potentially hundreds of strikes) to the metrics
 * the AI needs. Used by buildOptionsAnalysisPrompt and by overall axis
 * integration. Keeps prompt token count bounded.
 */
export function summarizeChainForLlm(
    chain: OptionsChain
): OptionsExpirationMetrics {
    const atmIv = pickAtmIv(chain);
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

function pickAtmIv(chain: OptionsChain): number | null {
    const all = [...chain.calls, ...chain.puts];
    if (all.length === 0) return null;
    // ATM proxy: contract with smallest |strike - midprice|. Without an explicit
    // underlying price, use median strike as a rough anchor.
    const strikes = all.map(c => c.strike).sort((a, b) => a - b);
    const median = strikes[Math.floor(strikes.length / 2)];
    let best: { distance: number; iv: number } | null = null;
    for (const c of all) {
        if (c.impliedVolatility === null) continue;
        const distance = Math.abs(c.strike - median);
        if (best === null || distance < best.distance) {
            best = { distance, iv: c.impliedVolatility };
        }
    }
    return best?.iv ?? null;
}
