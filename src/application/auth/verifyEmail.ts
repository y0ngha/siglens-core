import { normalizeEmail, validateEmail } from '@/domain/auth/validation';
import {
    hashEmailToken,
    safeCompareTokenHashes,
} from '@/infrastructure/auth/tokenUtils';
import { EMAIL_VERIFICATION_VERIFIED_TTL_SECONDS } from './constants';
import type {
    VerifyEmailDependencies,
    VerifyEmailError,
    VerifyEmailInput,
    VerifyEmailResult,
} from './types';

const PURPOSE = 'email_verification' as const;
const INVALID_CODE_MESSAGE = 'Verification code is invalid';
const EXPIRED_CODE_MESSAGE = 'Verification code has expired';

function invalidCodeError(): VerifyEmailError {
    return {
        code: 'invalid_verification_code',
        field: 'code',
        message: INVALID_CODE_MESSAGE,
    };
}

function expiredCodeError(): VerifyEmailError {
    return {
        code: 'expired_verification_code',
        field: 'code',
        message: EXPIRED_CODE_MESSAGE,
    };
}

/**
 * Verify a numeric email verification code.
 *
 * Compares the hash of {@link VerifyEmailInput.code} against the persisted
 * `pending` value for the email. On success, transitions the same Redis key
 * to a `verified` marker with a fresh TTL so that {@link registerUser} can
 * confirm prior verification without re-asking for the code.
 *
 * Verification is idempotent: repeated calls after success continue to
 * return `{ ok: true }` while the verified marker is alive.
 *
 * @param input - Email and code submitted by the user.
 * @param dependencies - Redis-backed token store.
 * @returns `{ ok: true }` on success, or `{ ok: false, error }` with a typed code.
 *
 * @example
 * ```typescript
 * const result = await verifyEmail(
 *     { email: 'user@example.com', code: '123456' },
 *     { emailTokens }
 * );
 * ```
 */
export async function verifyEmail(
    input: VerifyEmailInput,
    dependencies: VerifyEmailDependencies
): Promise<VerifyEmailResult> {
    const email = normalizeEmail(input.email);
    const emailError = validateEmail(email);

    if (emailError !== null) {
        return { ok: false, error: invalidCodeError() };
    }

    const stored = await dependencies.emailTokens.get(PURPOSE, email);

    if (stored === null) {
        return { ok: false, error: expiredCodeError() };
    }

    if (stored.status === 'verified') {
        return { ok: true };
    }

    const submittedHash = hashEmailToken(input.code);
    if (!safeCompareTokenHashes(submittedHash, stored.tokenHash)) {
        return { ok: false, error: invalidCodeError() };
    }

    await dependencies.emailTokens.set(
        PURPOSE,
        email,
        { status: 'verified' },
        EMAIL_VERIFICATION_VERIFIED_TTL_SECONDS
    );

    return { ok: true };
}
