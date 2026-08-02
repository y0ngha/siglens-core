import { callBriefingAi } from '@/application/analysis/callBriefingAi';
import { dedupeInFlight } from '@/application/analysis/inFlight';
import type {
    RunBriefingOptions,
    RunBriefingResult,
} from '@/application/market/types';
import { buildMarketBriefingPrompt } from '@/domain/analysis/marketBriefingPrompt';
import { normalizeMarketBriefing } from '@/domain/analysis/normalizeMarketBriefing';
import { ISO_DATE_HOUR_PREFIX_LENGTH } from '@/domain/constants/format';
import type { MarketSummaryData } from '@/domain/types';
import {
    BRIEFING_MODEL_ID,
    buildBriefingCacheKey,
    MARKET_BRIEFING_CACHE_TTL,
} from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import type { CachedBriefingData } from '@/infrastructure/cache/types';
import { hashBriefingInput } from './briefingInputHash';

/**
 * Run a market briefing end-to-end: cache lookup → LLM call → normalize →
 * cache write → return.
 *
 * This is the direct (non-queued) replacement for the `submitBriefing` +
 * `pollBriefing` pair. The caller awaits a single promise; no job IDs, no
 * Redis meta, no polling loop.
 *
 * The briefing cache is keyed by the current ISO date+hour, the briefing model,
 * and a deterministic hash of the index/sector quote values — identical to the
 * submit path so cache entries are shared between the two paths.
 *
 * Briefings have no tier/BYOK concept — `callBriefingAi` always uses the
 * server key.
 *
 * Concurrent calls for the same `cacheKey` are deduplicated via
 * {@link dedupeInFlight}: only one LLM call fires; all waiting callers
 * receive the same result.
 *
 * Pass `options.signal` so a dropped connection aborts the in-flight LLM call.
 *
 * @throws If the AI provider call fails (network, 5xx, AbortError).
 *
 * @see submitBriefing — the queued predecessor; still exported for the
 *   existing production path until siglens switches to runBriefing.
 */
export async function runBriefing(
    data: MarketSummaryData,
    options?: RunBriefingOptions
): Promise<RunBriefingResult> {
    const now = new Date();
    const dateHour = now.toISOString().slice(0, ISO_DATE_HOUR_PREFIX_LENGTH);
    const inputHash = hashBriefingInput(data.indices, data.sectors);
    const cacheKey = buildBriefingCacheKey(
        dateHour,
        BRIEFING_MODEL_ID,
        inputHash
    );

    const cache = createCacheProvider();
    if (cache !== null) {
        try {
            const cached = await cache.get<CachedBriefingData>(cacheKey);
            if (cached !== null) {
                return {
                    status: 'cached',
                    briefing: normalizeMarketBriefing(cached.briefing),
                    generatedAt: cached.generatedAt,
                };
            }
        } catch (error) {
            console.error('[RunBriefing] Cache read failed:', error);
        }
    }

    // This builder has no skills catalog and no separate system prompt —
    // `stable` is always '' (Design C), so `prompt` is `dynamic` alone.
    const { dynamic } = buildMarketBriefingPrompt(data.indices, data.sectors);
    const prompt = dynamic;

    const raw = await dedupeInFlight(cacheKey, () =>
        callBriefingAi({
            prompt,
            requestedModel: undefined,
            fallbackModel: BRIEFING_MODEL_ID,
            signal: options?.signal,
            correlationId: 'market:briefing',
        })
    );

    const briefing = normalizeMarketBriefing(JSON.parse(raw) as unknown);
    const generatedAt = new Date().toISOString();

    if (!briefing.summary) {
        console.warn('[RunBriefing] Empty briefing — summary field absent');
    }

    if (cache !== null) {
        // Fire-and-forget: cache write must not delay the response.
        cache
            .set(cacheKey, { briefing, generatedAt }, MARKET_BRIEFING_CACHE_TTL)
            .catch(error =>
                console.error('[RunBriefing] Cache write failed:', error)
            );
    }

    // Usage invariant: briefings have no usage gate — no quota check or record.
    return { status: 'done', briefing, generatedAt };
}
