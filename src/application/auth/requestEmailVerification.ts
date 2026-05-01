import { normalizeEmail, validateEmail } from '@/domain/auth/validation';
import {
    generateNumericCode,
    hashEmailToken,
} from '@/infrastructure/auth/tokenUtils';
import {
    EMAIL_VERIFICATION_CODE_LENGTH,
    EMAIL_VERIFICATION_PENDING_TTL_SECONDS,
} from './constants';
import type {
    RequestEmailVerificationDependencies,
    RequestEmailVerificationInput,
    RequestEmailVerificationOptions,
    RequestEmailVerificationResult,
} from './types';

const PURPOSE = 'email_verification' as const;

/**
 * Issue a numeric email verification code and dispatch it to the address.
 *
 * Normalizes and validates the email format, generates a fixed-length numeric
 * code, persists its hash in the {@link EmailTokenStore} as `pending`, and
 * dispatches the consumer-built email message via the injected
 * {@link EmailDispatcher}. Email delivery failure does not affect `ok` — the
 * code is still issued and the result reflects the dispatch outcome via
 * `emailDispatched`.
 *
 * @param input - Email address to verify.
 * @param dependencies - Redis-backed token store and email dispatch services.
 * @param options - Email-message builder for the verification code.
 * @returns A discriminated union with `codeIssued` and `emailDispatched` flags.
 *
 * @example
 * ```typescript
 * const result = await requestEmailVerification(
 *     { email: 'user@example.com' },
 *     { emailTokens, emailDispatcher },
 *     {
 *         buildMessage: code => ({
 *             to: 'user@example.com',
 *             subject: '인증번호',
 *             html: `<p>인증번호: <strong>${code}</strong></p>`,
 *             text: `인증번호: ${code}`,
 *         }),
 *     }
 * );
 * ```
 */
export async function requestEmailVerification(
    input: RequestEmailVerificationInput,
    dependencies: RequestEmailVerificationDependencies,
    options: RequestEmailVerificationOptions
): Promise<RequestEmailVerificationResult> {
    const email = normalizeEmail(input.email);
    const emailError = validateEmail(email);

    if (emailError !== null) {
        return { ok: true, codeIssued: false, emailDispatched: false };
    }

    const code = generateNumericCode(EMAIL_VERIFICATION_CODE_LENGTH);
    const tokenHash = hashEmailToken(code);

    await dependencies.emailTokens.set(
        PURPOSE,
        email,
        { status: 'pending', tokenHash },
        EMAIL_VERIFICATION_PENDING_TTL_SECONDS
    );

    const message = options.buildMessage(code);
    const emailDispatched = await dependencies.emailDispatcher
        .sendEmail(message)
        .catch((error: unknown) => {
            console.warn(
                '[requestEmailVerification] emailDispatcher.sendEmail failed',
                error
            );
            return false;
        });

    return { ok: true, codeIssued: true, emailDispatched };
}
