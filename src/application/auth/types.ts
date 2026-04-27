import type { AuthUserRecord } from '@/infrastructure/db/types';

/**
 * Error codes returned when user registration fails.
 *
 * - `invalid_email` — the provided email does not match a valid format.
 * - `weak_password` — the password is too short or lacks required character types.
 * - `email_already_exists` — the email is already registered.
 */
export type RegisterUserErrorCode =
    | 'invalid_email'
    | 'weak_password'
    | 'email_already_exists';

/**
 * The input field associated with a registration validation error.
 */
export type RegisterUserErrorField = 'email' | 'password';

/**
 * Input data required to register a new user with email and password.
 */
export interface RegisterUserInput {
    /** Email address to register; normalized (trimmed, lowercased) before storage. */
    email: string;
    /** Plain-text password; validated for strength before hashing. */
    password: string;
    /** Optional display name. */
    name?: string;
    /** Optional avatar image URL. */
    avatarUrl?: string;
}

/**
 * A structured validation or conflict error returned when registration fails.
 */
export interface RegisterUserError {
    /** Machine-readable error code identifying the failure reason. */
    code: RegisterUserErrorCode;
    /** The input field that caused the error. */
    field: RegisterUserErrorField;
    /** Human-readable error message suitable for display to the user. */
    message: string;
}

/**
 * Discriminated union result of a {@link registerUser} call.
 *
 * - `{ ok: true, user }` — registration succeeded; `user` is the created account.
 * - `{ ok: false, error }` — registration failed; `error` describes the reason.
 */
export type RegisterUserResult =
    | { ok: true; user: AuthUserRecord }
    | { ok: false; error: RegisterUserError };
