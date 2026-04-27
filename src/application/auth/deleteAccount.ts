import type {
    DeleteAccountDependencies,
    DeleteAccountError,
    DeleteAccountInput,
    DeleteAccountResult,
} from './types';

const USER_NOT_FOUND_MESSAGE = 'User account does not exist';

function userNotFoundError(): DeleteAccountError {
    return {
        code: 'user_not_found',
        message: USER_NOT_FOUND_MESSAGE,
    };
}

/**
 * Delete a user account along with its dependent persistence rows.
 *
 * Sessions belonging to the user are removed via the `users → sessions`
 * foreign-key cascade; usage logs have their `userId` set to null per
 * schema policy so that aggregate analytics remain intact.
 *
 * @param input - User identifier to delete.
 * @param dependencies - User repository injected by the caller.
 * @returns `{ ok: true }` on success, or `{ ok: false, error: { code: 'user_not_found' } }` when no row matched.
 *
 * @example
 * ```typescript
 * const result = await deleteAccount(
 *     { userId: session.userId },
 *     { users: drizzleUserRepository },
 * );
 * if (result.ok) {
 *     response.setHeader('Set-Cookie', serializeCookie(expiredCookie));
 * }
 * ```
 *
 * @see {@link DeleteAccountDependencies} for the dependency injection contract.
 */
export async function deleteAccount(
    input: DeleteAccountInput,
    dependencies: DeleteAccountDependencies
): Promise<DeleteAccountResult> {
    const deleted = await dependencies.users.deleteUser(input.userId);

    if (!deleted) {
        return { ok: false, error: userNotFoundError() };
    }

    return { ok: true };
}
