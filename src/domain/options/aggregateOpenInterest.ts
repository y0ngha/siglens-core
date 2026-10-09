import type { OptionsChain, StrikeOpenInterest } from './types';

/**
 * Aggregate call/put open interest per strike for a single expiration.
 *
 * Returns one entry per unique strike with the call and put OI summed
 * independently; sides that have no contract at a given strike contribute
 * `0`. The result is sorted ascending by strike so consumers can render or
 * lookup with stable ordering.
 *
 * @param chain - Options chain for a single expiration.
 * @returns Strike-grouped OI totals sorted ascending by strike; readonly so
 *   downstream consumers must not mutate the result.
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
    return Array.from(map.values()).sort((a, b) => a.strike - b.strike);
}
