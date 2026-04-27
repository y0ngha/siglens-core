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
 *
 * @param input - Session token stored in the auth cookie.
 * @param dependencies - Session repository injected by the caller.
 * @param options - Runtime overrides for cookie name, secure flag, SameSite, and path.
 * @returns `{ ok: true, sessionInvalidated, cookie }` — `sessionInvalidated` indicates whether a row was deleted.
 *
 * @example
 * ```typescript
 * const result = await logoutUser(
 *     { sessionToken: cookies.get('siglens_session') },
 *     { sessions: drizzleSessionRepository },
 * );
 * response.setHeader('Set-Cookie', serializeCookie(result.cookie));
 * ```
 *
 * @see {@link LogoutUserDependencies} for the dependency injection contract.
 * @see {@link LogoutUserOptions} for available runtime overrides.
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
