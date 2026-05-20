/**
 * Calendar-day basis for annualizing IV. Do NOT change to 252 (trading days).
 * The Black-Scholes-style annualization here uses calendar time because IV is
 * quoted on a calendar-year basis by the upstream feed and the consumer scales
 * by `daysToExpiration` which is also a calendar count.
 */
const CALENDAR_DAYS_PER_YEAR = 365;

/**
 * @internal Compute the implied move for an expiration as ±% of underlying.
 *
 * Formula: atmIv * sqrt(daysToExpiration / CALENDAR_DAYS_PER_YEAR) * 100.
 * Both `atmIv` and `daysToExpiration` are calendar-time quantities, so the
 * denominator stays on a 365-day basis. Implementation detail consumed by
 * {@link summarizeChainForLlm}.
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
    return atmIv * Math.sqrt(daysToExpiration / CALENDAR_DAYS_PER_YEAR) * 100;
}
