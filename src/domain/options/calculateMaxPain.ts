import type { OptionsChain } from './types';

/**
 * Compute the max pain strike — the strike at which the total writer
 * (option seller) payoff is minimized. For each candidate strike S, the
 * total payoff is:
 *   - sum over call strikes K: max(S - K, 0) * callOI(K)
 *   - sum over put strikes K:  max(K - S, 0) * putOI(K)
 *
 * @param chain - The options chain for a single expiration.
 * @returns The max pain strike, or NaN if the chain has no contracts.
 */
export function calculateMaxPain(chain: OptionsChain): number {
    const strikes = Array.from(
        new Set([
            ...chain.calls.map(c => c.strike),
            ...chain.puts.map(p => p.strike),
        ])
    ).sort((a, b) => a - b);

    if (strikes.length === 0) return Number.NaN;

    let minPain = Number.POSITIVE_INFINITY;
    let minPainStrike = strikes[0];

    for (const candidate of strikes) {
        let pain = 0;
        for (const c of chain.calls) {
            if (candidate > c.strike) {
                pain += (candidate - c.strike) * c.openInterest;
            }
        }
        for (const p of chain.puts) {
            if (candidate < p.strike) {
                pain += (p.strike - candidate) * p.openInterest;
            }
        }
        if (pain < minPain) {
            minPain = pain;
            minPainStrike = candidate;
        }
    }

    return minPainStrike;
}
