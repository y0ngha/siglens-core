import type { OptionsChain } from './types';

/**
 * Compute the put/call ratio = sum(put OI) / sum(call OI).
 *
 * @param chain - Options chain for a single expiration.
 * @returns The put/call OI ratio. `+Infinity` when call OI is 0 with non-
 *   zero put OI (treat as "extreme bearish positioning"). `0` when both
 *   sides have zero OI (no positioning to report).
 */
export function calculatePutCallRatio(chain: OptionsChain): number {
    const callOi = chain.calls.reduce((s, c) => s + c.openInterest, 0);
    const putOi = chain.puts.reduce((s, p) => s + p.openInterest, 0);
    if (callOi === 0 && putOi === 0) return 0;
    if (callOi === 0) return Number.POSITIVE_INFINITY;
    return putOi / callOi;
}
