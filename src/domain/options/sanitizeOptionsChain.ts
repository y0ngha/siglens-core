import type { OptionsChain, OptionsContract } from './types';

const INVALID_THRESHOLD = 0.05; // 5%

/**
 * Drop malformed contracts (negative OI/volume, duplicate strikes). If more
 * than 5% of contracts are invalid (negative OI/volume) on either side,
 * returns null — the chain is considered unreliable and should not be
 * displayed. Duplicate-strike deduplication is always applied regardless.
 */
export function sanitizeOptionsChain(chain: OptionsChain): OptionsChain | null {
    const totalCalls = chain.calls.length;
    const totalPuts = chain.puts.length;

    const invalidCalls = chain.calls.filter(isInvalidContract).length;
    const invalidPuts = chain.puts.filter(isInvalidContract).length;

    if (totalCalls > 0 && invalidCalls >= 2 && invalidCalls / totalCalls > INVALID_THRESHOLD) return null;
    if (totalPuts > 0 && invalidPuts >= 2 && invalidPuts / totalPuts > INVALID_THRESHOLD) return null;

    return {
        ...chain,
        calls: filterValid(chain.calls),
        puts: filterValid(chain.puts),
    };
}

function isInvalidContract(c: OptionsContract): boolean {
    return c.openInterest < 0 || c.volume < 0;
}

function filterValid(
    contracts: ReadonlyArray<OptionsContract>
): ReadonlyArray<OptionsContract> {
    const seen = new Set<number>();
    return contracts.filter(c => {
        if (c.openInterest < 0) return false;
        if (c.volume < 0) return false;
        if (c.strike === null || c.strike === undefined) return false;
        if (seen.has(c.strike)) return false;
        seen.add(c.strike);
        return true;
    });
}
