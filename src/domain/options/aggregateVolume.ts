import type { OptionsChain, StrikeVolumeAggregate } from './types';

/**
 * @internal Aggregate call/put trade volume per strike for a single
 * expiration.
 *
 * Returns one entry per unique strike with the call and put volume summed
 * independently; sides that have no contract at a given strike contribute
 * `0`. The result is sorted ascending by strike so consumers can render or
 * lookup with stable ordering.
 *
 * @param chain - Options chain for a single expiration.
 * @returns Strike-grouped volume totals sorted ascending by strike; readonly
 *   so downstream consumers must not mutate the result.
 */
export function aggregateVolume(
    chain: OptionsChain
): ReadonlyArray<StrikeVolumeAggregate> {
    const map = new Map<number, StrikeVolumeAggregate>();
    for (const c of chain.calls) {
        const prev = map.get(c.strike);
        map.set(c.strike, {
            strike: c.strike,
            callVolume: (prev?.callVolume ?? 0) + c.volume,
            putVolume: prev?.putVolume ?? 0,
        });
    }
    for (const p of chain.puts) {
        const prev = map.get(p.strike);
        map.set(p.strike, {
            strike: p.strike,
            callVolume: prev?.callVolume ?? 0,
            putVolume: (prev?.putVolume ?? 0) + p.volume,
        });
    }
    return Array.from(map.values()).sort((a, b) => a.strike - b.strike);
}
