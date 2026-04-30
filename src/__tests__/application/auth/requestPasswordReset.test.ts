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
const resetUrlBase = 'https://example.com/reset-password';

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

function makeDependencies(options?: {
    user?: EmailAuthUserRecord | null;
    emailDispatcherResolves?: boolean;
    emailDispatcherThrows?: boolean;
}): {
    dependencies: RequestPasswordResetDependencies;
    findEmailAuthUserByEmail: ReturnType<typeof vi.fn>;
    generatePasswordResetToken: ReturnType<typeof vi.fn>;
    hashPasswordResetToken: ReturnType<typeof vi.fn>;
    createPasswordReset: ReturnType<typeof vi.fn>;
    sendEmail: ReturnType<typeof vi.fn>;
} {
    const foundUser = options && 'user' in options ? options.user : user;
    const findEmailAuthUserByEmail = vi.fn().mockResolvedValue(foundUser);
    const generatePasswordResetToken = vi.fn().mockResolvedValue('raw-token');
    const hashPasswordResetToken = vi.fn().mockResolvedValue('hashed-token');
    const createPasswordReset = vi
        .fn()
        .mockResolvedValue(makePasswordResetRecord());

    const emailDispatcherThrows = options?.emailDispatcherThrows ?? false;
    const emailDispatcherResolves = options?.emailDispatcherResolves ?? true;
    const sendEmail = emailDispatcherThrows
        ? vi.fn().mockRejectedValue(new Error('smtp error'))
        : vi.fn().mockResolvedValue(emailDispatcherResolves);

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
            emailDispatcher: { sendEmail },
        },
        findEmailAuthUserByEmail,
        generatePasswordResetToken,
        hashPasswordResetToken,
        createPasswordReset,
        sendEmail,
    };
}

describe('requestPasswordReset', () => {
    it('returns no token for an invalid email without repository access', async () => {
        const {
            dependencies,
            findEmailAuthUserByEmail,
            generatePasswordResetToken,
            createPasswordReset,
            sendEmail,
        } = makeDependencies();

        const result = await requestPasswordReset(
            { email: 'not-an-email' },
            dependencies,
            { now, resetUrlBase }
        );

        expect(result).toEqual({
            ok: true,
            token: null,
            expiresAt: null,
            emailDispatched: false,
        });
        expect(findEmailAuthUserByEmail).not.toHaveBeenCalled();
        expect(generatePasswordResetToken).not.toHaveBeenCalled();
        expect(createPasswordReset).not.toHaveBeenCalled();
        expect(sendEmail).not.toHaveBeenCalled();
    });

    it('returns no token when no account matches the email', async () => {
        const {
            dependencies,
            findEmailAuthUserByEmail,
            generatePasswordResetToken,
            createPasswordReset,
            sendEmail,
        } = makeDependencies({ user: null });

        const result = await requestPasswordReset(
            { email: ' Missing@Example.COM ' },
            dependencies,
            { now, resetUrlBase }
        );

        expect(result).toEqual({
            ok: true,
            token: null,
            expiresAt: null,
            emailDispatched: false,
        });
        expect(findEmailAuthUserByEmail).toHaveBeenCalledWith(
            'missing@example.com'
        );
        expect(generatePasswordResetToken).not.toHaveBeenCalled();
        expect(createPasswordReset).not.toHaveBeenCalled();
        expect(sendEmail).not.toHaveBeenCalled();
    });

    it('returns no token for OAuth-only accounts without a password hash', async () => {
        const {
            dependencies,
            findEmailAuthUserByEmail,
            generatePasswordResetToken,
            createPasswordReset,
            sendEmail,
        } = makeDependencies({
            user: { ...user, passwordHash: null },
        });

        const result = await requestPasswordReset(
            { email: 'user@example.com' },
            dependencies,
            { now, resetUrlBase }
        );

        expect(result).toEqual({
            ok: true,
            token: null,
            expiresAt: null,
            emailDispatched: false,
        });
        expect(findEmailAuthUserByEmail).toHaveBeenCalledWith(
            'user@example.com'
        );
        expect(generatePasswordResetToken).not.toHaveBeenCalled();
        expect(createPasswordReset).not.toHaveBeenCalled();
        expect(sendEmail).not.toHaveBeenCalled();
    });

    it('creates a hashed reset token, dispatches an email, and returns emailDispatched true', async () => {
        const {
            dependencies,
            findEmailAuthUserByEmail,
            generatePasswordResetToken,
            hashPasswordResetToken,
            createPasswordReset,
            sendEmail,
        } = makeDependencies();

        const result: RequestPasswordResetResult = await requestPasswordReset(
            { email: ' User@Example.COM ' },
            dependencies,
            { now, resetUrlBase }
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
        expect(sendEmail).toHaveBeenCalledTimes(1);
        expect(sendEmail).toHaveBeenCalledWith(
            expect.objectContaining({
                to: 'user@example.com',
                subject: 'Password Reset Request',
            })
        );
        expect(result).toEqual({
            ok: true,
            token: 'raw-token',
            expiresAt,
            emailDispatched: true,
        });
    });

    it('returns emailDispatched false when the dispatcher resolves false', async () => {
        const { dependencies } = makeDependencies({
            emailDispatcherResolves: false,
        });

        const result = await requestPasswordReset(
            { email: 'user@example.com' },
            dependencies,
            { now, resetUrlBase }
        );

        expect(result).toEqual({
            ok: true,
            token: 'raw-token',
            expiresAt,
            emailDispatched: false,
        });
    });

    it('keeps ok true and returns emailDispatched false when the dispatcher throws', async () => {
        const { dependencies, createPasswordReset } = makeDependencies({
            emailDispatcherThrows: true,
        });

        const result = await requestPasswordReset(
            { email: 'user@example.com' },
            dependencies,
            { now, resetUrlBase }
        );

        expect(createPasswordReset).toHaveBeenCalledTimes(1);
        expect(result).toEqual({
            ok: true,
            token: 'raw-token',
            expiresAt,
            emailDispatched: false,
        });
    });

    it('passes the reset URL base to the email message', async () => {
        const customBase = 'https://app.example.com/auth/reset';
        const { dependencies, sendEmail } = makeDependencies();

        await requestPasswordReset(
            { email: 'user@example.com' },
            dependencies,
            { now, resetUrlBase: customBase }
        );

        const [message] = sendEmail.mock.calls[0] as [{ html: string }];
        expect(message.html).toContain(`${customBase}?token=raw-token`);
    });

    it('uses the current system time when no runtime override is provided', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(now);

        try {
            const { dependencies, createPasswordReset } = makeDependencies();

            const result = await requestPasswordReset(
                { email: 'user@example.com' },
                dependencies,
                { resetUrlBase }
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
                emailDispatched: true,
            });
        } finally {
            vi.useRealTimers();
        }
    });
});
