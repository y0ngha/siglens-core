import { normalizeMarketBriefing } from '@/domain/analysis/normalizeMarketBriefing';
import { ISO_DATE_HOUR_PREFIX_LENGTH } from '@/domain/constants/format';
import type { MarketBriefingResponse, MarketSummaryData } from '@/domain/types';
import {
    BRIEFING_MODEL_ID,
    buildBriefingCacheKey,
} from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import type { CachedBriefingData } from '@/infrastructure/cache/types';
import { hashBriefingInput } from './briefingInputHash';

/**
 * Read a cached market briefing WITHOUT submitting a job (read-only twin of
 * {@link submitBriefing}'s `cached` branch). Reuses the EXACT same cache key
 * (date+hour + model + input hash) and `normalizeMarketBriefing` path, but omits
 * the worker dispatch entirely. Zero side effects.
 *
 * For SSR: an RSC surfaces a cached briefing in initial HTML at zero cost; a
 * cold cache (no provider / miss / read error) resolves to `null` so the client
 * can trigger generation through the normal submit path.
 *
 * @param data - Market summary input (indices + sector ETFs).
 * @param modelId - Briefing model id; defaults to BRIEFING_MODEL_ID (the same
 *   default submitBriefing writes under) so an un-modelled peek reads the same key.
 * @returns Normalized briefing on a hit, or `null` on miss/cold/error.
 *
 * @example
 * ```ts
 * const cached = await peekBriefingCache(summaryData);
 * if (cached) return cached; // serve from cache in SSR; else client submitBriefing()
 * ```
 *
 * @see submitBriefing
 * @see peekAnalysisCache
 */
export async function peekBriefingCache(
    data: MarketSummaryData,
    modelId: string = BRIEFING_MODEL_ID
): Promise<MarketBriefingResponse | null> {
    if (!data || !Array.isArray(data.indices) || !Array.isArray(data.sectors)) {
        return null;
    }
    const cache = createCacheProvider();
    if (cache === null) return null;

    const now = new Date();
    const dateHour = now.toISOString().slice(0, ISO_DATE_HOUR_PREFIX_LENGTH);
    const inputHash = hashBriefingInput(data.indices, data.sectors);
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
