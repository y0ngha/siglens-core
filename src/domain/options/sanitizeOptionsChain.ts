import type { OptionsChain, OptionsContract } from './types';

const INVALID_RATIO_THRESHOLD = 0.05; // 5%

/**
 * Minimum invalid-contract count required to trigger chain-level rejection.
 * Small chains (few-strike fixtures, micro-cap names) routinely surface a
 * single bad row from upstream feeds — we don't treat that as a corrupted
 * chain. The ratio rule only fires when there's enough invalid volume to
 * be statistically meaningful.
 */
const MIN_INVALID_TO_REJECT = 2;

/**
 * Drop malformed contracts (negative OI/volume, duplicate strikes). Returns
 * null when the chain is unreliable — that is, when invalid contracts
 * (negative OI/volume) on either side exceed both the absolute floor
 * (MIN_INVALID_TO_REJECT) and the 5% ratio threshold. Duplicate-strike
 * deduplication is always applied regardless of the chain's verdict, and
 * duplicates do NOT count toward the reject ratio (dedup is a normalization
 * concern, not a data-quality signal).
 */
export function sanitizeOptionsChain(chain: OptionsChain): OptionsChain | null {
    const totalCalls = chain.calls.length;
    const totalPuts = chain.puts.length;

    const invalidCalls = chain.calls.filter(isInvalidContract).length;
    const invalidPuts = chain.puts.filter(isInvalidContract).length;

    if (shouldReject(invalidCalls, totalCalls)) return null;
    if (shouldReject(invalidPuts, totalPuts)) return null;

    return {
        ...chain,
        calls: filterValid(chain.calls),
        puts: filterValid(chain.puts),
    };
}

function isInvalidContract(c: OptionsContract): boolean {
    return c.openInterest < 0 || c.volume < 0;
}

function shouldReject(invalidCount: number, totalCount: number): boolean {
    if (totalCount === 0) return false;
    if (invalidCount < MIN_INVALID_TO_REJECT) return false;
    return invalidCount / totalCount > INVALID_RATIO_THRESHOLD;
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
