import { describe, expect, it, vi } from 'vitest';
import { registerUser } from '@/application/auth/registerUser';
import type { PasswordHasher } from '@/infrastructure/auth';
import type { AuthUserRecord, UserRepository } from '@/infrastructure/db/types';

const createdAt = new Date('2026-04-26T00:00:00.000Z');
const updatedAt = new Date('2026-04-26T00:00:01.000Z');

function makeUser(email: string): AuthUserRecord {
    return {
        id: 'user-1',
        email,
        name: null,
        avatarUrl: null,
        tier: 'free',
        createdAt,
        updatedAt,
    };
}

function makeDependencies(options?: {
    existingUser?: AuthUserRecord | null;
    createdUser?: AuthUserRecord | null;
}): {
    repository: UserRepository;
    passwordHasher: PasswordHasher;
    findByEmail: ReturnType<typeof vi.fn>;
    createEmailUser: ReturnType<typeof vi.fn>;
    hashPassword: ReturnType<typeof vi.fn>;
} {
    const findByEmail = vi
        .fn()
        .mockResolvedValue(options?.existingUser ?? null);
    const createdUser =
        options && 'createdUser' in options
            ? options.createdUser
            : makeUser('user@example.com');
    const createEmailUser = vi.fn().mockResolvedValue(createdUser);
    const hashPassword = vi.fn().mockResolvedValue('hashed-password');

    return {
        repository: { findByEmail, createEmailUser },
        passwordHasher: { hashPassword },
        findByEmail,
        createEmailUser,
        hashPassword,
    };
}

describe('registerUser', () => {
    it('rejects invalid email before repository access', async () => {
        const { repository, passwordHasher, findByEmail, hashPassword } =
            makeDependencies();

        const result = await registerUser(
            { email: 'invalid-email', password: 'Password1' },
            repository,
            passwordHasher
        );

        expect(result).toEqual({
            ok: false,
            error: {
                code: 'invalid_email',
                field: 'email',
                message: 'Email format is invalid',
            },
        });
        expect(findByEmail).not.toHaveBeenCalled();
        expect(hashPassword).not.toHaveBeenCalled();
    });

    it('rejects weak password (no numbers) before repository access', async () => {
        const { repository, passwordHasher, findByEmail, hashPassword } =
            makeDependencies();

        const result = await registerUser(
            { email: 'user@example.com', password: 'password' },
            repository,
            passwordHasher
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
        expect(findByEmail).not.toHaveBeenCalled();
        expect(hashPassword).not.toHaveBeenCalled();
    });

    it('rejects password shorter than minimum length', async () => {
        const { repository, passwordHasher, findByEmail, hashPassword } =
            makeDependencies();

        const result = await registerUser(
            { email: 'user@example.com', password: 'Ps1' },
            repository,
            passwordHasher
        );

        expect(result).toEqual({
            ok: false,
            error: {
                code: 'weak_password',
                field: 'password',
                message: expect.any(String),
            },
        });
        expect(findByEmail).not.toHaveBeenCalled();
        expect(hashPassword).not.toHaveBeenCalled();
    });

    it('rejects password with no letters', async () => {
        const { repository, passwordHasher, findByEmail, hashPassword } =
            makeDependencies();

        const result = await registerUser(
            { email: 'user@example.com', password: '12345678' },
            repository,
            passwordHasher
        );

        expect(result).toEqual({
            ok: false,
            error: {
                code: 'weak_password',
                field: 'password',
                message: expect.any(String),
            },
        });
        expect(findByEmail).not.toHaveBeenCalled();
        expect(hashPassword).not.toHaveBeenCalled();
    });

    it('rejects duplicate email before hashing', async () => {
        const existingUser = makeUser('user@example.com');
        const { repository, passwordHasher, hashPassword, createEmailUser } =
            makeDependencies({ existingUser });

        const result = await registerUser(
            { email: 'user@example.com', password: 'Password1' },
            repository,
            passwordHasher
        );

        expect(result).toEqual({
            ok: false,
            error: {
                code: 'email_already_exists',
                field: 'email',
                message: 'Email is already registered',
            },
        });
        expect(hashPassword).not.toHaveBeenCalled();
        expect(createEmailUser).not.toHaveBeenCalled();
    });

    it('normalizes email, hashes password, and creates a free-tier user', async () => {
        const createdUser = makeUser('user@example.com');
        const {
            repository,
            passwordHasher,
            findByEmail,
            createEmailUser,
            hashPassword,
        } = makeDependencies({ createdUser });

        const result = await registerUser(
            {
                email: ' User@Example.COM ',
                password: 'Password1',
                name: 'Ada',
                avatarUrl: 'https://example.com/avatar.png',
            },
            repository,
            passwordHasher
        );

        expect(findByEmail).toHaveBeenCalledWith('user@example.com');
        expect(hashPassword).toHaveBeenCalledWith('Password1');
        expect(createEmailUser).toHaveBeenCalledWith({
            email: 'user@example.com',
            passwordHash: 'hashed-password',
            name: 'Ada',
            avatarUrl: 'https://example.com/avatar.png',
        });
        expect(result).toEqual({ ok: true, user: createdUser });
    });

    it('trims whitespace from name and avatarUrl before creating user', async () => {
        const createdUser = makeUser('user@example.com');
        const { repository, passwordHasher, createEmailUser } =
            makeDependencies({
                createdUser,
            });

        await registerUser(
            {
                email: 'user@example.com',
                password: 'Password1',
                name: '  Ada  ',
                avatarUrl: '  https://example.com/avatar.png  ',
            },
            repository,
            passwordHasher
        );

        expect(createEmailUser).toHaveBeenCalledWith({
            email: 'user@example.com',
            passwordHash: 'hashed-password',
            name: 'Ada',
            avatarUrl: 'https://example.com/avatar.png',
        });
    });

    it('returns duplicate email error when insert races with another signup', async () => {
        const { repository, passwordHasher } = makeDependencies({
            createdUser: null,
        });

        const result = await registerUser(
            { email: 'user@example.com', password: 'Password1' },
            repository,
            passwordHasher
        );

        expect(result).toEqual({
            ok: false,
            error: {
                code: 'email_already_exists',
                field: 'email',
                message: 'Email is already registered',
            },
        });
    });
});
