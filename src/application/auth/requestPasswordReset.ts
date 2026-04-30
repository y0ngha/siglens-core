import { normalizeEmail, validateEmail } from '@/domain/auth/validation';
import {
    DEFAULT_PASSWORD_RESET_TTL_MINUTES,
    MILLISECONDS_PER_MINUTE,
} from './constants';
import type {
    RequestPasswordResetDependencies,
    RequestPasswordResetInput,
    RequestPasswordResetOptions,
    RequestPasswordResetResult,
} from './types';

/**
 * Create a one-time password reset token for an email-auth account.
 *
 * Normalizes and validates the email, looks up the account, generates a raw
 * token, stores only its hash, and returns the raw token for the consumer to
 * deliver by email.
 *
 * @param input - Email address for the account to recover.
 * @param dependencies - User lookup, reset persistence, token generation, and token hashing services.
 * @param options - Runtime override for the current time.
 * @returns A raw reset token with expiration, or `token: null` when no account matches.
 *
 * @example
 * ```typescript
 * const result = await requestPasswordReset(
 *     { email: 'user@example.com' },
 *     { users, passwordResets, tokenGenerator, tokenHasher },
 * );
 * ```
 *
 * @see {@link RequestPasswordResetDependencies} for the dependency contract.
 */
export async function requestPasswordReset(
    input: RequestPasswordResetInput,
    dependencies: RequestPasswordResetDependencies,
    options: RequestPasswordResetOptions = {}
): Promise<RequestPasswordResetResult> {
    const email = normalizeEmail(input.email);
    const emailError = validateEmail(email);

    if (emailError !== null) {
        return { ok: true, token: null, expiresAt: null };
    }

    const user = await dependencies.users.findEmailAuthUserByEmail(email);

    if (user === null || user.passwordHash === null) {
        return { ok: true, token: null, expiresAt: null };
    }

    const now = options.now ?? new Date();
    const expiresAt = new Date(
        now.getTime() +
            DEFAULT_PASSWORD_RESET_TTL_MINUTES * MILLISECONDS_PER_MINUTE
    );
    const token =
        await dependencies.tokenGenerator.generatePasswordResetToken();
    const tokenHash =
        await dependencies.tokenHasher.hashPasswordResetToken(token);

    await dependencies.passwordResets.createPasswordReset({
        userId: user.id,
        tokenHash,
        expiresAt,
    });

    return { ok: true, token, expiresAt };
}
