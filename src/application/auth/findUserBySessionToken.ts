import type { AuthUserRecord } from '@/infrastructure/db/types';
import type {
    FindUserBySessionTokenDependencies,
    FindUserBySessionTokenOptions,
} from './types';

/**
 * Resolve a session cookie token to its owning user.
 *
 * Looks up the persisted session by token, rejects sessions whose
 * `expiresAt` falls at or before the current time, and returns the
 * associated user record. Returns `null` when the token is unknown,
 * the session has expired, or the user no longer exists.
 *
 * Expired sessions are not deleted by this function — invalidation
 * and cookie clearing remain the caller's responsibility.
 *
 * @param sessionToken - Session identifier read from the auth cookie.
 * @param dependencies - Repositories injected by the caller.
 * @param options - Runtime overrides; `now` defaults to the current system time.
 * @returns The matching {@link AuthUserRecord}, or `null` when the token is invalid, expired, or unlinked.
 *
 * @example
 * ```typescript
 * const user = await findUserBySessionToken(
 *     cookies.get('siglens_session') ?? '',
 *     { users: drizzleUserRepository, sessions: drizzleSessionRepository },
 * );
 * if (user === null) {
 *     // session is missing or expired — redirect to login
 * }
 * ```
 *
 * @see {@link FindUserBySessionTokenDependencies} for the dependency injection contract.
 */
export async function findUserBySessionToken(
    sessionToken: string,
    dependencies: FindUserBySessionTokenDependencies,
    options: FindUserBySessionTokenOptions = {}
): Promise<AuthUserRecord | null> {
    const session = await dependencies.sessions.findSession(sessionToken);

    if (session === null) {
        return null;
    }

    const now = options.now ?? new Date();

    if (session.expiresAt.getTime() <= now.getTime()) {
        return null;
    }

    return dependencies.users.findById(session.userId);
}
