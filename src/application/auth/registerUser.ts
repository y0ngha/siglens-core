import { EMAIL_ALREADY_EXISTS_CODE } from './constants';
import {
    normalizeEmail,
    validateEmail,
    validatePassword,
} from '@/domain/auth/validation';
import type { PasswordHasher } from '@/infrastructure/auth';
import type { UserRepository } from '@/infrastructure/db';
import type {
    RegisterUserError,
    RegisterUserInput,
    RegisterUserResult,
} from './types';

const EMAIL_ALREADY_EXISTS_MESSAGE = 'Email is already registered';

const EMAIL_ALREADY_EXISTS_ERROR: RegisterUserError = {
    code: EMAIL_ALREADY_EXISTS_CODE,
    field: 'email',
    message: EMAIL_ALREADY_EXISTS_MESSAGE,
};

/**
 * Register a new user with email and password.
 *
 * Validates email format and password strength before checking for duplicates.
 * Email is normalized (trimmed, lowercased) before validation and storage.
 *
 * @param input - Registration data: email, password, and optional name/avatarUrl.
 * @param repository - User persistence interface for duplicate checks and account creation.
 * @param passwordHasher - Password hashing interface; invoked only after validation passes.
 * @returns `{ ok: true, user }` on success, or `{ ok: false, error }` with a typed error code.
 *
 * @example
 * ```typescript
 * const result = await registerUser(
 *     { email: 'user@example.com', password: 'Secret1!' },
 *     drizzleUserRepository,
 *     bcryptPasswordHasher,
 * );
 * if (result.ok) {
 *     console.log('Created user:', result.user.id);
 * } else {
 *     console.error('Registration failed:', result.error.code);
 * }
 * ```
 *
 * @see {@link UserRepository} for the persistence interface contract.
 * @see {@link PasswordHasher} for the hashing interface contract.
 */
export async function registerUser(
    input: RegisterUserInput,
    repository: UserRepository,
    passwordHasher: PasswordHasher
): Promise<RegisterUserResult> {
    const email = normalizeEmail(input.email);
    const emailError = validateEmail(email);
    if (emailError !== null) return { ok: false, error: emailError };

    const passwordError = validatePassword(input.password);
    if (passwordError !== null) return { ok: false, error: passwordError };

    const existingUser = await repository.findByEmail(email);
    if (existingUser !== null) {
        return { ok: false, error: EMAIL_ALREADY_EXISTS_ERROR };
    }

    const passwordHash = await passwordHasher.hashPassword(input.password);
    const user = await repository.createEmailUser({
        email,
        passwordHash,
        name: input.name?.trim(),
        avatarUrl: input.avatarUrl?.trim(),
    });

    return user === null
        ? { ok: false, error: EMAIL_ALREADY_EXISTS_ERROR }
        : { ok: true, user };
}
