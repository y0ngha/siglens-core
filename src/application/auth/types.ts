import type {
    AuthSessionRecord,
    AuthUserRecord,
    AuthOAuthProvider,
    EmailAuthUserRepository,
    OAuthUserRepository,
    PasswordVerifier,
    SessionRepository,
} from '@/infrastructure/auth/types';

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
export interface LoginUserOptions {
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
    provider: AuthOAuthProvider;
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
export interface SocialLoginUserOptions {
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
