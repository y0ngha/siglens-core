import { normalizeMacroBriefing } from '@/domain/economy/normalizeMacroBriefing';
import { ISO_DATE_HOUR_PREFIX_LENGTH } from '@/domain/constants/format';
import type { EconomySnapshot, MacroBriefingResponse } from '@/domain/types';
import {
    BRIEFING_MODEL_ID,
    buildMacroBriefingCacheKey,
} from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import type { CachedMacroBriefingData } from '@/infrastructure/cache/types';
import { hashMacroBriefingInput } from './macroBriefingInputHash';

/**
 * Read a cached macro briefing WITHOUT submitting a job — read-only twin of
 * {@link submitMacroBriefing}'s `cached` branch. Reuses the EXACT same cache key
 * (date+hour + model + input hash) and `normalizeMacroBriefing` path, but omits
 * the worker dispatch entirely. Zero side effects.
 *
 * On a cache hit, returns the cached briefing with zero additional I/O, making
 * it safe to call at the start of any server-side handler. On a cold cache
 * (no provider / miss / read error), returns `null` so callers can fall back
 * to the full submit path.
 *
 * @param data - Economy snapshot (indicators + treasury + calendar). Accepts
 *   `null` / `undefined` so JavaScript callers (or callers whose snapshot
 *   producer can short-circuit) can pass through without an extra guard; both
 *   resolve to `null` immediately.
 * @param modelId - Briefing model id; defaults to BRIEFING_MODEL_ID so an
 *   un-modelled peek reads the same key submitMacroBriefing writes under.
 * @returns Normalized briefing on a hit, or `null` on miss/cold/error.
 *
 * @example
 * ```ts
 * const cached = await peekMacroBriefingCache(economySnapshot);
 * if (cached) return cached; // zero-LLM-cost surface; else fall back to submit
 * ```
 *
 * @see submitMacroBriefing
 */
export async function peekMacroBriefingCache(
    data: EconomySnapshot | null | undefined,
    modelId: string = BRIEFING_MODEL_ID
): Promise<MacroBriefingResponse | null> {
    if (!data) return null;
    const cache = createCacheProvider();
    if (cache === null) return null;

    const now = new Date();
    const dateHour = now.toISOString().slice(0, ISO_DATE_HOUR_PREFIX_LENGTH);
    const inputHash = hashMacroBriefingInput(data);
    const cacheKey = buildMacroBriefingCacheKey(dateHour, modelId, inputHash);

    const cached = await cache
        .get<CachedMacroBriefingData>(cacheKey)
        .catch((error: unknown) => {
            console.error('[MacroBriefing/Peek] Cache read failed:', error);
            return null;
        });
    if (cached == null || cached.briefing == null) return null;

    // normalizeMacroBriefing is designed to never throw — it returns a
    // well-formed default for null/undefined/malformed input — so no catch is needed.
    return normalizeMacroBriefing(cached.briefing);
}
