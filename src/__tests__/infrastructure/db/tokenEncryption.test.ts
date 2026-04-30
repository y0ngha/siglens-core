import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    decryptToken,
    encryptToken,
    tryReadEncryptionKey,
} from '@/infrastructure/db/tokenEncryption';

const VALID_KEY_HEX = '0'.repeat(64);

describe('encryptToken / decryptToken', () => {
    it('round-trips a plain-text token through encrypt then decrypt', () => {
        const plaintext = 'ya29.google-access-token';
        const encrypted = encryptToken(plaintext, VALID_KEY_HEX);
        const decrypted = decryptToken(encrypted, VALID_KEY_HEX);
        expect(decrypted).toBe(plaintext);
    });

    it('produces different ciphertexts for the same input (random IV)', () => {
        const plaintext = 'same-token';
        const first = encryptToken(plaintext, VALID_KEY_HEX);
        const second = encryptToken(plaintext, VALID_KEY_HEX);
        expect(first).not.toBe(second);
    });

    it('returns null when the encrypted string has an unexpected format', () => {
        expect(decryptToken('notvalid', VALID_KEY_HEX)).toBeNull();
        expect(decryptToken('a:b', VALID_KEY_HEX)).toBeNull();
    });

    it('returns null when decrypted with the wrong key', () => {
        const encrypted = encryptToken('secret', VALID_KEY_HEX);
        const wrongKey = 'f'.repeat(64);
        expect(decryptToken(encrypted, wrongKey)).toBeNull();
    });

    it('returns null for a corrupted ciphertext', () => {
        const encrypted = encryptToken('secret', VALID_KEY_HEX);
        const parts = encrypted.split(':');
        const corrupted = `${parts[0]}:AAAA:${parts[2]}`;
        expect(decryptToken(corrupted, VALID_KEY_HEX)).toBeNull();
    });
});

describe('tryReadEncryptionKey', () => {
    const originalEnv = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;

    beforeEach(() => {
        delete process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
    });

    afterEach(() => {
        if (originalEnv === undefined) {
            delete process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
        } else {
            process.env.OAUTH_TOKEN_ENCRYPTION_KEY = originalEnv;
        }
    });

    it('returns null when the env var is absent', () => {
        expect(tryReadEncryptionKey()).toBeNull();
    });

    it('returns the key when the env var is a valid 32-byte hex string', () => {
        process.env.OAUTH_TOKEN_ENCRYPTION_KEY = VALID_KEY_HEX;
        expect(tryReadEncryptionKey()).toBe(VALID_KEY_HEX);
    });

    it('returns null when the env var is too short', () => {
        process.env.OAUTH_TOKEN_ENCRYPTION_KEY = '0'.repeat(62);
        expect(tryReadEncryptionKey()).toBeNull();
    });

    it('returns null when the env var is too long', () => {
        process.env.OAUTH_TOKEN_ENCRYPTION_KEY = '0'.repeat(66);
        expect(tryReadEncryptionKey()).toBeNull();
    });
});
