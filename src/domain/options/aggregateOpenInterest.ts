import type { OptionsChain, StrikeOpenInterest } from './types';

/**
 * Aggregate call/put open interest per strike, sorted ascending by strike.
 * Missing sides are filled with 0.
 *
 * @param chain - Options chain for a single expiration.
 * @returns Strike-grouped OI totals; readonly so downstream consumers must
 *   not mutate the result.
 */
export function aggregateOpenInterest(
    chain: OptionsChain
): ReadonlyArray<StrikeOpenInterest> {
    const map = new Map<number, StrikeOpenInterest>();
    for (const c of chain.calls) {
        const prev = map.get(c.strike);
        map.set(c.strike, {
            strike: c.strike,
            callOpenInterest: (prev?.callOpenInterest ?? 0) + c.openInterest,
            putOpenInterest: prev?.putOpenInterest ?? 0,
        });
    }
    for (const p of chain.puts) {
        const prev = map.get(p.strike);
        map.set(p.strike, {
            strike: p.strike,
            callOpenInterest: prev?.callOpenInterest ?? 0,
            putOpenInterest: (prev?.putOpenInterest ?? 0) + p.openInterest,
        });
    }
    return Array.from(map.values()).toSorted((a, b) => a.strike - b.strike);
}
