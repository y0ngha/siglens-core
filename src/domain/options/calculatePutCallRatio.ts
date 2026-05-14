import type { OptionsChain } from './types';

/**
 * Compute the put/call ratio = sum(put OI) / sum(call OI).
 *
 * - When call OI is 0 and put OI > 0, returns +Infinity (caller should treat
 *   as "extreme bearish positioning").
 * - When both are 0, returns 0 (no positioning to report).
 */
export function calculatePutCallRatio(chain: OptionsChain): number {
    const callOi = chain.calls.reduce((s, c) => s + c.openInterest, 0);
    const putOi = chain.puts.reduce((s, p) => s + p.openInterest, 0);
    if (callOi === 0 && putOi === 0) return 0;
    if (callOi === 0) return Number.POSITIVE_INFINITY;
    return putOi / callOi;
}
