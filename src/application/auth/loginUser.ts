import type {
    LoginUserDependencies,
    LoginUserError,
    LoginUserInput,
    LoginUserOptions,
    LoginUserResult,
} from './types';
import type {
    AuthUserRecord,
    EmailAuthUserRecord,
} from '@/infrastructure/auth/types';
import {
    addSeconds,
    createSessionCookie,
    DEFAULT_SESSION_TTL_SECONDS,
} from './sessionCookie';

const INVALID_CREDENTIALS_MESSAGE = 'Email or password is incorrect';

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

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

    const sessionTtlSeconds =
        options.sessionTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
    const now = options.now ?? new Date();
    const expiresAt = addSeconds(now, sessionTtlSeconds);
    const session = await dependencies.sessions.createSession({
        userId: user.id,
        expiresAt,
    });
    const cookie = createSessionCookie({
        token: session.id,
        expires: session.expiresAt,
        maxAgeSeconds: sessionTtlSeconds,
        name: options.cookieName,
        secure: options.secureCookie,
        sameSite: options.sameSite,
        path: options.path,
    });
    const safeUser = omitPasswordHash(user);

    return { ok: true, user: safeUser, session, cookie };
}
