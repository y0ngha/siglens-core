import type { OptionsSnapshot } from '@/domain/types';

const PREFERRED_MIN_DAYS = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Pick the nearest expiration that's ≥ `now + 3 days` to avoid 0DTE/near-expiry
 * noise (gamma blow-ups, single-event distortions). If every available
 * expiration is within 3 days, fall back to the earliest one ≥ `now`. Returns
 * null when no future expiration exists (NoChains-like edge).
 *
 * `snapshot.chains` is documented as ascending-sorted by `expirationDate`, so
 * we scan once and return the first hit per branch.
 */
export function pickNearestExpiration(
    snapshot: OptionsSnapshot,
    now: Date
): string | null {
    const nowMs = now.getTime();
    const preferredMinMs = nowMs + PREFERRED_MIN_DAYS * MS_PER_DAY;

    let earliestFuture: string | null = null;
    for (const chain of snapshot.chains) {
        const ms = Date.parse(chain.expirationDate);
        if (Number.isNaN(ms)) continue;
        if (ms < nowMs) continue;
        if (earliestFuture === null) earliestFuture = chain.expirationDate;
        if (ms >= preferredMinMs) return chain.expirationDate;
    }
    return earliestFuture;
}
