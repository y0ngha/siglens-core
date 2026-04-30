import { createExpiredSessionCookie } from './sessionCookie';
import type {
    DeleteAccountDependencies,
    DeleteAccountError,
    DeleteAccountInput,
    DeleteAccountOptions,
    DeleteAccountResult,
} from './types';

function revokeOAuthTokensFireAndForget(
    userId: string,
    dependencies: Pick<DeleteAccountDependencies, 'oauthAccounts' | 'oauthRevoker'>
): void {
    dependencies.oauthAccounts
        .findByUserId(userId)
        .then(accounts => {
            for (const account of accounts) {
                if (account.accessToken === null) {
                    continue;
                }
                dependencies.oauthRevoker
                    .revokeToken(account.provider, {
                        accessToken: account.accessToken,
                        refreshToken: account.refreshToken,
                    })
                    .catch(() => undefined);
            }
        })
        .catch(() => undefined);
}

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
 * On success, expired HTTP-only cookie metadata is returned so the caller
 * can clear the browser-side session cookie in the same response — mirroring
 * the {@link logoutUser} contract.
 *
 * @param input - User identifier to delete.
 * @param dependencies - User repository injected by the caller.
 * @param options - Runtime overrides for cookie name, secure flag, SameSite, and path.
 * @returns `{ ok: true, cookie }` on success, or `{ ok: false, error: { code: 'user_not_found' } }` when no row matched.
 *
 * @example
 * ```typescript
 * const result = await deleteAccount(
 *     { userId: session.userId },
 *     { users: drizzleUserRepository },
 * );
 * if (result.ok) {
 *     response.setHeader('Set-Cookie', serializeCookie(result.cookie));
 * }
 * ```
 *
 * @see {@link DeleteAccountDependencies} for the dependency injection contract.
 * @see {@link DeleteAccountOptions} for available runtime overrides.
 */
export async function deleteAccount(
    input: DeleteAccountInput,
    dependencies: DeleteAccountDependencies,
    options: DeleteAccountOptions = {}
): Promise<DeleteAccountResult> {
    revokeOAuthTokensFireAndForget(input.userId, dependencies);

    const deleted = await dependencies.users.deleteUser(input.userId);

    if (!deleted) {
        return { ok: false, error: userNotFoundError() };
    }

    const cookie = createExpiredSessionCookie({
        name: options.cookieName,
        secure: options.secureCookie,
        sameSite: options.sameSite,
        path: options.path,
    });

    return { ok: true, cookie };
}
