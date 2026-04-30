import type {
    AuthSessionRecord,
    AuthUserRecord,
    EmailAuthUserRepository,
    OAuthProvider,
    OAuthUserRepository,
    PasswordResetRepository,
    SessionRepository,
    UserRepository,
} from '@/infrastructure/db/types';
import type {
    PasswordHasher,
    PasswordVerifier,
} from '@/infrastructure/auth/types';
import type { EmailDispatcher } from '@/infrastructure/email/types';
import type {
    AuthValidationErrorCode,
    AuthValidationErrorField,
} from '@/domain/types';

/**
 * Error codes returned when user registration fails.
 *
 * - `invalid_email` — the provided email does not match a valid format.
 * - `weak_password` — the password is too short or lacks required character types.
 * - `email_already_exists` — the email is already registered.
 */
export type RegisterUserErrorCode =
    | AuthValidationErrorCode
    | 'email_already_exists';

/**
 * The input field associated with a registration validation error.
 */
export type RegisterUserErrorField = AuthValidationErrorField;

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

/**
 * Error code returned when email login fails.
 */
export type LoginUserErrorCode = 'invalid_credentials';

/**
 * Input data required to log in with email and password.
 */
export interface LoginUserInput {
    /** Email address to authenticate; normalized before lookup. */
    email: string;
    /** Plain-text password to verify against the stored password hash. */
    password: string;
}

/**
 * Structured login error that does not reveal whether email or password failed.
 */
export interface LoginUserError {
    /** Machine-readable error code identifying the failure reason. */
    code: LoginUserErrorCode;
    /** Human-readable error message suitable for display to the user. */
    message: string;
}

/**
 * Server-side auth cookie metadata returned to consumers for response handling.
 */
export interface AuthSessionCookie {
    /** Cookie name to set on the HTTP response. */
    name: string;
    /** Session token to store in the cookie. */
    value: string;
    /** Always true for auth cookies. */
    httpOnly: true;
    /** Whether the cookie should be restricted to HTTPS. */
    secure: boolean;
    /** SameSite policy for the session cookie. */
    sameSite: 'lax' | 'strict' | 'none';
    /** Cookie path. */
    path: string;
    /** Fixed expiration timestamp. */
    expires: Date;
    /** Max-Age value in seconds. */
    maxAgeSeconds: number;
}

/**
 * Shared session and cookie creation options.
 */
export interface AuthSessionOptions {
    /** Current time used to calculate session expiration; defaults to `new Date()`. */
    now?: Date;
    /** Session lifetime in seconds. */
    sessionTtlSeconds?: number;
    /** Cookie name; defaults to the library auth session name. */
    cookieName?: string;
    /** Whether to mark the cookie secure; defaults to true. */
    secureCookie?: boolean;
    /** SameSite policy; defaults to `lax`. */
    sameSite?: AuthSessionCookie['sameSite'];
    /** Cookie path; defaults to `/`. */
    path?: string;
}

/**
 * Login dependencies injected by the caller.
 */
export interface LoginUserDependencies {
    /** Credential lookup repository. */
    users: EmailAuthUserRepository;
    /** Session persistence repository. */
    sessions: SessionRepository;
    /** Password comparison service. */
    passwordVerifier: PasswordVerifier;
}

/**
 * Login runtime options.
 */
export interface LoginUserOptions extends AuthSessionOptions {}

/**
 * Discriminated union result of a {@link loginUser} call.
 */
export type LoginUserResult =
    | {
          ok: true;
          user: AuthUserRecord;
          session: AuthSessionRecord;
          cookie: AuthSessionCookie;
      }
    | { ok: false; error: LoginUserError };

/**
 * Error code returned when OAuth login cannot complete automatically.
 */
export type SocialLoginUserErrorCode =
    | 'invalid_oauth_profile'
    | 'email_already_exists';

/**
 * Input data received from a successful OAuth provider callback.
 */
export interface SocialLoginUserInput {
    /** OAuth provider that authenticated the account. */
    provider: OAuthProvider;
    /** Stable provider-side account identifier. */
    providerAccountId: string;
    /** Provider-confirmed email address; normalized before lookup/storage. */
    email: string;
    /** Optional display name from provider profile. */
    name?: string;
    /** Optional avatar image URL from provider profile. */
    avatarUrl?: string;
}

/**
 * Structured OAuth login error for account-link conflicts.
 */
export interface SocialLoginUserError {
    /** Machine-readable error code identifying the failure reason. */
    code: SocialLoginUserErrorCode;
    /** Human-readable error message suitable for display to the user. */
    message: string;
}

/**
 * OAuth login dependencies injected by the caller.
 */
export interface SocialLoginUserDependencies {
    /** OAuth account and user persistence repository. */
    users: OAuthUserRepository;
    /** Session persistence repository. */
    sessions: SessionRepository;
}

/**
 * OAuth login runtime options.
 */
export interface SocialLoginUserOptions extends AuthSessionOptions {}

/**
 * Discriminated union result of a {@link socialLoginUser} call.
 */
export type SocialLoginUserResult =
    | {
          ok: true;
          user: AuthUserRecord;
          session: AuthSessionRecord;
          cookie: AuthSessionCookie;
      }
    | { ok: false; error: SocialLoginUserError };

/**
 * Input data required to log out a session.
 */
export interface LogoutUserInput {
    /** Session token stored in the auth cookie. */
    sessionToken: string;
}

/**
 * Logout dependencies injected by the caller.
 */
export interface LogoutUserDependencies {
    /** Session persistence repository. */
    sessions: SessionRepository;
}

/**
 * Logout runtime options.
 */
export interface LogoutUserOptions {
    /** Cookie name; defaults to the library auth session name. */
    cookieName?: string;
    /** Whether to mark the cookie secure; defaults to true. */
    secureCookie?: boolean;
    /** SameSite policy; defaults to `lax`. */
    sameSite?: AuthSessionCookie['sameSite'];
    /** Cookie path; defaults to `/`. */
    path?: string;
}

/**
 * Result of a {@link logoutUser} call.
 */
export interface LogoutUserResult {
    /** Always true when logout completes without repository errors. */
    ok: true;
    /** Whether a persisted session row was deleted. */
    sessionInvalidated: boolean;
    /** Expired cookie metadata the caller should apply to the HTTP response. */
    cookie: AuthSessionCookie;
}

/**
 * Dependencies required to resolve a session token to its owning user.
 */
export interface FindUserBySessionTokenDependencies {
    /** User persistence repository providing id-based lookup. */
    users: UserRepository;
    /** Session persistence repository providing token-based lookup. */
    sessions: SessionRepository;
}

/**
 * Runtime overrides for {@link findUserBySessionToken}.
 */
export interface FindUserBySessionTokenOptions {
    /** Current time used to evaluate session expiration; defaults to `new Date()`. */
    now?: Date;
}

/**
 * Error code returned when account deletion cannot be completed.
 */
export type DeleteAccountErrorCode = 'user_not_found';

/**
 * Input data required to delete a user account.
 */
export interface DeleteAccountInput {
    /** User UUID identifying the account to delete. */
    userId: string;
}

/**
 * Dependencies required to delete an account and its dependent rows.
 */
export interface DeleteAccountDependencies {
    /** User persistence repository providing id-based deletion. */
    users: UserRepository;
}

/**
 * Cookie metadata overrides applied to the expired cookie returned on success.
 */
export interface DeleteAccountOptions {
    /** Cookie name; defaults to the library auth session name. */
    cookieName?: string;
    /** Whether to mark the cookie secure; defaults to true. */
    secureCookie?: boolean;
    /** SameSite policy; defaults to `lax`. */
    sameSite?: AuthSessionCookie['sameSite'];
    /** Cookie path; defaults to `/`. */
    path?: string;
}

/**
 * Structured error returned when account deletion fails.
 */
export interface DeleteAccountError {
    /** Machine-readable error code identifying the failure reason. */
    code: DeleteAccountErrorCode;
    /** Human-readable error message suitable for display to the user. */
    message: string;
}

/**
 * Discriminated union result of a {@link deleteAccount} call.
 *
 * - `{ ok: true, cookie }` — the account was deleted; dependent sessions were
 *   cascaded and `cookie` is expired metadata the caller should apply to the
 *   HTTP response to clear the browser-side session cookie.
 * - `{ ok: false, error }` — the account could not be deleted.
 */
export type DeleteAccountResult =
    | { ok: true; cookie: AuthSessionCookie }
    | { ok: false; error: DeleteAccountError };

/**
 * Input data required to request a password reset token.
 */
export interface RequestPasswordResetInput {
    /** Email address for the account to recover; normalized before lookup. */
    email: string;
}

/**
 * Service that creates high-entropy password reset tokens.
 */
export interface PasswordResetTokenGenerator {
    /**
     * Generate a raw token that the consumer can deliver to the user by email.
     *
     * @returns A one-time reset token.
     */
    generatePasswordResetToken(): string | Promise<string>;
}

/**
 * Service that hashes raw reset tokens before persistence or lookup.
 */
export interface PasswordResetTokenHasher {
    /**
     * Hash a raw password reset token.
     *
     * @param token - Raw reset token supplied by the generator or user.
     * @returns Stable token hash used for database storage and lookup.
     */
    hashPasswordResetToken(token: string): string | Promise<string>;
}

/**
 * Dependencies required to create a password reset token.
 */
export interface RequestPasswordResetDependencies {
    /** Email-auth credential lookup repository. */
    users: EmailAuthUserRepository;
    /** Password reset persistence repository. */
    passwordResets: PasswordResetRepository;
    /** Raw token generator supplied by the consumer. */
    tokenGenerator: PasswordResetTokenGenerator;
    /** Token hashing service supplied by the consumer. */
    tokenHasher: PasswordResetTokenHasher;
    /** Email delivery service supplied by the consumer. */
    emailDispatcher: EmailDispatcher;
}

/**
 * Runtime overrides for {@link requestPasswordReset}.
 */
export interface RequestPasswordResetOptions {
    /** Current time used to calculate token expiration; defaults to `new Date()`. */
    now?: Date;
    /** Base URL of the password reset page used to construct the reset link in the email. */
    resetUrlBase: string;
}

/**
 * Result of a {@link requestPasswordReset} call.
 *
 * Missing accounts intentionally return `token: null` so consumers can choose
 * whether to reveal or hide account existence in their presentation layer.
 * `emailDispatched` indicates whether the reset email was accepted for delivery.
 */
export type RequestPasswordResetResult =
    | { ok: true; token: string; expiresAt: Date; emailDispatched: boolean }
    | { ok: true; token: null; expiresAt: null; emailDispatched: false };

/**
 * Input data required to confirm a password reset token.
 */
export interface ConfirmPasswordResetInput {
    /** Raw token received from the password reset link/form. */
    token: string;
    /** New plain-text password; validated before hashing. */
    newPassword: string;
}

/**
 * Error code returned when password reset confirmation fails.
 */
export type ConfirmPasswordResetErrorCode =
    | AuthValidationErrorCode
    | 'invalid_token'
    | 'expired_token';

/**
 * Structured error returned when password reset confirmation fails.
 */
export interface ConfirmPasswordResetError {
    /** Machine-readable error code identifying the failure reason. */
    code: ConfirmPasswordResetErrorCode;
    /** Input field that caused the error when applicable. */
    field?: AuthValidationErrorField | 'token';
    /** Human-readable error message suitable for display to the user. */
    message: string;
}

/**
 * Dependencies required to confirm a password reset.
 */
export interface ConfirmPasswordResetDependencies {
    /** Password reset persistence repository. */
    passwordResets: PasswordResetRepository;
    /** Password hashing interface. */
    passwordHasher: PasswordHasher;
    /** Token hashing service supplied by the consumer. */
    tokenHasher: PasswordResetTokenHasher;
}

/**
 * Runtime overrides for {@link confirmPasswordReset}.
 */
export interface ConfirmPasswordResetOptions {
    /** Current time used to evaluate token expiration; defaults to `new Date()`. */
    now?: Date;
}

/**
 * Discriminated union result of a {@link confirmPasswordReset} call.
 */
export type ConfirmPasswordResetResult =
    | { ok: true }
    | { ok: false; error: ConfirmPasswordResetError };
