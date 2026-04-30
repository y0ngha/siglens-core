import { describe, expect, it, vi } from 'vitest';
import { requestPasswordReset } from '@/application/auth';
import type {
    RequestPasswordResetDependencies,
    RequestPasswordResetResult,
} from '@/application/auth';
import type {
    EmailAuthUserRecord,
    PasswordResetRecord,
} from '@/infrastructure/db/types';

const now = new Date('2026-04-28T00:00:00.000Z');
const expiresAt = new Date('2026-04-28T00:30:00.000Z');
const createdAt = new Date('2026-04-27T00:00:00.000Z');
const updatedAt = new Date('2026-04-27T00:00:01.000Z');

const user: EmailAuthUserRecord = {
    id: 'user-1',
    email: 'user@example.com',
    passwordHash: 'existing-password-hash',
    name: null,
    avatarUrl: null,
    tier: 'free',
    createdAt,
    updatedAt,
};

function makePasswordResetRecord(): PasswordResetRecord {
    return {
        id: 'reset-1',
        userId: 'user-1',
        tokenHash: 'hashed-token',
        expiresAt,
        usedAt: null,
        createdAt: now,
    };
}

function makeDependencies(options?: { user?: EmailAuthUserRecord | null }): {
    dependencies: RequestPasswordResetDependencies;
    findEmailAuthUserByEmail: ReturnType<typeof vi.fn>;
    generatePasswordResetToken: ReturnType<typeof vi.fn>;
    hashPasswordResetToken: ReturnType<typeof vi.fn>;
    createPasswordReset: ReturnType<typeof vi.fn>;
} {
    const foundUser = options && 'user' in options ? options.user : user;
    const findEmailAuthUserByEmail = vi.fn().mockResolvedValue(foundUser);
    const generatePasswordResetToken = vi.fn().mockResolvedValue('raw-token');
    const hashPasswordResetToken = vi.fn().mockResolvedValue('hashed-token');
    const createPasswordReset = vi
        .fn()
        .mockResolvedValue(makePasswordResetRecord());

    return {
        dependencies: {
            users: { findEmailAuthUserByEmail },
            passwordResets: {
                createPasswordReset,
                findPasswordResetByTokenHash: vi.fn(),
                completePasswordReset: vi.fn(),
            },
            tokenGenerator: { generatePasswordResetToken },
            tokenHasher: { hashPasswordResetToken },
        },
        findEmailAuthUserByEmail,
        generatePasswordResetToken,
        hashPasswordResetToken,
        createPasswordReset,
    };
}

describe('requestPasswordReset', () => {
    it('returns no token for an invalid email without repository access', async () => {
        const {
            dependencies,
            findEmailAuthUserByEmail,
            generatePasswordResetToken,
            createPasswordReset,
        } = makeDependencies();

        const result = await requestPasswordReset(
            { email: 'not-an-email' },
            dependencies,
            { now }
        );

        expect(result).toEqual({ ok: true, token: null, expiresAt: null });
        expect(findEmailAuthUserByEmail).not.toHaveBeenCalled();
        expect(generatePasswordResetToken).not.toHaveBeenCalled();
        expect(createPasswordReset).not.toHaveBeenCalled();
    });

    it('returns no token when no account matches the email', async () => {
        const {
            dependencies,
            findEmailAuthUserByEmail,
            generatePasswordResetToken,
            createPasswordReset,
        } = makeDependencies({ user: null });

        const result = await requestPasswordReset(
            { email: ' Missing@Example.COM ' },
            dependencies,
            { now }
        );

        expect(result).toEqual({ ok: true, token: null, expiresAt: null });
        expect(findEmailAuthUserByEmail).toHaveBeenCalledWith(
            'missing@example.com'
        );
        expect(generatePasswordResetToken).not.toHaveBeenCalled();
        expect(createPasswordReset).not.toHaveBeenCalled();
    });

    it('returns no token for OAuth-only accounts without a password hash', async () => {
        const {
            dependencies,
            findEmailAuthUserByEmail,
            generatePasswordResetToken,
            createPasswordReset,
        } = makeDependencies({
            user: { ...user, passwordHash: null },
        });

        const result = await requestPasswordReset(
            { email: 'user@example.com' },
            dependencies,
            { now }
        );

        expect(result).toEqual({ ok: true, token: null, expiresAt: null });
        expect(findEmailAuthUserByEmail).toHaveBeenCalledWith(
            'user@example.com'
        );
        expect(generatePasswordResetToken).not.toHaveBeenCalled();
        expect(createPasswordReset).not.toHaveBeenCalled();
    });

    it('creates a hashed reset token that expires after thirty minutes', async () => {
        const {
            dependencies,
            findEmailAuthUserByEmail,
            generatePasswordResetToken,
            hashPasswordResetToken,
            createPasswordReset,
        } = makeDependencies();

        const result: RequestPasswordResetResult = await requestPasswordReset(
            { email: ' User@Example.COM ' },
            dependencies,
            { now }
        );

        expect(findEmailAuthUserByEmail).toHaveBeenCalledWith(
            'user@example.com'
        );
        expect(generatePasswordResetToken).toHaveBeenCalledTimes(1);
        expect(hashPasswordResetToken).toHaveBeenCalledWith('raw-token');
        expect(createPasswordReset).toHaveBeenCalledWith({
            userId: 'user-1',
            tokenHash: 'hashed-token',
            expiresAt,
        });
        expect(result).toEqual({ ok: true, token: 'raw-token', expiresAt });
    });

    it('uses the current system time when no runtime override is provided', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(now);

        try {
            const { dependencies, createPasswordReset } = makeDependencies();

            const result = await requestPasswordReset(
                { email: 'user@example.com' },
                dependencies
            );

            expect(createPasswordReset).toHaveBeenCalledWith({
                userId: 'user-1',
                tokenHash: 'hashed-token',
                expiresAt,
            });
            expect(result).toEqual({
                ok: true,
                token: 'raw-token',
                expiresAt,
            });
        } finally {
            vi.useRealTimers();
        }
    });
});
