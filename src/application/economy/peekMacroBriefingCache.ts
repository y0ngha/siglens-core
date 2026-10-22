import type { CacheOptions } from '@/application/types';
import type { MacroBriefingCacheEntry } from '@/application/economy/types';
import { withComputedRegime } from '@/domain/economy/deriveMacroRegime';
import { normalizeMacroBriefing } from '@/domain/economy/normalizeMacroBriefing';
import type { EconomySnapshot, MacroBriefingResponse } from '@/domain/types';
import {
    BRIEFING_MODEL_ID,
    buildMacroBriefingCacheKey,
    buildMacroBriefingDateBucket,
} from '@/infrastructure/cache/config';
import { resolveCacheProvider } from '@/application/shared/resolveCacheProvider';
import type { CachedMacroBriefingData } from '@/infrastructure/cache/types';
import { hashMacroBriefingInput } from './macroBriefingInputHash';

/**
 * Read a cached macro briefing WITHOUT submitting a job — read-only twin of
 * {@link runMacroBriefing}'s `cached` branch. Reuses the EXACT same cache key
 * (UTC day bucket + model + input hash, via `buildMacroBriefingDateBucket`) and
 * `normalizeMacroBriefing` path, but omits the LLM call entirely. Zero side
 * effects.
 *
 * On a cache hit, returns the cached briefing with zero additional I/O, making
 * it safe to call at the start of any server-side handler. On a cold cache
 * (no provider / miss / read error), returns `null` so callers can fall back
 * to the full run path.
 *
 * **`regime` is recomputed, not stored.** On every return — cache hits and legacy
 * cache entries alike — the briefing's `regime` is overwritten with the
 * value `deriveMacroRegime` computes from `data`, so it may differ from what the
 * model wrote or from what a cache entry holds. The prose (`summary`,
 * `highlights`) is untouched.
 *
 * @param data - Economy snapshot (indicators + treasury + calendar). Accepts
 *   `null` / `undefined` so JavaScript callers (or callers whose snapshot
 *   producer can short-circuit) can pass through without an extra guard; both
 *   resolve to `null` immediately.
 * @param modelId - Briefing model id; defaults to BRIEFING_MODEL_ID so an
 *   un-modelled peek reads the same key the writer uses.
 * @param cacheOptions - Optional `{ cache }` injection; omitted → the Upstash
 *   cache from env, `null` → no cache. See {@link CacheOptions}.
 * @returns Normalized briefing on a hit, or `null` on miss/cold/error.
 *
 * @example
 * ```ts
 * const cached = await peekMacroBriefingCache(economySnapshot);
 * if (cached) return cached; // zero-LLM-cost surface; else fall back to run
 * ```
 *
 * @see peekMacroBriefingCacheEntry — same read, plus the `generatedAt` stamp.
 */
export async function peekMacroBriefingCache(
    data: EconomySnapshot | null | undefined,
    modelId: string = BRIEFING_MODEL_ID,
    cacheOptions?: CacheOptions
): Promise<MacroBriefingResponse | null> {
    const entry = await peekMacroBriefingCacheEntry(
        data,
        modelId,
        cacheOptions
    );
    return entry === null ? null : entry.briefing;
}

/**
 * Same read-only lookup as {@link peekMacroBriefingCache}, but also returns
 * when the briefing was generated so the UI can show a "generated at" time on
 * a day-cached briefing. Additive — {@link peekMacroBriefingCache} keeps its
 * signature.
 *
 * As with {@link peekMacroBriefingCache}, the returned `briefing.regime` is
 * recomputed from `data` on every read (legacy entries included) and may differ
 * from the stored value.
 *
 * `generatedAt` is the ISO timestamp stored in the cache envelope by
 * `runMacroBriefing`; it is `null` only for a legacy entry written without it.
 *
 * @param data - The economy snapshot the briefing was generated from (its hash is part of the key).
 * @param modelId - Briefing model id used in the cache key; defaults to `BRIEFING_MODEL_ID`.
 * @param cacheOptions - Optional `{ cache }` injection; omitted → the Upstash
 *   cache from env, `null` → no cache. See {@link CacheOptions}.
 * @returns `{ briefing, generatedAt }` on a hit, or `null` on miss/cold/error.
 */
export async function peekMacroBriefingCacheEntry(
    data: EconomySnapshot | null | undefined,
    modelId: string = BRIEFING_MODEL_ID,
    cacheOptions?: CacheOptions
): Promise<MacroBriefingCacheEntry | null> {
    if (!data) return null;
    const cache = resolveCacheProvider(cacheOptions?.cache);
    if (cache === null) return null;

    const dateBucket = buildMacroBriefingDateBucket(new Date());
    const inputHash = hashMacroBriefingInput(data);
    const cacheKey = buildMacroBriefingCacheKey(dateBucket, modelId, inputHash);

    const cached = await cache
        .get<CachedMacroBriefingData>(cacheKey)
        .catch((error: unknown) => {
            console.error('[MacroBriefing/Peek] Cache read failed:', error);
            return null;
        });
    if (cached == null || cached.briefing == null) return null;

    // normalizeMacroBriefing is designed to never throw — it returns a
    // well-formed default for null/undefined/malformed input — so no catch is needed.
    return {
        briefing: withComputedRegime(
            normalizeMacroBriefing(cached.briefing),
            data
        ),
        // `CachedBriefingData.generatedAt` is typed `string`, but entries written
        // before it was stored come back from Redis without it — the runtime
        // check turns that legacy shape into the documented `null`.
        generatedAt:
            typeof cached.generatedAt === 'string' ? cached.generatedAt : null,
    };
}
