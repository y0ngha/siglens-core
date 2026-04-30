import type { EmailMessage } from '@/domain/types';

/**
 * Purpose tag used to namespace email-token Redis keys so that a password
 * reset token never collides with an email-verification token for the same
 * email address.
 */
export type EmailTokenPurpose = 'password_reset' | 'email_verification';

/**
 * Persisted Redis value for an email token.
 *
 * - `pending` — token has been issued but not yet verified. The hashed token is
 *   stored so that the verification step can compare a freshly hashed user
 *   input against {@link tokenHash} in constant time.
 * - `verified` — only used by the email-verification flow. Once the user has
 *   confirmed their code, the value is replaced with a `verified` marker so
 *   that a later registration call can confirm the email is owned without
 *   asking for the code again.
 */
export type EmailTokenValue =
    | { status: 'pending'; tokenHash: string }
    | { status: 'verified' };

/**
 * Redis-backed key-value store for email-token state. Keys are derived from
 * `(purpose, email)` pairs by the implementation; callers never see raw keys.
 */
export interface EmailTokenStore {
    /**
     * Persist {@link value} under `(purpose, email)` with the given TTL.
     * Overwrites any existing value for the same pair.
     *
     * @param purpose - Token purpose used to namespace the Redis key.
     * @param email - Normalized email address (lowercased, trimmed).
     * @param value - Persisted token state.
     * @param ttlSeconds - Lifetime of the entry in seconds.
     */
    set(
        purpose: EmailTokenPurpose,
        email: string,
        value: EmailTokenValue,
        ttlSeconds: number
    ): Promise<void>;

    /**
     * Read the persisted value for `(purpose, email)`, or `null` when no entry
     * exists or the entry has expired.
     */
    get(
        purpose: EmailTokenPurpose,
        email: string
    ): Promise<EmailTokenValue | null>;

    /**
     * Delete the entry for `(purpose, email)`. No-op when no entry exists.
     */
    delete(purpose: EmailTokenPurpose, email: string): Promise<void>;
}

/**
 * Abstraction for delivering transactional emails.
 *
 * Consumers inject their own implementation (Resend, SendGrid, SMTP, etc.)
 * into use-cases that need to dispatch email.
 */
export interface EmailDispatcher {
    /**
     * Send a transactional email message.
     *
     * @param message - Email payload to deliver.
     * @returns `true` when the message was accepted for delivery, `false` otherwise.
     */
    sendEmail(message: EmailMessage): Promise<boolean>;
}
