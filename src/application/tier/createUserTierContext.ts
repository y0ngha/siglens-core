import { DEFAULT_TIER } from '@/domain/tier';
import type {
    CreateUserTierContextInput,
    CreateUserTierContextResult,
    UserTierDependencies,
} from './types';

/**
 * Build request-scoped tier context for middleware/server handlers.
 *
 * Anonymous requests receive the default free tier; authenticated requests
 * receive the persisted tier or fall back to free when the account is missing.
 */
export async function createUserTierContext(
    input: CreateUserTierContextInput,
    dependencies: UserTierDependencies
): Promise<CreateUserTierContextResult> {
    const userId = input.userId ?? null;
    const tier =
        userId === null
            ? DEFAULT_TIER
            : ((await dependencies.users.getUserTier(userId)) ?? DEFAULT_TIER);

    return { userId, tier };
}
