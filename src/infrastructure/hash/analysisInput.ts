import { createHash } from 'node:crypto';

/** Length of the hex prefix (~64 bits) used for analysis cache input hashing. Collision probability is negligible at expected cardinalities. */
const ANALYSIS_INPUT_HASH_LENGTH = 16;

/** Length of the hex prefix (~32 bits) read from the digest to derive a seed. */
const SEED_HEX_LENGTH = 8;

/** @internal Mask keeping the seed a non-negative signed 32-bit integer. */
export const MAX_INT32 = 0x7fffffff;

/** Full lowercase-hex SHA-256 digest of the input. */
function sha256Hex(input: string): string {
    return createHash('sha256').update(input).digest('hex');
}

/**
 * @internal
 * Compute a deterministic SHA-256 hash of a serialized input, truncated for cache key use.
 *
 * @param serialized - String to hash (typically `JSON.stringify(snapshot)` or sorted-id-join).
 * @returns 16-character lowercase hex prefix of the SHA-256 digest.
 */
export function hashAnalysisInput(serialized: string): string {
    return sha256Hex(serialized).slice(0, ANALYSIS_INPUT_HASH_LENGTH);
}

/**
 * @internal
 * Derive a deterministic non-negative 31-bit integer seed from a serialized
 * input. Same input → same seed, giving reproducible generation on providers
 * that accept a seed.
 */
export function analysisSeed(serialized: string): number {
    return (
        parseInt(sha256Hex(serialized).slice(0, SEED_HEX_LENGTH), 16) &
        MAX_INT32
    );
}
