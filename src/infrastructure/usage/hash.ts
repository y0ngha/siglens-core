import { createHash } from 'node:crypto';

const SHA_256_ALGORITHM = 'sha256';
const HEX_DIGEST_ENCODING = 'hex';
const UTC_DATE_LENGTH = 10;

/**
 * Shared UTC YYYY-MM-DD formatter used as the daily salt for usage hashing.
 * File-private — only consumed by {@link hashUsageIp} in this module.
 */
function toUtcDateString(date: Date): string {
    return date.toISOString().slice(0, UTC_DATE_LENGTH);
}

/**
 * Hash a client IP with a UTC daily salt so raw IP addresses are never stored.
 *
 * @param clientIp - Raw client IP address.
 * @param date - Date used to derive the UTC daily salt.
 * @returns SHA-256 hex digest of IP plus UTC date salt.
 */
export function hashUsageIp(clientIp: string, date: Date = new Date()): string {
    const utcDate = toUtcDateString(date);

    return createHash(SHA_256_ALGORITHM)
        .update(`${clientIp}:${utcDate}`)
        .digest(HEX_DIGEST_ENCODING);
}
