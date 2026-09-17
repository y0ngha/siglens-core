import {
    resolveMarketNewsDigestCacheKey,
    type MarketNewsDigestCacheKeyOptions,
} from '@/application/news/marketNewsDigestCacheKey';
import { normalizeNewsAnalysisResponse } from '@/domain/analysis/normalizeNews';
import type { NewsAnalysisResponse } from '@/domain/types';
import { createCacheProvider } from '@/infrastructure/cache/redis';

const LOG_TAG = '[MarketNewsDigest/Peek]' as const;

/**
 * Read a cached market-news category digest WITHOUT triggering generation —
 * read-only twin of {@link runMarketNewsDigest}'s `cached` branch. Derives the
 * EXACT same cache key (via the shared `resolveMarketNewsDigestCacheKey`) and
 * applies the same `normalizeNewsAnalysisResponse` path, but makes no LLM call,
 * registers no in-flight dedupe entry, and never writes the cache.
 *
 * For SSR: an RSC seeds the `/news/[category]` digest into initial HTML at zero
 * LLM cost; a cold cache (empty news / no provider / miss / read error) resolves
 * to `null` so the client can trigger generation through `runMarketNewsDigest`.
 *
 * Returns the bare {@link NewsAnalysisResponse} rather than the
 * `{ status: 'cached', result }` wrapper `runMarketNewsDigest` returns: the
 * only outcomes here are hit and miss, so a discriminant would carry no
 * information a `null` check does not, and the caller can hand the value
 * straight to the UI seed.
 *
 * `options` must match what `runMarketNewsDigest` is called with for the same
 * page — category, modelId, the news item IDs, skills, tier, reasoning and
 * locale all fold into the key, so a mismatch reads a key nothing ever wrote
 * and the peek silently misses forever.
 *
 * @param options - The key-participating subset of
 *   `SubmitMarketNewsDigestOptions`; runtime-only fields (`force`, `signal`, …)
 *   are irrelevant to a read and are not accepted.
 * @returns Normalized digest on a hit, or `null` on miss/cold/error.
 *
 * @example
 * ```ts
 * const cached = await peekMarketNewsDigestCache({
 *     category,
 *     modelId,
 *     news,
 *     reasoning: true,
 * });
 * if (cached) return cached; // zero-LLM-cost SSR seed; else run the full path
 * ```
 *
 * @see runMarketNewsDigest
 */
export async function peekMarketNewsDigestCache(
    options: MarketNewsDigestCacheKeyOptions
): Promise<NewsAnalysisResponse | null> {
    if (options.news.length === 0) return null;

    const cache = createCacheProvider();
    if (cache === null) return null;

    const { cacheKey } = resolveMarketNewsDigestCacheKey(options);

    const cached = await cache
        .get<NewsAnalysisResponse>(cacheKey)
        .catch((error: unknown) => {
            console.error(LOG_TAG, 'Cache read failed:', error);
            return null;
        });
    if (cached === null || cached === undefined) return null;

    // normalizeNewsAnalysisResponse parses via parseLlmPayload, which throws
    // SyntaxError on a corrupted/non-JSON cached string. This is an SSR seed
    // that must never throw, so any failure here is swallowed to a miss —
    // same posture as the cache.get().catch() above.
    try {
        return normalizeNewsAnalysisResponse(cached);
    } catch (error: unknown) {
        console.error(LOG_TAG, 'Cached payload normalize failed:', error);
        return null;
    }
}
