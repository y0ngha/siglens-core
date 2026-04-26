import type {
    SetUserTierError,
    SetUserTierInput,
    SetUserTierResult,
    UserTierDependencies,
} from './types';

const USER_NOT_FOUND_MESSAGE = 'User was not found';

function userNotFoundError(): SetUserTierError {
    return {
        code: 'user_not_found',
        message: USER_NOT_FOUND_MESSAGE,
    };
}

/**
 * Manually change a user's tier for admin workflows.
 */
export async function setUserTier(
    input: SetUserTierInput,
    dependencies: UserTierDependencies
): Promise<SetUserTierResult> {
    const tier = await dependencies.users.updateUserTier(
        input.userId,
        input.tier
    );

    return tier === null
        ? { ok: false, error: userNotFoundError() }
        : { ok: true, userId: input.userId, tier };
}
