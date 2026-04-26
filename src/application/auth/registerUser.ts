import type { PasswordHasher, UserRepository } from '@/infrastructure/auth';
import type {
    RegisterUserError,
    RegisterUserInput,
    RegisterUserResult,
} from './types';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const EMAIL_ALREADY_EXISTS_MESSAGE = 'Email is already registered';
const INVALID_EMAIL_MESSAGE = 'Email format is invalid';
const WEAK_PASSWORD_MESSAGE =
    'Password must be at least 8 characters and include letters and numbers';

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

function hasLetter(value: string): boolean {
    return /[A-Za-z]/.test(value);
}

function hasNumber(value: string): boolean {
    return /\d/.test(value);
}

function validateEmail(email: string): RegisterUserError | null {
    return EMAIL_PATTERN.test(email)
        ? null
        : {
              code: 'invalid_email',
              field: 'email',
              message: INVALID_EMAIL_MESSAGE,
          };
}

function validatePassword(password: string): RegisterUserError | null {
    return password.length >= MIN_PASSWORD_LENGTH &&
        hasLetter(password) &&
        hasNumber(password)
        ? null
        : {
              code: 'weak_password',
              field: 'password',
              message: WEAK_PASSWORD_MESSAGE,
          };
}

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
        return {
            ok: false,
            error: {
                code: 'email_already_exists',
                field: 'email',
                message: EMAIL_ALREADY_EXISTS_MESSAGE,
            },
        };
    }

    const passwordHash = await passwordHasher.hashPassword(input.password);
    const user = await repository.createEmailUser({
        email,
        passwordHash,
        name: input.name,
        avatarUrl: input.avatarUrl,
    });

    return user === null
        ? {
              ok: false,
              error: {
                  code: 'email_already_exists',
                  field: 'email',
                  message: EMAIL_ALREADY_EXISTS_MESSAGE,
              },
          }
        : { ok: true, user };
}
