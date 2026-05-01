import { normalizeEmail, validateEmail } from '@/domain/auth/validation';
import type { AuthUserRecord } from '@/infrastructure/db/types';
import { EMAIL_ALREADY_EXISTS_CODE } from './constants';
import { createAuthSession } from './sessionCookie';
import type {
    SocialLoginUserDependencies,
    SocialLoginUserError,
    SocialLoginUserInput,
    SocialLoginUserOptions,
    SocialLoginUserResult,
} from './types';

const EMAIL_ALREADY_EXISTS_MESSAGE =
    'Email is already registered with another login method';
const INVALID_OAUTH_PROFILE_MESSAGE =
    'OAuth profile is missing a valid email or account identifier';

function normalizeOptionalProfileValue(
    value: string | undefined
): string | undefined {
    return value?.trim();
}

function emailAlreadyExistsError(): SocialLoginUserError {
    return {
        code: EMAIL_ALREADY_EXISTS_CODE,
        message: EMAIL_ALREADY_EXISTS_MESSAGE,
    };
}

function invalidOAuthProfileError(): SocialLoginUserError {
    return {
        code: 'invalid_oauth_profile',
        message: INVALID_OAUTH_PROFILE_MESSAGE,
    };
}

async function createSessionResult(
    user: AuthUserRecord,
    dependencies: SocialLoginUserDependencies,
    options: SocialLoginUserOptions
): Promise<Extract<SocialLoginUserResult, { ok: true }>> {
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

    return { ok: true, user, session, cookie };
}

/**
 * Log in or provision a user from a successful OAuth provider callback.
 *
 * Existing provider links authenticate immediately. First-time OAuth logins
 * create a free-tier user and link the provider account. If the provider email
 * already belongs to an email/password account, the function returns a conflict
 * so the consumer can drive an explicit account-linking flow.
 *
 * @param input - OAuth provider callback data: provider, providerAccountId, email, optional profile fields.
 * @param dependencies - Repositories injected by the caller for OAuth/user persistence and session creation.
 * @param options - Runtime overrides for session TTL, cookie name, secure flag, SameSite, path, and current time.
 * @returns Discriminated union: `{ ok: true }` with user/session/cookie on success, or `{ ok: false }` with `invalid_oauth_profile` / `email_already_exists`.
 *
 * @example
 * ```typescript
 * const result = await socialLoginUser(
 *     {
 *         provider: 'google',
 *         providerAccountId: 'google-uid-123',
 *         email: 'user@example.com',
 *         name: 'User',
 *     },
 *     { users: drizzleUserRepository, sessions: drizzleSessionRepository },
 * );
 * if (result.ok) {
 *     console.log('OAuth login:', result.user.id);
 * } else {
 *     console.error('OAuth login failed:', result.error.code);
 * }
 * ```
 *
 * @see {@link SocialLoginUserDependencies} for the dependency injection contract.
 * @see {@link SocialLoginUserOptions} for available runtime overrides.
 */
export async function socialLoginUser(
    input: SocialLoginUserInput,
    dependencies: SocialLoginUserDependencies,
    options: SocialLoginUserOptions = {}
): Promise<SocialLoginUserResult> {
    const providerAccountId = input.providerAccountId.trim();
    const email = normalizeEmail(input.email);
    if (providerAccountId === '' || validateEmail(email) !== null) {
        return { ok: false, error: invalidOAuthProfileError() };
    }

    const existingOAuthUser = await dependencies.users.findByOAuthAccount(
        input.provider,
        providerAccountId
    );
    if (existingOAuthUser !== null) {
        return createSessionResult(existingOAuthUser, dependencies, options);
    }

    const existingEmailUser = await dependencies.users.findByEmail(email);
    if (existingEmailUser !== null) {
        return { ok: false, error: emailAlreadyExistsError() };
    }

    const createdUser = await dependencies.users.createOAuthUser({
        email,
        provider: input.provider,
        providerAccountId,
        name: normalizeOptionalProfileValue(input.name),
        avatarUrl: normalizeOptionalProfileValue(input.avatarUrl),
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        tokenExpiresAt: input.tokenExpiresAt,
    });
    if (createdUser !== null) {
        return createSessionResult(createdUser, dependencies, options);
    }

    const racedOAuthUser = await dependencies.users.findByOAuthAccount(
        input.provider,
        providerAccountId
    );

    return racedOAuthUser === null
        ? { ok: false, error: emailAlreadyExistsError() }
        : createSessionResult(racedOAuthUser, dependencies, options);
}
