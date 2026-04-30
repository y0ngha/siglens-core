import { validatePassword } from '@/domain/auth/validation';
import {
    PASSWORD_RESET_EXPIRED_TOKEN_CODE,
    PASSWORD_RESET_INVALID_TOKEN_CODE,
} from './constants';
import type {
    ConfirmPasswordResetDependencies,
    ConfirmPasswordResetError,
    ConfirmPasswordResetInput,
    ConfirmPasswordResetOptions,
    ConfirmPasswordResetResult,
} from './types';

const INVALID_TOKEN_MESSAGE = 'Password reset token is invalid';
const EXPIRED_TOKEN_MESSAGE = 'Password reset token has expired';

function invalidTokenError(): ConfirmPasswordResetError {
    return {
        code: PASSWORD_RESET_INVALID_TOKEN_CODE,
        field: 'token',
        message: INVALID_TOKEN_MESSAGE,
    };
}

function expiredTokenError(): ConfirmPasswordResetError {
    return {
        code: PASSWORD_RESET_EXPIRED_TOKEN_CODE,
        field: 'token',
        message: EXPIRED_TOKEN_MESSAGE,
    };
}

/**
 * Confirm a password reset token and replace the user's password hash.
 *
 * Validates password strength before hashing, verifies the reset token, checks
 * expiration and one-time-use state, updates `users.passwordHash`, and marks
 * the token as consumed.
 *
 * @param input - Raw reset token and new plain-text password.
 * @param dependencies - Reset persistence, password hashing, and token hashing services.
 * @param options - Runtime override for the current time.
 * @returns `{ ok: true }` on success, or a typed validation/token error.
 *
 * @example
 * ```typescript
 * const result = await confirmPasswordReset(
 *     { token, newPassword: 'Password1' },
 *     { passwordResets, passwordHasher, tokenHasher },
 * );
 * ```
 *
 * @see {@link ConfirmPasswordResetDependencies} for the dependency contract.
 */
export async function confirmPasswordReset(
    input: ConfirmPasswordResetInput,
    dependencies: ConfirmPasswordResetDependencies,
    options: ConfirmPasswordResetOptions = {}
): Promise<ConfirmPasswordResetResult> {
    const passwordError = validatePassword(input.newPassword);

    if (passwordError !== null) {
        return { ok: false, error: passwordError };
    }

    const tokenHash = await dependencies.tokenHasher.hashPasswordResetToken(
        input.token
    );
    const passwordReset =
        await dependencies.passwordResets.findPasswordResetByTokenHash(
            tokenHash
        );

    if (passwordReset === null || passwordReset.usedAt !== null) {
        return { ok: false, error: invalidTokenError() };
    }

    const now = options.now ?? new Date();

    if (passwordReset.expiresAt.getTime() <= now.getTime()) {
        return { ok: false, error: expiredTokenError() };
    }

    const passwordHash = await dependencies.passwordHasher.hashPassword(
        input.newPassword
    );
    const completed = await dependencies.passwordResets.completePasswordReset({
        resetId: passwordReset.id,
        userId: passwordReset.userId,
        passwordHash,
        usedAt: now,
    });

    return completed ? { ok: true } : { ok: false, error: invalidTokenError() };
}
