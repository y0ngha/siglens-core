import type { Tier } from '@/domain/types';
import { DEFAULT_TIER } from '@/domain/tier';
import type { GetUserTierInput, UserTierDependencies } from './types';

/**
 * Look up a user's tier from persistence.
 *
 * Missing users degrade to the default free tier so callers can keep request
 * handling deterministic while treating unknown accounts as least privileged.
 */
export async function getUserTier(
    input: GetUserTierInput,
    dependencies: UserTierDependencies
): Promise<Tier> {
    const tier = await dependencies.users.getUserTier(input.userId);

    return tier ?? DEFAULT_TIER;
}
