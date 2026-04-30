import { describe, expect, it } from 'vitest';
import {
    buildPasswordResetEmail,
    PASSWORD_RESET_SUBJECT,
} from '@/domain/auth/emailTemplates';

const baseInput = {
    to: 'user@example.com',
    token: 'test-token-123',
    expiresAt: new Date('2026-05-01T01:00:00.000Z'),
    baseUrl: 'https://example.com/reset-password',
};

describe('buildPasswordResetEmail', () => {
    it('sets recipient to the provided email address', () => {
        const message = buildPasswordResetEmail(baseInput);
        expect(message.to).toBe('user@example.com');
    });

    it('uses the password reset subject line', () => {
        const message = buildPasswordResetEmail(baseInput);
        expect(message.subject).toBe(PASSWORD_RESET_SUBJECT);
    });

    it('embeds the reset URL with token in the html body', () => {
        const message = buildPasswordResetEmail(baseInput);
        expect(message.html).toContain(
            'https://example.com/reset-password?token=test-token-123'
        );
    });

    it('embeds the reset URL with token in the text body', () => {
        const message = buildPasswordResetEmail(baseInput);
        expect(message.text).toContain(
            'https://example.com/reset-password?token=test-token-123'
        );
    });

    it('includes the expiry timestamp in the html body', () => {
        const message = buildPasswordResetEmail(baseInput);
        expect(message.html).toContain(baseInput.expiresAt.toUTCString());
    });

    it('includes the expiry timestamp in the text body', () => {
        const message = buildPasswordResetEmail(baseInput);
        expect(message.text).toContain(baseInput.expiresAt.toUTCString());
    });

    it('constructs the reset URL correctly when baseUrl ends without a trailing slash', () => {
        const message = buildPasswordResetEmail({
            ...baseInput,
            baseUrl: 'https://app.example.com/auth/reset',
        });
        expect(message.html).toContain(
            'https://app.example.com/auth/reset?token=test-token-123'
        );
    });

    it('returns a different reset URL for a different token', () => {
        const messageA = buildPasswordResetEmail({
            ...baseInput,
            token: 'token-a',
        });
        const messageB = buildPasswordResetEmail({
            ...baseInput,
            token: 'token-b',
        });
        expect(messageA.html).toContain('token=token-a');
        expect(messageB.html).toContain('token=token-b');
        expect(messageA.html).not.toContain('token-b');
    });
});
