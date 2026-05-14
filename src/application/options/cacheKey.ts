import { CACHE_KEY_SCHEMA_VERSION } from '@/infrastructure/cache/config';

/**
 * Build the cache key for an options analysis result. Includes the package
 * schema version prefix so future shape changes invalidate the cache
 * automatically (matches the existing analysis cache key conventions in
 * `infrastructure/cache/config.ts`).
 *
 * Inputs that affect the AI output (and thus the key):
 *  - symbol
 *  - expirationDate ('YYYY-MM-DD' or 'all')
 *  - modelId
 *  - snapshot input hash (so a fresher snapshot produces a new key)
 */
export function buildOptionsCacheKey(
    symbol: string,
    expirationDate: string,
    modelId: string,
    snapshotInputHash: string
): string {
    return `${CACHE_KEY_SCHEMA_VERSION}:analysis:options:${symbol}:${expirationDate}:${modelId}:${snapshotInputHash}`;
}
