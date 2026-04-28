export const EMAIL_ALREADY_EXISTS_CODE = 'email_already_exists' as const;

/** @internal Error code returned for unknown or already-consumed password reset tokens. */
export const PASSWORD_RESET_INVALID_TOKEN_CODE = 'invalid_token' as const;

/** @internal Error code returned when a password reset token has expired. */
export const PASSWORD_RESET_EXPIRED_TOKEN_CODE = 'expired_token' as const;

/** @internal Password reset token lifetime in minutes. */
export const DEFAULT_PASSWORD_RESET_TTL_MINUTES = 30;

/** @internal Conversion factor used when calculating minute-based expirations. */
export const MILLISECONDS_PER_MINUTE = 60_000;
