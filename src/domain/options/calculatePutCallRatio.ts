import type { OptionsChain } from './types';

/**
 * @internal Compute the put/call ratio = sum(put OI) / sum(call OI).
 *
 * Implementation detail consumed by {@link summarizeChainForLlm}.
 *
 * @param chain - Options chain for a single expiration.
 * @returns The put/call OI ratio, or `null` when the ratio is undefined.
 *   `null` (rather than `+Infinity`) keeps `JSON.stringify` honest when the
 *   metric flows into LLM prompts — `JSON.stringify(Infinity)` produces the
 *   literal `"null"`, which the model would misread as a valid value.
 *   Returns `null` when:
 *   - call OI is 0 (ratio is mathematically undefined; treat as "no call
 *     positioning to compare against")
 *   - both sides have zero OI (no positioning to report)
 */
export function calculatePutCallRatio(chain: OptionsChain): number | null {
    const callOi = chain.calls.reduce((s, c) => s + c.openInterest, 0);
    const putOi = chain.puts.reduce((s, p) => s + p.openInterest, 0);
    if (callOi === 0) return null;
    return putOi / callOi;
}
