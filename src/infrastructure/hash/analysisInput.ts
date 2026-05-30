import { createHash } from 'node:crypto';

/** Length of the hex prefix (~64 bits) used for analysis cache input hashing. Collision probability is negligible at expected cardinalities. */
const ANALYSIS_INPUT_HASH_LENGTH = 16;

/** Length of the hex prefix (~32 bits) read from the digest to derive a seed. */
const SEED_HEX_LENGTH = 8;

/** Mask keeping the seed a non-negative signed 32-bit integer. */
const MAX_INT32 = 0x7fffffff;

/**
 * Compute a deterministic SHA-256 hash of a serialized input, truncated for cache key use.
 *
 * @param serialized - String to hash (typically `JSON.stringify(snapshot)` or sorted-id-join).
 * @returns 16-character lowercase hex prefix of the SHA-256 digest.
 * @internal
 */
export function hashAnalysisInput(serialized: string): string {
    return createHash('sha256')
        .update(serialized)
        .digest('hex')
        .slice(0, ANALYSIS_INPUT_HASH_LENGTH);
}

/**
 * @internal
 * Derive a deterministic non-negative 31-bit integer seed from a serialized
 * input. Same input → same seed, giving reproducible generation on providers
 * that accept a seed.
 */
export function analysisSeed(serialized: string): number {
    const hex = createHash('sha256')
        .update(serialized)
        .digest('hex')
        .slice(0, SEED_HEX_LENGTH);
    return parseInt(hex, 16) & MAX_INT32;
}
