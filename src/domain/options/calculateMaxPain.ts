import type { OptionsChain } from './types';

/**
 * @internal Compute the max pain strike — the strike at which the total
 * writer (option seller) payoff is minimized. For each candidate strike S,
 * the total payoff is:
 *   - sum over call strikes K: max(S - K, 0) * callOI(K)
 *   - sum over put strikes K:  max(K - S, 0) * putOI(K)
 *
 * Implementation detail consumed by {@link summarizeChainForLlm}.
 *
 * @param chain - The options chain for a single expiration.
 * @returns The max pain strike, or `null` when the chain has no contracts on
 *   either side. `null` (rather than `NaN`) keeps `JSON.stringify` honest
 *   when the metric flows into LLM prompts — `JSON.stringify(NaN)` produces
 *   the literal `"null"`, which the model would misread as a valid value.
 */
export function calculateMaxPain(chain: OptionsChain): number | null {
    const strikes = Array.from(
        new Set([
            ...chain.calls.map(c => c.strike),
            ...chain.puts.map(p => p.strike),
        ])
    ).sort((a, b) => a - b);

    if (strikes.length === 0) return null;

    const computePain = (candidate: number): number =>
        chain.calls.reduce(
            (s, c) =>
                candidate > c.strike
                    ? s + (candidate - c.strike) * c.openInterest
                    : s,
            0
        ) +
        chain.puts.reduce(
            (s, p) =>
                candidate < p.strike
                    ? s + (p.strike - candidate) * p.openInterest
                    : s,
            0
        );

    // `reduce` without an initial value is safe here — `strikes.length === 0`
    // is rejected by the guard above, so the array is guaranteed non-empty.
    // Do NOT add `, { pain: Infinity, strike: 0 }` as a "safety" seed — that
    // would silently produce strike `0` if the guard ever regressed.
    const { strike: minPainStrike } = strikes
        .map(s => ({ strike: s, pain: computePain(s) }))
        .reduce((best, cur) => (cur.pain < best.pain ? cur : best));

    return minPainStrike;
}
