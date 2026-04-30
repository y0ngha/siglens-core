import { createExpiredSessionCookie } from './sessionCookie';
import type { OAuthAccountRecord } from '@/infrastructure/db/types';
import type {
    DeleteAccountDependencies,
    DeleteAccountError,
    DeleteAccountInput,
    DeleteAccountOptions,
    DeleteAccountResult,
} from './types';

type RevocableOAuthAccount = Omit<OAuthAccountRecord, 'accessToken'> & {
    accessToken: string;
};

function hasAccessToken(
    account: OAuthAccountRecord
): account is RevocableOAuthAccount {
    return account.accessToken !== null;
}

async function findOAuthAccountsForRevocation(
    userId: string,
    dependencies: Pick<DeleteAccountDependencies, 'oauthAccounts'>
): Promise<OAuthAccountRecord[]> {
    try {
        return await dependencies.oauthAccounts.findByUserId(userId);
    } catch (error) {
        console.warn(
            '[deleteAccount] findByUserId for OAuth revocation failed',
            error
        );
        return [];
    }
}

async function revokeOAuthTokens(
    userId: string,
    dependencies: Pick<
        DeleteAccountDependencies,
        'oauthAccounts' | 'oauthRevoker'
    >
): Promise<void> {
    const accounts = await findOAuthAccountsForRevocation(userId, dependencies);

    const revocableAccounts: RevocableOAuthAccount[] =
        accounts.filter(hasAccessToken);

    revocableAccounts.forEach(account => {
        void dependencies.oauthRevoker
            .revokeToken(account.provider, {
                accessToken: account.accessToken,
                refreshToken: account.refreshToken,
            })
            .catch(error => {
                console.warn('[deleteAccount] OAuth revokeToken failed', error);
            });
    });
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
    await revokeOAuthTokens(input.userId, dependencies);

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
