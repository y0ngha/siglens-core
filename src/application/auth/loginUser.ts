import { normalizeEmail } from '@/domain/auth/validation';
import type {
    AuthUserRecord,
    EmailAuthUserRecord,
} from '@/infrastructure/db/types';
import { createAuthSession } from './sessionCookie';
import type {
    LoginUserDependencies,
    LoginUserError,
    LoginUserInput,
    LoginUserOptions,
    LoginUserResult,
} from './types';

const INVALID_CREDENTIALS_MESSAGE = 'Email or password is incorrect';

function invalidCredentialsError(): LoginUserError {
    return {
        code: 'invalid_credentials',
        message: INVALID_CREDENTIALS_MESSAGE,
    };
}

function omitPasswordHash(user: EmailAuthUserRecord): AuthUserRecord {
    const { passwordHash: _passwordHash, ...safeUser } = user;
    return safeUser;
}

/**
 * Log in a user with email and password.
 *
 * Normalizes email before lookup, verifies the supplied password against the
 * stored hash, persists a session, and returns HTTP-only cookie metadata for
 * the caller to attach to the response.
 *
 * @param input - Email and plain-text password supplied by the user.
 * @param dependencies - Repositories and password verifier injected by the caller.
 * @param options - Runtime overrides for TTL, cookie name, secure flag, SameSite, path, and current time.
 * @returns Discriminated union: `{ ok: true }` with user/session/cookie on success, or `{ ok: false }` with `invalid_credentials` error.
 *
 * @example
 * ```typescript
 * const result = await loginUser(
 *     { email: 'user@example.com', password: 'Secret1!' },
 *     { users: drizzleUserRepository, sessions: drizzleSessionRepository, passwordVerifier: bcryptVerifier },
 * );
 * if (result.ok) {
 *     console.log('Logged in:', result.user.id);
 * } else {
 *     console.error('Login failed:', result.error.code);
 * }
 * ```
 *
 * @see {@link LoginUserDependencies} for the dependency injection contract.
 * @see {@link LoginUserOptions} for available runtime overrides.
 */
export async function loginUser(
    input: LoginUserInput,
    dependencies: LoginUserDependencies,
    options: LoginUserOptions = {}
): Promise<LoginUserResult> {
    const email = normalizeEmail(input.email);
    const user = await dependencies.users.findEmailAuthUserByEmail(email);

    if (user === null || user.passwordHash === null) {
        return { ok: false, error: invalidCredentialsError() };
    }

    const passwordMatches = await dependencies.passwordVerifier.verifyPassword(
        input.password,
        user.passwordHash
    );

    if (!passwordMatches) {
        return { ok: false, error: invalidCredentialsError() };
    }

    const now = options.now ?? new Date();
    const { session, cookie } = await createAuthSession({
        userId: user.id,
        sessions: dependencies.sessions,
        now,
        sessionTtlSeconds: options.sessionTtlSeconds,
        cookieName: options.cookieName,
        secureCookie: options.secureCookie,
        sameSite: options.sameSite,
        path: options.path,
    });
    const safeUser = omitPasswordHash(user);

    return { ok: true, user: safeUser, session, cookie };
}
