import type { OptionsChain } from './types';

export interface StrikeOpenInterest {
    strike: number;
    callOpenInterest: number;
    putOpenInterest: number;
}

/**
 * Aggregate call/put open interest per strike, sorted ascending by strike.
 * Missing sides are filled with 0.
 */
export function aggregateOpenInterest(
    chain: OptionsChain
): ReadonlyArray<StrikeOpenInterest> {
    const map = new Map<number, StrikeOpenInterest>();
    for (const c of chain.calls) {
        const entry = map.get(c.strike) ?? {
            strike: c.strike,
            callOpenInterest: 0,
            putOpenInterest: 0,
        };
        entry.callOpenInterest += c.openInterest;
        map.set(c.strike, entry);
    }
    for (const p of chain.puts) {
        const entry = map.get(p.strike) ?? {
            strike: p.strike,
            callOpenInterest: 0,
            putOpenInterest: 0,
        };
        entry.putOpenInterest += p.openInterest;
        map.set(p.strike, entry);
    }
    return Array.from(map.values()).sort((a, b) => a.strike - b.strike);
}
