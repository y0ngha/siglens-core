import { normalizeOverallAnalysisResponse } from '@/domain/analysis/normalizeOverall';
import type { AnalysisLocale } from '@/domain/analysis/outputLocale';
import { DEFAULT_TIER, TIER_CONFIG, isTimeframeAllowed } from '@/domain/tier';
import type {
    ModelId,
    OverallAnalysisResponse,
    Tier,
    TierConfig,
    Timeframe,
} from '@/domain/types';
import { buildOverallPeekCacheKey } from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';

/**
 * `true` when a normalized overall analysis carries no narrative content —
 * empty headline + conclusion, no scenarios, and every bullet list empty.
 * Such a shape is the by-product of normalizing a poisoned / empty cached
 * payload, so the peek treats it as a cache miss rather than serving an empty
 * body.
 */
function isEmptyOverall(result: OverallAnalysisResponse): boolean {
    return (
        result.headlineKo.trim() === '' &&
        result.integratedConclusionKo.trim() === '' &&
        result.scenarios.length === 0 &&
        result.technicalBulletsKo.length === 0 &&
        result.fundamentalBulletsKo.length === 0 &&
        result.newsBulletsKo.length === 0 &&
        result.optionsBulletsKo.length === 0 &&
        result.riskFactorsKo.length === 0
    );
}

/**
 * Read a cached overall (4-axis) analysis WITHOUT triggering any generation.
 *
 * This is the read-only twin of {@link submitOverallAnalysis}: it surfaces the
 * most recently generated overall analysis for a symbol/timeframe/model so an
 * RSC can render it in SSR HTML for search-engine bots at zero LLM cost.
 *
 * **Why a separate "peek" key.** The canonical overall cache key
 * ({@link buildOverallCacheKey}) embeds an input hash derived from the four
 * resolved dependency-axis bodies (technical / fundamental / news / options).
 * A content-free caller — which has only `(symbol, companyName, timeframe,
 * modelId)` and no providers/news/snapshot — cannot reconstruct that hash
 * without resolving the axes (cache reads + potential generation), which would
 * violate the zero-side-effect contract. Instead, {@link pollOverallAnalysis}
 * writes every freshly normalized result under a second, content-free
 * "overwrite-latest" key ({@link buildOverallPeekCacheKey}); this function
 * reads that key. The trade-off is "latest cached" semantics rather than
 * "exact-input match", which is the right behaviour for bot/SSR surfacing.
 *
 * Zero side effects: no enqueue, no dependency resolution, no LLM call, no
 * market-data fetch, no writes. A cache miss, a missing cache provider
 * (Upstash env absent), a read error, or a corrupt / content-free cached
 * payload all resolve to `null`.
 *
 * @param symbol - U.S. equity ticker (canonical uppercase, matching the writer).
 * @param _companyName - Accepted for call-site symmetry with the overall submit
 *   inputs; the peek cache key is not scoped by company name, so this argument
 *   does not affect the lookup.
 * @param timeframe - Bar resolution used for the technical axis.
 * @param modelId - LLM model identifier. The peek key is model-scoped; pass the
 *   same `modelId` the overall analysis was generated under.
 * @param reasoning - Per-request deep-thinking toggle (member-reasoning-toggle
 *   spec, Part A). Omit to read the reasoning-OFF (pre-toggle) "latest"
 *   pointer — the default every existing caller reads today.
 * @param tier - Caller's resolved subscription tier. Gates which timeframes may
 *   be peeked, mirroring {@link peekAnalysisCache}'s tier gate (invariant 5),
 *   but ONLY that timeframe gate, not `peekAnalysisCache`'s info-depth field
 *   filtering. A disallowed caller-tier/timeframe combination resolves to
 *   `null` before the "latest" key is read, so a free/anon caller can never
 *   surface an intraday overall analysis that a member/pro submitter
 *   generated. `filterAnalysisResult` (per-field info-depth masking) is
 *   intentionally NOT applied here: `OverallAnalysisResponse` is a synthesized
 *   headline/bullet narrative with no per-field gated detail to mask, so there
 *   is nothing for that filter to act on. Defaults to {@link DEFAULT_TIER}.
 * @param tierConfig - Tier configuration override, mainly for tests and
 *   controlled rollouts. Defaults to {@link TIER_CONFIG}.
 * @returns The cached {@link OverallAnalysisResponse} on a valid hit, or `null`
 *   on a miss / corrupt entry / disallowed caller-tier timeframe.
 *
 * @example
 * ```ts
 * const cached = await peekOverallAnalysisCache(
 *     'AAPL',
 *     'Apple Inc.',
 *     '1Day',
 *     'gemini-3.6-flash'
 * );
 * if (cached !== null) return cached; // serve in SSR at zero cost
 * ```
 *
 * @see submitOverallAnalysis
 * @see pollOverallAnalysis
 */
export async function peekOverallAnalysisCache(
    symbol: string,
    _companyName: string,
    timeframe: Timeframe,
    modelId?: ModelId,
    reasoning?: boolean,
    tier: Tier = DEFAULT_TIER,
    tierConfig: TierConfig = TIER_CONFIG,
    locale?: AnalysisLocale
): Promise<OverallAnalysisResponse | null> {
    if (!isTimeframeAllowed(tier, timeframe, tierConfig)) return null;
    if (modelId === undefined) return null;

    const cache = createCacheProvider();
    if (cache === null) return null;

    // `locale` must match the writer's (`runOverallAnalysis` folds
    // `options.locale`). Omitting it reads the Korean pointer — non-ko pages
    // then served Korean prose (or missed their own language's entry).
    const cacheKey = buildOverallPeekCacheKey(
        symbol,
        timeframe,
        modelId,
        reasoning,
        locale
    );

    const cached = await cache
        .get<OverallAnalysisResponse>(cacheKey)
        .catch((error: unknown) => {
            console.error('[Peek] Overall cache read failed:', error);
            return null;
        });
    if (cached == null) return null;

    try {
        // No optionsOiStale context: staleness is a function of the *current*
        // request's snapshot, which a content-free peek does not have. Surface
        // the field as undefined (omitted) rather than a stale boolean.
        const result = normalizeOverallAnalysisResponse(cached);
        // Cache MISS semantics for poisoned entries: the normalizer never
        // returns null, so a corrupt/empty payload becomes a content-free
        // shape — treat that as a miss instead of serving an empty body.
        if (isEmptyOverall(result)) return null;
        return result;
    } catch (error) {
        // Corrupt string payload (e.g. invalid JSON) — normalizeOverallAnalysisResponse
        // can throw via extractJsonFromLlmResponse. Surface as a miss.
        console.error('[Peek] Overall cache payload invalid:', error);
        return null;
    }
}
