import { EWMA_LAMBDA } from './constants';

/**
 * @internal EWMA (Exponentially Weighted Moving Average) volatility — RiskMetrics model.
 *
 * Log returns: r_t = ln(close_t / close_{t-1})  for t ≥ 1.
 * Variance recursion (O(N) accumulator — justified: each variance estimate depends on
 * the prior estimate; a purely functional map would require re-computing the full
 * history per bar, turning O(N) into O(N²)):
 *   seed: var_1 = r_1²  (single-observation bootstrap)
 *   var_t = λ · var_{t-1} + (1 − λ) · r_t²
 * Result: sqrt(var_t).  Index 0 → null (no prior close).
 *
 * Guards:
 *   - Non-positive closes: skip that bar, propagate previous variance unchanged.
 *   - If no valid prior variance exists yet: null.
 */
export function calculateEwmaVolatility(
    closes: number[],
    lambda = EWMA_LAMBDA
): (number | null)[] {
    const n = closes.length;
    if (n === 0) return [];
    if (n === 1) return [null];

    const oneMinusLambda = 1 - lambda;
    const result: (number | null)[] = new Array(n);
    result[0] = null;

    // O(N) recursive accumulator — see JSDoc above for justification.
    let prevVar: number | null = null;

    for (let i = 1; i < n; i++) {
        const prevClose = closes[i - 1];
        const currClose = closes[i];

        // Guard: skip if either close is non-positive (ln undefined)
        if (prevClose <= 0 || currClose <= 0) {
            result[i] = prevVar !== null ? Math.sqrt(prevVar) : null;
            continue;
        }

        const r = Math.log(currClose / prevClose);
        const rSq = r * r;

        if (prevVar === null) {
            // Seed: bootstrap with r_1²
            prevVar = rSq;
        } else {
            prevVar = lambda * prevVar + oneMinusLambda * rSq;
        }

        result[i] = Math.sqrt(prevVar);
    }

    return result;
}
