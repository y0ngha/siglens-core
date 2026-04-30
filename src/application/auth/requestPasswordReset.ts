import { buildPasswordResetEmail } from '@/domain/auth/emailTemplates';
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
 * Create a one-time password reset token for an email-auth account and
 * dispatch a reset email to the user.
 *
 * Normalizes and validates the email, looks up the account, generates a raw
 * token, stores only its hash, and dispatches the reset email via the injected
 * `emailDispatcher`. Email delivery failure does not affect `ok` — the token
 * is still created and the result reflects the dispatch outcome via
 * `emailDispatched`.
 *
 * @param input - Email address for the account to recover.
 * @param dependencies - User lookup, reset persistence, token generation, token hashing, and email dispatch services.
 * @param options - Reset URL base and optional runtime override for the current time.
 * @returns A raw reset token with expiration and dispatch status, or `token: null` when no account matches.
 *
 * @example
 * ```typescript
 * const result = await requestPasswordReset(
 *     { email: 'user@example.com' },
 *     { users, passwordResets, tokenGenerator, tokenHasher, emailDispatcher },
 *     { resetUrlBase: 'https://example.com/reset-password' },
 * );
 * ```
 *
 * @see {@link RequestPasswordResetDependencies} for the dependency contract.
 */
export async function requestPasswordReset(
    input: RequestPasswordResetInput,
    dependencies: RequestPasswordResetDependencies,
    options: RequestPasswordResetOptions
): Promise<RequestPasswordResetResult> {
    const email = normalizeEmail(input.email);
    const emailError = validateEmail(email);

    if (emailError !== null) {
        return {
            ok: true,
            token: null,
            expiresAt: null,
            emailDispatched: false,
        };
    }

    const user = await dependencies.users.findEmailAuthUserByEmail(email);

    if (user === null || user.passwordHash === null) {
        return {
            ok: true,
            token: null,
            expiresAt: null,
            emailDispatched: false,
        };
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

    const emailMessage = buildPasswordResetEmail({
        to: email,
        token,
        expiresAt,
        baseUrl: options.resetUrlBase,
    });

    const emailDispatched = await dependencies.emailDispatcher
        .sendEmail(emailMessage)
        .catch((error: unknown) => {
            console.warn(
                '[requestPasswordReset] emailDispatcher.sendEmail failed',
                error
            );
            return false;
        });

    return { ok: true, token, expiresAt, emailDispatched };
}
