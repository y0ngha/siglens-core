import type {
    BuildPasswordResetEmailInput,
    EmailMessage,
} from '@/domain/types';

/** @internal Subject line for password reset emails. */
export const PASSWORD_RESET_SUBJECT = 'Password Reset Request';

/**
 * Build a password reset email message from a raw token and expiry.
 *
 * The reset URL is constructed as `${baseUrl}?token=${token}`.
 *
 * @param input - Recipient address, raw token, expiry timestamp, and base URL.
 * @returns A fully-formed email message ready for delivery.
 *
 * @example
 * ```typescript
 * const message = buildPasswordResetEmail({
 *   to: 'user@example.com',
 *   token: 'raw-token',
 *   expiresAt: new Date('2026-05-01T01:00:00Z'),
 *   baseUrl: 'https://example.com/reset-password',
 * });
 * ```
 */
export function buildPasswordResetEmail(
    input: BuildPasswordResetEmailInput
): EmailMessage {
    const resetUrl = `${input.baseUrl}?token=${input.token}`;
    const expiresAtStr = input.expiresAt.toUTCString();

    const html = [
        '<p>You requested a password reset for your account.</p>',
        `<p><a href="${resetUrl}">Click here to reset your password</a></p>`,
        `<p>This link expires at <strong>${expiresAtStr}</strong>.</p>`,
        '<p>If you did not request a password reset, you can safely ignore this email.</p>',
    ].join('\n');

    const text = [
        'You requested a password reset for your account.',
        `Reset your password here: ${resetUrl}`,
        `This link expires at ${expiresAtStr}.`,
        'If you did not request a password reset, you can safely ignore this email.',
    ].join('\n');

    return {
        to: input.to,
        subject: PASSWORD_RESET_SUBJECT,
        html,
        text,
    };
}
