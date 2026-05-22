import type { Tier } from '@/domain/types';

/**
 * @deprecated Use {@link Tier} directly.
 * Kept as a backward-compatible alias; the canonical type is {@link Tier} in `domain/types.ts`.
 *
 * Subscription tier persisted on user records. Mirrors the `Tier` union from
 * `domain/types.ts` so consumers can reference either name interchangeably.
 */
export type UserTier = Tier;

/**
 * @port
 * Persistence operations required by tier-gating use-cases.
 *
 * Adapters are owned by consumers (Drizzle/Neon implementations live in the
 * consuming application); `siglens-core` declares only the contract the
 * domain depends on.
 */
export interface UserTierRepository {
    /**
     * Find the tier currently assigned to a user.
     *
     * @param userId - User UUID to look up.
     * @returns The persisted tier, or null when the user does not exist.
     */
    getUserTier(userId: string): Promise<Tier | null>;

    /**
     * Manually update a user's tier.
     *
     * @param userId - User UUID to update.
     * @param tier - New tier to persist.
     * @returns The updated tier, or null when the user does not exist.
     */
    updateUserTier(userId: string, tier: Tier): Promise<Tier | null>;
}
