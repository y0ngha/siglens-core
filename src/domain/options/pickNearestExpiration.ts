import type { OptionsSnapshot } from '@/domain/types';

const PREFERRED_MIN_DAYS = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * @internal Pick the nearest expiration that's ≥ `now + 3 days` to avoid
 * 0DTE/near-expiry noise (gamma blow-ups, single-event distortions). If every
 * available expiration is within 3 days, fall back to the earliest one ≥
 * `now`. Returns null when no future expiration exists (NoChains-like edge).
 *
 * `snapshot.chains` is documented as ascending-sorted by `expirationDate`, so
 * the parsed list is also ascending and `.find()` returns the first hit per
 * branch. Each expirationDate is parsed exactly once (map cache) — we do not
 * re-call `Date.parse` inside the subsequent filter/find passes.
 *
 * Used only by the overall dependency resolver; not re-exported from the
 * package public surface.
 */
export function pickNearestExpiration(
    snapshot: OptionsSnapshot,
    now: Date
): string | null {
    const nowMs = now.getTime();
    const preferredMinMs = nowMs + PREFERRED_MIN_DAYS * MS_PER_DAY;

    const futureChains = snapshot.chains
        .map(chain => ({ chain, ms: Date.parse(chain.expirationDate) }))
        .filter(({ ms }) => !Number.isNaN(ms) && ms >= nowMs);

    const preferred = futureChains.find(({ ms }) => ms >= preferredMinMs);
    if (preferred !== undefined) return preferred.chain.expirationDate;

    return futureChains[0]?.chain.expirationDate ?? null;
}
