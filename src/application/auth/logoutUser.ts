import type {
    LogoutUserDependencies,
    LogoutUserInput,
    LogoutUserOptions,
    LogoutUserResult,
} from './types';
import { createExpiredSessionCookie } from './sessionCookie';

/**
 * Log out a user by invalidating their persisted session token.
 *
 * Returns expired HTTP-only cookie metadata even when no matching persisted
 * session exists, allowing callers to reliably clear the browser cookie.
 */
export async function logoutUser(
    input: LogoutUserInput,
    dependencies: LogoutUserDependencies,
    options: LogoutUserOptions = {}
): Promise<LogoutUserResult> {
    const sessionInvalidated = await dependencies.sessions.deleteSession(
        input.sessionToken
    );
    const cookie = createExpiredSessionCookie({
        name: options.cookieName,
        secure: options.secureCookie,
        sameSite: options.sameSite,
        path: options.path,
    });

    return { ok: true, sessionInvalidated, cookie };
}
