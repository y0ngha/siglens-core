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
 * Sanitize a raw options chain — drop malformed contracts and reject the
 * chain entirely when the bad-data ratio is too high.
 *
 * The reject rule fires only when *both* conditions are met on at least one
 * side (calls or puts):
 * 1. invalid contract count ≥ `MIN_INVALID_TO_REJECT` (absolute floor that
 *    prevents micro-cap chains with a single bad row from being discarded);
 * 2. invalid / total > 5% (the ratio threshold).
 *
 * Invalid contracts are those with negative open-interest or negative
 * volume. Duplicate-strike deduplication is always applied regardless of
 * the chain's verdict, and duplicates do NOT count toward the reject ratio
 * (dedup is a normalization concern, not a data-quality signal).
 *
 * @param chain - Raw provider chain that may include malformed rows.
 * @returns Sanitized chain when the data is trustworthy, or `null` when
 *   the chain should be rejected entirely.
 */
export function sanitizeOptionsChain(chain: OptionsChain): OptionsChain | null {
    const { valid: validCalls, invalidCount: invalidCalls } =
        partitionContracts(chain.calls);
    const { valid: validPuts, invalidCount: invalidPuts } = partitionContracts(
        chain.puts
    );

    if (shouldReject(invalidCalls, chain.calls.length)) return null;
    if (shouldReject(invalidPuts, chain.puts.length)) return null;

    return {
        ...chain,
        calls: validCalls,
        puts: validPuts,
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

/**
 * Single-pass partition: collects dedup'd valid contracts and the invalid
 * count in one iteration so `isInvalidContract` is evaluated exactly once
 * per contract (vs. the prior two-pass `filter().length` + `filterValid`
 * shape, which evaluated the predicate twice).
 *
 * `valid` is a function-local accumulator. A purely declarative
 * `reduce(...spread, ...)` here would be O(N²) since each step rebuilds
 * the result array. `valid.push` keeps the iteration O(N) and the
 * mutation never escapes this function.
 *
 * Duplicate strikes are skipped silently (they do NOT count toward
 * `invalidCount`); dedup is a normalization concern, not a data-quality
 * signal — see the file-top JSDoc.
 */
function partitionContracts(contracts: ReadonlyArray<OptionsContract>): {
    valid: OptionsContract[];
    invalidCount: number;
} {
    const seen = new Set<number>();
    const valid: OptionsContract[] = [];
    let invalidCount = 0;
    for (const c of contracts) {
        if (isInvalidContract(c)) {
            invalidCount++;
            continue;
        }
        if (seen.has(c.strike)) continue;
        seen.add(c.strike);
        valid.push(c);
    }
    return { valid, invalidCount };
}
