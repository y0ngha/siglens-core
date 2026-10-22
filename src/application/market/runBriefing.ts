import { callBriefingAi } from '@/application/analysis/callBriefingAi';
import { dedupeGeneration } from '@/application/analysis/generationLock';
import type {
    RunBriefingOptions,
    RunBriefingResult,
} from '@/application/market/types';
import { buildMarketBriefingPrompt } from '@/domain/analysis/marketBriefingPrompt';
import { normalizeMarketBriefing } from '@/domain/analysis/normalizeMarketBriefing';
import { ISO_DATE_HOUR_PREFIX_LENGTH } from '@/domain/constants/format';
import type { MarketBriefingContext, MarketSummaryData } from '@/domain/types';
import {
    BRIEFING_MODEL_ID,
    buildBriefingCacheKey,
    MARKET_BRIEFING_CACHE_TTL,
} from '@/infrastructure/cache/config';
import { resolveCacheProvider } from '@/application/shared/resolveCacheProvider';
import type { CachedBriefingData } from '@/infrastructure/cache/types';
import { hashBriefingInput } from './briefingInputHash';

/**
 * Run a market briefing end-to-end: cache lookup → LLM call → normalize →
 * cache write → return.
 *
 * The caller awaits a single promise; no job IDs, no
 * Redis meta, no polling loop.
 *
 * The briefing cache is keyed by the current ISO date+hour, the briefing model,
 * and a deterministic hash of the index/sector moves **bucketed** on a coarse
 * grid (`hashBriefingInput`) — the prompt carries the exact quotes, but an
 * intraday tick that stays inside its bucket reuses the slot's briefing instead
 * of re-billing the LLM. `peekBriefingCache` derives the identical key.
 *
 * Briefings have no tier/BYOK concept — `callBriefingAi` always uses the
 * server key.
 *
 * Concurrent calls for the same `cacheKey` are deduplicated via
 * `dedupeGeneration` (in-process and cross-instance): only one LLM call fires; all waiting callers
 * receive the same result.
 *
 * Pass `options.signal` so a dropped connection aborts the in-flight LLM call.
 *
 * `context` names the market and carries its volatility reading, if any — the
 * prompt refuses to ask for a volatility number the caller did not supply. It is
 * folded into `hashBriefingInput`, because it changes the prompt: two calls with
 * identical quotes but a different market label — or with the volatility reading
 * present in one and absent in the other — must not share a cached briefing.
 *
 * @throws {Error} If the AI provider call fails (network, 5xx, AbortError).
 */
export async function runBriefing(
    data: MarketSummaryData,
    context: MarketBriefingContext,
    options?: RunBriefingOptions
): Promise<RunBriefingResult> {
    const now = new Date();
    const dateHour = now.toISOString().slice(0, ISO_DATE_HOUR_PREFIX_LENGTH);
    const inputHash = hashBriefingInput(data.indices, data.sectors, context);
    const cacheKey = buildBriefingCacheKey(
        dateHour,
        BRIEFING_MODEL_ID,
        inputHash
    );

    const cache = resolveCacheProvider(options?.cache);
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
    const { dynamic } = buildMarketBriefingPrompt(
        data.indices,
        data.sectors,
        context
    );
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
                correlationId: 'market:briefing',
            }),
        { signal: options?.signal }
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
