import {
    createHash,
    randomBytes,
    randomInt,
    timingSafeEqual,
} from 'node:crypto';

const NUMERIC_CODE_RADIX = 10;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/**
 * @internal Generate a high-entropy URL-safe token suitable for embedding in email links.
 *
 * @param byteLength - Number of random bytes to draw before base64url encoding.
 * @returns A base64url-encoded random string with no padding characters.
 */
export function generateUrlSafeToken(byteLength: number): string {
    return randomBytes(byteLength).toString('base64url');
}

/**
 * @internal Generate a fixed-length numeric verification code suitable for manual entry.
 *
 * Uses {@link randomInt} for cryptographically strong randomness with no modulo
 * bias. Leading zeros are preserved by left-padding to {@link digits}.
 *
 * @param digits - Number of digits in the resulting code; must be >= 1.
 * @returns A zero-padded numeric string of length {@link digits}.
 */
export function generateNumericCode(digits: number): string {
    const upperExclusive = Math.pow(NUMERIC_CODE_RADIX, digits);
    return randomInt(0, upperExclusive)
        .toString(NUMERIC_CODE_RADIX)
        .padStart(digits, '0');
}

/**
 * @internal Hash a raw token using SHA-256 for storage and lookup.
 *
 * Identical inputs always produce the same output, which is required so the
 * verification step can compare a freshly hashed user input against the
 * stored hash.
 *
 * @param rawToken - Raw token or numeric code supplied by the consumer.
 * @returns Hex-encoded SHA-256 digest of {@link rawToken}.
 */
export function hashEmailToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
}

/**
 * @internal Compare two SHA-256 hex digests in constant time.
 *
 * Inputs that are not the expected hex digest length are rejected without
 * comparison so that callers cannot accidentally compare strings of differing
 * lengths.
 *
 * @param a - First SHA-256 hex digest.
 * @param b - Second SHA-256 hex digest.
 * @returns Whether the digests are byte-for-byte equal.
 */
export function safeCompareTokenHashes(a: string, b: string): boolean {
    if (!SHA256_HEX_PATTERN.test(a) || !SHA256_HEX_PATTERN.test(b)) {
        return false;
    }
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
