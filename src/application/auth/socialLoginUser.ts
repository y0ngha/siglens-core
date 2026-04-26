import type {
    SocialLoginUserDependencies,
    SocialLoginUserError,
    SocialLoginUserInput,
    SocialLoginUserOptions,
    SocialLoginUserResult,
} from './types';
import type { AuthUserRecord } from '@/infrastructure/auth/types';
import { createAuthSession } from './sessionCookie';

const EMAIL_ALREADY_EXISTS_MESSAGE =
    'Email is already registered with another login method';
const INVALID_OAUTH_PROFILE_MESSAGE =
    'OAuth profile is missing a valid email or account identifier';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
    return EMAIL_PATTERN.test(email);
}

function normalizeOptionalProfileValue(
    value: string | undefined
): string | undefined {
    return value?.trim();
}

function emailAlreadyExistsError(): SocialLoginUserError {
    return {
        code: 'email_already_exists',
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
 */
export async function socialLoginUser(
    input: SocialLoginUserInput,
    dependencies: SocialLoginUserDependencies,
    options: SocialLoginUserOptions = {}
): Promise<SocialLoginUserResult> {
    const providerAccountId = input.providerAccountId.trim();
    const email = normalizeEmail(input.email);
    if (providerAccountId === '' || !isValidEmail(email)) {
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
