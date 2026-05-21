import type { OptionsExpirationFilter } from '@/domain/types';
import { CACHE_KEY_SCHEMA_VERSION } from '@/infrastructure/cache/config';

/**
 * Build the cache key for an options analysis result. Includes the package
 * schema version prefix so future shape changes invalidate the cache
 * automatically (matches the existing analysis cache key conventions in
 * `infrastructure/cache/config.ts`).
 *
 * @param symbol - Underlying ticker (uppercase).
 * @param expirationDate - {@link OptionsExpirationFilter} — `'YYYY-MM-DD'` or
 *   the `'all'` sentinel for aggregate analysis across every available
 *   expiration. Typed as the named alias (not bare `string`) so the contract
 *   matches the use-case-layer signatures that produce this value.
 * @param modelId - LLM model identifier scoping the cache.
 * @param snapshotInputHash - Hash of the snapshot inputs — a fresher
 *   snapshot produces a different hash and therefore a new cache entry.
 * @returns Composite Redis key suitable for `cache.get` / `cache.set`.
 *
 * @example
 * ```ts
 * const key = buildOptionsCacheKey(
 *     'AAPL',
 *     '2026-06-20',
 *     'gemini-2.5-flash',
 *     hashAnalysisInput(JSON.stringify(snapshotDigest))
 * );
 * const cached = await cache.get<OptionsAnalysisResponse>(key);
 * ```
 */
export function buildOptionsCacheKey(
    symbol: string,
    expirationDate: OptionsExpirationFilter,
    modelId: string,
    snapshotInputHash: string
): string {
    return `${CACHE_KEY_SCHEMA_VERSION}:analysis:options:${symbol}:${expirationDate}:${modelId}:${snapshotInputHash}`;
}
