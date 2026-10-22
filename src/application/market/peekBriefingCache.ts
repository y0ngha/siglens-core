import type { CacheOptions } from '@/application/types';
import { normalizeMarketBriefing } from '@/domain/analysis/normalizeMarketBriefing';
import { ISO_DATE_HOUR_PREFIX_LENGTH } from '@/domain/constants/format';
import type {
    MarketBriefingContext,
    MarketBriefingResponse,
    MarketSummaryData,
} from '@/domain/types';
import {
    BRIEFING_MODEL_ID,
    buildBriefingCacheKey,
} from '@/infrastructure/cache/config';
import { resolveCacheProvider } from '@/application/shared/resolveCacheProvider';
import type { CachedBriefingData } from '@/infrastructure/cache/types';
import { hashBriefingInput } from './briefingInputHash';

/**
 * Read a cached market briefing WITHOUT generating one (read-only twin of
 * the cache-hit branch of {@link runBriefing}). Reuses the EXACT same cache key
 * (date+hour + model + input hash) and `normalizeMarketBriefing` path, but omits
 * the LLM call entirely. Zero side effects.
 *
 * For SSR: an RSC surfaces a cached briefing in initial HTML at zero cost; a
 * cold cache (no provider / miss / read error) resolves to `null` so the client
 * can trigger generation through {@link runBriefing}.
 *
 * @param data - Market summary input (indices + sector ETFs).
 * @param modelId - Briefing model id; defaults to BRIEFING_MODEL_ID (the same
 *   default `runBriefing` writes under) so an un-modelled peek reads the same key.
 * @returns Normalized briefing on a hit, or `null` on miss/cold/error.
 *
 * @example
 * ```ts
 * const cached = await peekBriefingCache(summaryData, {
 *     marketLabel: '미국 증시',
 *     volatility: { label: 'VIX', level: 18.3 },
 * });
 * if (cached) return cached; // serve from cache in SSR; else client runBriefing()
 * ```
 *
 * `context` must match what `runBriefing` was called with — it is folded into
 * the same input hash, so a mismatch reads a key nothing ever wrote and the
 * peek silently misses forever.
 *
 * @see runBriefing
 * @see peekAnalysisCache
 *
 * @param cacheOptions - Optional `{ cache }` injection; omitted → the Upstash
 *   cache from env, `null` → no cache. See {@link CacheOptions}.
 */
export async function peekBriefingCache(
    data: MarketSummaryData,
    context: MarketBriefingContext,
    modelId: string = BRIEFING_MODEL_ID,
    cacheOptions?: CacheOptions
): Promise<MarketBriefingResponse | null> {
    if (!data || !Array.isArray(data.indices) || !Array.isArray(data.sectors)) {
        return null;
    }
    const cache = resolveCacheProvider(cacheOptions?.cache);
    if (cache === null) return null;

    const now = new Date();
    const dateHour = now.toISOString().slice(0, ISO_DATE_HOUR_PREFIX_LENGTH);
    const inputHash = hashBriefingInput(data.indices, data.sectors, context);
    const cacheKey = buildBriefingCacheKey(dateHour, modelId, inputHash);

    const cached = await cache
        .get<CachedBriefingData>(cacheKey)
        .catch((error: unknown) => {
            console.error('[Peek] Briefing cache read failed:', error);
            return null;
        });
    if (cached == null || cached.briefing == null) return null;

    try {
        return normalizeMarketBriefing(cached.briefing);
    } catch (error) {
        console.error('[Peek] Briefing cache payload invalid:', error);
        return null;
    }
}
