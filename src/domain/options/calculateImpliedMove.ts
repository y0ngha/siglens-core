const TRADING_DAYS_BASIS = 365;

/**
 * @internal Compute the implied move for an expiration as ±% of underlying.
 *
 * Formula: atmIv * sqrt(daysToExpiration / 365) * 100. Implementation
 * detail consumed by {@link summarizeChainForLlm}.
 *
 * @param atmIv - ATM implied volatility as a fraction (0.25 = 25%). null when unavailable.
 * @param daysToExpiration - Calendar days until expiration. Must be > 0.
 * @returns Implied move in ± percent units (e.g., 4.2 means ±4.2%), or null.
 */
export function calculateImpliedMove(
    atmIv: number | null,
    daysToExpiration: number
): number | null {
    if (atmIv === null) return null;
    if (daysToExpiration <= 0) return null;
    return atmIv * Math.sqrt(daysToExpiration / TRADING_DAYS_BASIS) * 100;
}
