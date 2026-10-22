import { callBriefingAi } from '@/application/analysis/callBriefingAi';
import { dedupeGeneration } from '@/application/analysis/generationLock';
import type {
    RunMacroBriefingOptions,
    RunMacroBriefingResult,
} from '@/application/economy/types';
import { withComputedRegime } from '@/domain/economy/deriveMacroRegime';
import { buildMacroBriefingPrompt } from '@/domain/economy/macroBriefingPrompt';
import { normalizeMacroBriefing } from '@/domain/economy/normalizeMacroBriefing';
import type { EconomySnapshot } from '@/domain/types';
import {
    BRIEFING_MODEL_ID,
    buildMacroBriefingCacheKey,
    buildMacroBriefingDateBucket,
    MACRO_BRIEFING_CACHE_TTL,
} from '@/infrastructure/cache/config';
import { resolveCacheProvider } from '@/application/shared/resolveCacheProvider';
import type { CachedMacroBriefingData } from '@/infrastructure/cache/types';
import { hashMacroBriefingInput } from './macroBriefingInputHash';

/**
 * Run a macro (economy) briefing end-to-end: cache lookup → LLM call →
 * normalize → cache write → return.
 *
 * This is the direct (non-queued) replacement for the `submitMacroBriefing` +
 * `pollMacroBriefing` pair. The caller awaits a single promise; no job IDs, no
 * Redis meta, no polling loop.
 *
 * Mirrors {@link runBriefing} but for the `/economy` page — the cache is keyed
 * by UTC date (day bucket), the briefing model, and a deterministic hash of the
 * indicator/treasury/calendar snapshot. Macro briefings share the same
 * `callBriefingAi` path (Gemini/DeepSeek server key, no tier/BYOK concept).
 *
 * Concurrent calls for the same `cacheKey` are deduplicated via
 * `dedupeGeneration` (in-process and cross-instance): only one LLM call fires; all waiting callers
 * receive the same result.
 *
 * **`regime` is recomputed, not stored.** On every return — fresh, cache hit and
 * legacy cache entries alike — the briefing's `regime` is overwritten with the
 * value `deriveMacroRegime` computes from `data`, so it may differ from what the
 * model wrote or from what a cache entry holds. The prose (`summary`,
 * `highlights`) is untouched.
 *
 * Pass `options.signal` so a dropped connection aborts the in-flight LLM call.
 *
 * @throws If the AI provider call fails (network, 5xx, AbortError).
 *
 * @see submitMacroBriefing — the queued predecessor; still exported for the
 *   existing production path until siglens switches to runMacroBriefing.
 */
export async function runMacroBriefing(
    data: EconomySnapshot,
    options?: RunMacroBriefingOptions
): Promise<RunMacroBriefingResult> {
    const now = new Date();
    const dateBucket = buildMacroBriefingDateBucket(now);
    const inputHash = hashMacroBriefingInput(data);
    const cacheKey = buildMacroBriefingCacheKey(
        dateBucket,
        BRIEFING_MODEL_ID,
        inputHash
    );

    const cache = resolveCacheProvider(options?.cache);
    if (cache !== null) {
        try {
            const cached = await cache.get<CachedMacroBriefingData>(cacheKey);
            // briefing == null인 envelope은 cache miss로 처리 — peekMacroBriefingCache와
            // 동작 대칭. 그렇지 않으면 빈 summary briefing이 cached 상태로 반환돼 소비자가
            // 별도 비대칭 검사를 해야 한다.
            if (cached !== null && cached.briefing != null) {
                return {
                    status: 'cached',
                    briefing: withComputedRegime(
                        normalizeMacroBriefing(cached.briefing),
                        data
                    ),
                    generatedAt: cached.generatedAt,
                };
            }
        } catch (error) {
            console.error('[RunMacroBriefing] Cache read failed:', error);
        }
    }

    // This builder has no skills catalog and no separate system prompt —
    // `stable` is always '' (Design C), so `prompt` is `dynamic` alone.
    const { dynamic } = buildMacroBriefingPrompt(data, now);
    const prompt = dynamic;

    const raw = await dedupeGeneration(
        cache,
        cacheKey,
        () =>
            callBriefingAi({
                prompt,
                requestedModel: undefined,
                fallbackModel: BRIEFING_MODEL_ID,
                signal: options?.signal,
                correlationId: 'economy:macro-briefing',
            }),
        { signal: options?.signal }
    );

    const briefing = withComputedRegime(
        normalizeMacroBriefing(JSON.parse(raw) as unknown),
        data
    );
    const generatedAt = new Date().toISOString();

    if (!briefing.summary) {
        console.warn(
            '[RunMacroBriefing] Empty briefing — summary field absent'
        );
    }

    if (cache !== null) {
        // Fire-and-forget: cache write must not delay the response.
        cache
            .set(cacheKey, { briefing, generatedAt }, MACRO_BRIEFING_CACHE_TTL)
            .catch(error =>
                console.error('[RunMacroBriefing] Cache write failed:', error)
            );
    }

    // Usage invariant: macro briefings have no usage gate — no quota check or record.
    return { status: 'done', briefing, generatedAt };
}
