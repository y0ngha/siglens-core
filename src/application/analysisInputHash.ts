import { createHash } from 'node:crypto';

/** Length of the hex prefix (~64 bits) used for analysis cache input hashing. Collision probability is negligible at expected cardinalities. */
const ANALYSIS_INPUT_HASH_LENGTH = 16;

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
