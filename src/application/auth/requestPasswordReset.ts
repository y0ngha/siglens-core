import { normalizeEmail, validateEmail } from '@/domain/auth/validation';
import {
    generateUrlSafeToken,
    hashEmailToken,
} from '@/infrastructure/auth/tokenUtils';
import {
    PASSWORD_RESET_TOKEN_BYTE_LENGTH,
    PASSWORD_RESET_TTL_SECONDS,
} from './constants';
import type {
    RequestPasswordResetDependencies,
    RequestPasswordResetInput,
    RequestPasswordResetOptions,
    RequestPasswordResetResult,
} from './types';

const PURPOSE = 'password_reset' as const;

/**
 * Issue a one-time password reset token and dispatch the reset email.
 *
 * Normalizes and validates the email, looks up the account, generates a raw
 * URL-safe token, persists its hash in the {@link EmailTokenStore} with a
 * fixed TTL, and dispatches the consumer-built email message via the injected
 * {@link EmailDispatcher}. Email delivery failure does not affect `ok` — the
 * token is still issued and the result reflects the dispatch outcome via
 * `emailDispatched`.
 *
 * Missing accounts and invalid email formats both return `tokenIssued: false`
 * to avoid leaking which addresses are registered.
 *
 * @param input - Email address for the account to recover.
 * @param dependencies - User lookup, Redis-backed token store, and email dispatch services.
 * @param options - Email-message builder for the reset URL.
 * @returns A discriminated union with `tokenIssued` and `emailDispatched` flags.
 *
 * @example
 * ```typescript
 * const result = await requestPasswordReset(
 *     { email: 'user@example.com' },
 *     { users, emailTokens, emailDispatcher },
 *     {
 *         buildMessage: token => ({
 *             to: 'user@example.com',
 *             subject: 'Reset your password',
 *             html: `<a href="https://example.com/reset?token=${token}">Reset</a>`,
 *             text: `Reset: https://example.com/reset?token=${token}`,
 *         }),
 *     }
 * );
 * ```
 */
export async function requestPasswordReset(
    input: RequestPasswordResetInput,
    dependencies: RequestPasswordResetDependencies,
    options: RequestPasswordResetOptions
): Promise<RequestPasswordResetResult> {
    const email = normalizeEmail(input.email);
    const emailError = validateEmail(email);

    if (emailError !== null) {
        return { ok: true, tokenIssued: false, emailDispatched: false };
    }

    const user = await dependencies.users.findEmailAuthUserByEmail(email);

    if (user === null || user.passwordHash === null) {
        return { ok: true, tokenIssued: false, emailDispatched: false };
    }

    const rawToken = generateUrlSafeToken(PASSWORD_RESET_TOKEN_BYTE_LENGTH);
    const tokenHash = hashEmailToken(rawToken);

    await dependencies.emailTokens.set(
        PURPOSE,
        email,
        { status: 'pending', tokenHash },
        PASSWORD_RESET_TTL_SECONDS
    );

    const message = options.buildMessage(rawToken);
    const emailDispatched = await dependencies.emailDispatcher
        .sendEmail(message)
        .catch((error: unknown) => {
            console.warn(
                '[requestPasswordReset] emailDispatcher.sendEmail failed',
                error
            );
            return false;
        });

    return { ok: true, tokenIssued: true, emailDispatched };
}
