import { describe, expect, it, vi } from 'vitest';
import { confirmPasswordReset } from '@/application/auth';
import type { ConfirmPasswordResetDependencies } from '@/application/auth';
import type { PasswordResetRecord } from '@/infrastructure/db/types';

const now = new Date('2026-04-28T00:00:00.000Z');
const future = new Date('2026-04-28T00:30:00.000Z');
const past = new Date('2026-04-27T23:59:59.000Z');

function makePasswordReset(overrides?: {
    expiresAt?: Date;
    usedAt?: Date | null;
}): PasswordResetRecord {
    return {
        id: 'reset-1',
        userId: 'user-1',
        tokenHash: 'hashed-token',
        expiresAt: overrides?.expiresAt ?? future,
        usedAt: overrides?.usedAt ?? null,
        createdAt: new Date('2026-04-27T23:30:00.000Z'),
    };
}

function makeDependencies(options?: {
    passwordReset?: PasswordResetRecord | null;
    completed?: boolean;
}): {
    dependencies: ConfirmPasswordResetDependencies;
    hashPasswordResetToken: ReturnType<typeof vi.fn>;
    findPasswordResetByTokenHash: ReturnType<typeof vi.fn>;
    hashPassword: ReturnType<typeof vi.fn>;
    completePasswordReset: ReturnType<typeof vi.fn>;
} {
    const passwordReset =
        options && 'passwordReset' in options
            ? options.passwordReset
            : makePasswordReset();
    const completed =
        options && 'completed' in options ? options.completed : true;
    const hashPasswordResetToken = vi.fn().mockResolvedValue('hashed-token');
    const findPasswordResetByTokenHash = vi
        .fn()
        .mockResolvedValue(passwordReset);
    const hashPassword = vi.fn().mockResolvedValue('new-password-hash');
    const completePasswordReset = vi.fn().mockResolvedValue(completed);

    return {
        dependencies: {
            passwordResets: {
                createPasswordReset: vi.fn(),
                findPasswordResetByTokenHash,
                completePasswordReset,
            },
            passwordHasher: { hashPassword },
            tokenHasher: { hashPasswordResetToken },
        },
        hashPasswordResetToken,
        findPasswordResetByTokenHash,
        hashPassword,
        completePasswordReset,
    };
}

describe('confirmPasswordReset', () => {
    it('rejects weak passwords before token lookup', async () => {
        const {
            dependencies,
            hashPasswordResetToken,
            findPasswordResetByTokenHash,
            hashPassword,
        } = makeDependencies();

        const result = await confirmPasswordReset(
            { token: 'raw-token', newPassword: 'password' },
            dependencies,
            { now }
        );

        expect(result).toEqual({
            ok: false,
            error: {
                code: 'weak_password',
                field: 'password',
                message:
                    'Password must be at least 8 characters and include letters and numbers',
            },
        });
        expect(hashPasswordResetToken).not.toHaveBeenCalled();
        expect(findPasswordResetByTokenHash).not.toHaveBeenCalled();
        expect(hashPassword).not.toHaveBeenCalled();
    });

    it('rejects unknown tokens', async () => {
        const { dependencies, hashPasswordResetToken, hashPassword } =
            makeDependencies({ passwordReset: null });

        const result = await confirmPasswordReset(
            { token: 'raw-token', newPassword: 'Password1' },
            dependencies,
            { now }
        );

        expect(hashPasswordResetToken).toHaveBeenCalledWith('raw-token');
        expect(result).toEqual({
            ok: false,
            error: {
                code: 'invalid_token',
                field: 'token',
                message: 'Password reset token is invalid',
            },
        });
        expect(hashPassword).not.toHaveBeenCalled();
    });

    it('rejects already used tokens', async () => {
        const { dependencies, hashPassword } = makeDependencies({
            passwordReset: makePasswordReset({ usedAt: past }),
        });

        const result = await confirmPasswordReset(
            { token: 'raw-token', newPassword: 'Password1' },
            dependencies,
            { now }
        );

        expect(result).toEqual({
            ok: false,
            error: {
                code: 'invalid_token',
                field: 'token',
                message: 'Password reset token is invalid',
            },
        });
        expect(hashPassword).not.toHaveBeenCalled();
    });

    it('rejects expired tokens', async () => {
        const { dependencies, hashPassword, completePasswordReset } =
            makeDependencies({
                passwordReset: makePasswordReset({ expiresAt: past }),
            });

        const result = await confirmPasswordReset(
            { token: 'raw-token', newPassword: 'Password1' },
            dependencies,
            { now }
        );

        expect(result).toEqual({
            ok: false,
            error: {
                code: 'expired_token',
                field: 'token',
                message: 'Password reset token has expired',
            },
        });
        expect(hashPassword).not.toHaveBeenCalled();
        expect(completePasswordReset).not.toHaveBeenCalled();
    });

    it('hashes the new password and consumes a valid token', async () => {
        const {
            dependencies,
            findPasswordResetByTokenHash,
            hashPassword,
            completePasswordReset,
        } = makeDependencies();

        const result = await confirmPasswordReset(
            { token: 'raw-token', newPassword: 'Password1' },
            dependencies,
            { now }
        );

        expect(findPasswordResetByTokenHash).toHaveBeenCalledWith(
            'hashed-token'
        );
        expect(hashPassword).toHaveBeenCalledWith('Password1');
        expect(completePasswordReset).toHaveBeenCalledWith({
            resetId: 'reset-1',
            userId: 'user-1',
            passwordHash: 'new-password-hash',
            usedAt: now,
        });
        expect(result).toEqual({ ok: true });
    });

    it('uses the current system time when no runtime override is provided', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(now);

        try {
            const { dependencies, completePasswordReset } = makeDependencies();

            const result = await confirmPasswordReset(
                { token: 'raw-token', newPassword: 'Password1' },
                dependencies
            );

            expect(completePasswordReset).toHaveBeenCalledWith({
                resetId: 'reset-1',
                userId: 'user-1',
                passwordHash: 'new-password-hash',
                usedAt: now,
            });
            expect(result).toEqual({ ok: true });
        } finally {
            vi.useRealTimers();
        }
    });

    it('returns invalid token when completion fails', async () => {
        const { dependencies } = makeDependencies({ completed: false });

        const result = await confirmPasswordReset(
            { token: 'raw-token', newPassword: 'Password1' },
            dependencies,
            { now }
        );

        expect(result).toEqual({
            ok: false,
            error: {
                code: 'invalid_token',
                field: 'token',
                message: 'Password reset token is invalid',
            },
        });
    });
});
