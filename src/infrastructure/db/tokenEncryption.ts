import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTE_LENGTH = 32;
const IV_BYTE_LENGTH = 12;
const SEPARATOR = ':';
const PARTS_COUNT = 3;

/**
 * @internal Encrypt a plain-text OAuth token using AES-256-GCM.
 * Returns a `iv:ciphertext:tag` base64 string suitable for database storage.
 */
export function encryptToken(plaintext: string, keyHex: string): string {
    const key = Buffer.from(keyHex, 'hex');
    const iv = randomBytes(IV_BYTE_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
        iv.toString('base64'),
        ciphertext.toString('base64'),
        tag.toString('base64'),
    ].join(SEPARATOR);
}

/**
 * @internal Decrypt a token produced by {@link encryptToken}.
 * Returns the plaintext, or null when decryption fails (wrong key, corrupted data).
 */
export function decryptToken(encrypted: string, keyHex: string): string | null {
    const parts = encrypted.split(SEPARATOR);
    if (parts.length !== PARTS_COUNT) {
        return null;
    }

    try {
        const key = Buffer.from(keyHex, 'hex');
        const iv = Buffer.from(parts[0]!, 'base64');
        const ciphertext = Buffer.from(parts[1]!, 'base64');
        const tag = Buffer.from(parts[2]!, 'base64');
        const decipher = createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);
        return decipher.update(ciphertext) + decipher.final('utf8');
    } catch {
        return null;
    }
}

/**
 * @internal Read and validate the OAuth token encryption key from the environment.
 * Returns the hex key string when valid, or null when absent or incorrectly sized.
 */
export function tryReadEncryptionKey(): string | null {
    const raw = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
    if (!raw) {
        return null;
    }
    const bytes = Buffer.from(raw, 'hex');
    return bytes.length === KEY_BYTE_LENGTH ? raw : null;
}
