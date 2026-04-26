import type { AuthUserRecord } from '@/infrastructure/auth/types';

export type RegisterUserErrorCode =
    | 'invalid_email'
    | 'weak_password'
    | 'email_already_exists';

export type RegisterUserErrorField = 'email' | 'password';

export interface RegisterUserInput {
    email: string;
    password: string;
    name?: string;
    avatarUrl?: string;
}

export interface RegisterUserError {
    code: RegisterUserErrorCode;
    field: RegisterUserErrorField;
    message: string;
}

export type RegisterUserResult =
    | { ok: true; user: AuthUserRecord }
    | { ok: false; error: RegisterUserError };
