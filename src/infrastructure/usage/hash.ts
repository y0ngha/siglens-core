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
 *
 * @remarks
 * **Known asymmetry vs the analysis cache day boundary.** The usage counter
 * here buckets by UTC `YYYY-MM-DD` (rollover at UTC 00:00), while the analysis
 * cache rolls over at KST 05:00 (= UTC 20:00 of the previous calendar day) —
 * see `CACHE_EXPIRY_HOUR_KST` in `infrastructure/cache/config.ts`. This
 * produces a 4-hour window each day where requests hit fresh cache (after the
 * cache boundary) but still count against the *previous* UTC usage day (until
 * UTC 00:00 ticks over). Aligning the two boundaries requires a stakeholder
 * decision on which axis to move; until then both files document this gap.
 */
export function hashUsageIp(clientIp: string, date: Date = new Date()): string {
    const utcDate = toUtcDateString(date);

    return createHash(SHA_256_ALGORITHM)
        .update(`${clientIp}:${utcDate}`)
        .digest(HEX_DIGEST_ENCODING);
}
