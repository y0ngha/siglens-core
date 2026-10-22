import type { CacheOptions } from '@/application/types';
import {
    EMPTY_ANALYSIS_FALLBACK_SUMMARY,
    normalizeCachedAnalysisResponse,
} from '@/domain/analysis/confidence';
import { filterAnalysisResult } from '@/domain/analysis/filterAnalysisResult';
import type { AnalysisLocale } from '@/domain/analysis/outputLocale';
import { DEFAULT_TIER, TIER_CONFIG, isTimeframeAllowed } from '@/domain/tier';
import type {
    AnalysisResponse,
    FilteredAnalysisResult,
    ModelId,
    PositionBucket,
    Tier,
    TierConfig,
    Timeframe,
} from '@/domain/types';
import {
    buildAnalysisPeekCacheKey,
    DEFAULT_ANALYSIS_MODEL_ID,
} from '@/infrastructure/cache/config';
import { resolveCacheProvider } from '@/application/shared/resolveCacheProvider';

/**
 * `true` when a normalized analysis carries no analytical content — i.e. an
 * empty or fallback summary and every analytical array empty. Such a shape is
 * the by-product of normalizing a poisoned / empty cached payload (the writer
 * never persists it; see `pollAnalysis`'s `isFallbackAnalysis` skip), so the
 * peek treats it as a cache miss rather than serving an empty body.
 *
 * @internal Shared with `runAnalysis`'s overall reuse path; not exported from
 * the package entrypoints.
 */
export function isEmptyAnalysis(result: AnalysisResponse): boolean {
    const summary = result.summary.trim();
    const summaryIsEmpty =
        summary === '' || summary === EMPTY_ANALYSIS_FALLBACK_SUMMARY;
    return (
        summaryIsEmpty &&
        result.indicatorResults.length === 0 &&
        result.patternSummaries.length === 0 &&
        result.strategyResults.length === 0 &&
        result.candlePatterns.length === 0 &&
        result.trendlines.length === 0 &&
        result.keyLevels.support.length === 0 &&
        result.keyLevels.resistance.length === 0 &&
        (result.priceTargets.bullish?.targets.length ?? 0) === 0 &&
        (result.priceTargets.bearish?.targets.length ?? 0) === 0
    );
}

/**
 * Read a cached technical analysis WITHOUT triggering any generation.
 *
 * This is the read-only twin of {@link runAnalysis}: it reuses the exact
 * same internal cache key (`buildAnalysisCacheKey`) and the exact same read +
 * validate path (the cache from `cacheOptions.cache`, or the env-configured
 * Upstash default when omitted, plus the internal
 * `normalizeCachedAnalysisResponse` normalizer) that `runAnalysis`
 * runs on a cache hit — but it omits the enqueue/fetch/generate branch entirely.
 *
 * Intended for search-engine bots in Server-Side Rendering: an RSC can surface
 * a cached analysis in the initial HTML at zero LLM cost, and render a fallback
 * (or trigger generation through the normal `runAnalysis` path on a real
 * user request) when the cache is cold.
 *
 * Zero side effects: no job creation, no LLM call, no market-data fetch, no
 * writes. A cache miss, a missing cache provider (Upstash env absent), a read
 * error, or a corrupt/empty cached payload all resolve to `null`.
 *
 * The "corrupt → null" guard is necessary because the internal
 * `normalizeCachedAnalysisResponse` normalizer never throws on a non-string
 * garbage payload — it synthesises a content-free shape (empty/fallback summary,
 * all arrays empty). The internal `isEmptyAnalysis` check detects that shape so a
 * poisoned or empty cache entry surfaces as a miss (`null`) rather than as an
 * empty body.
 * (`pollAnalysis` already refuses to *write* such fallback shapes — see its
 * `isFallbackAnalysis` guard — so a valid HIT always carries real content.)
 *
 * @param symbol - U.S. equity ticker (canonical uppercase, matching the writer).
 * @param timeframe - Bar resolution literal.
 * @param _fmpSymbol - Currently unused: the technical analysis cache key is not
 *   scoped by `fmpSymbol`, so this argument does not affect the lookup. Retained
 *   in the signature for API-surface familiarity with `runAnalysis` (a caller
 *   that already tracks an `fmpSymbol` can keep passing it). Note the positions
 *   differ — `runAnalysis(symbol, companyName, timeframe, force?, fmpSymbol?, options?)`
 *   carries it at index 4, whereas it sits at index 2 here — so this is not a
 *   drop-in positional match.
 * @param modelId - LLM model identifier. Defaults to the internal
 *   `DEFAULT_ANALYSIS_MODEL_ID` — the same default `runAnalysis`
 *   applies — so an un-modelled peek reads the same key the writer wrote.
 * @param reasoning - Per-request deep-thinking toggle. Omit to read the reasoning-OFF (pre-toggle) key — the
 *   default every existing caller reads today.
 * @param tier - Caller's resolved subscription tier. Gates which timeframes may
 *   be peeked, mirroring {@link peekOverallAnalysisCache}'s tier gate (invariant 5): a
 *   disallowed caller-tier/timeframe combination resolves to `null` before the
 *   cache is even read, so a free/anon caller can never surface an intraday
 *   analysis that a member/pro submitter generated. Defaults to {@link DEFAULT_TIER}.
 * @param tierConfig - Tier configuration override, mainly for tests and
 *   controlled rollouts. Defaults to {@link TIER_CONFIG}.
 * @param positionBucket - Member position-bucket hint. Must be
 *   passed IDENTICALLY to how the writer (`runAnalysis`) derived it so
 *   peek and submit read/write the same cache entry. Pass `undefined` for
 *   the anonymous/SSR no-bucket path, which keeps the cache key byte-identical
 *   to the legacy (pre-position-bucket) key — the default every existing
 *   caller reads today.
 * @param locale - Output language of the page/caller. Omitted = `'ko'` (the
 *   default, byte-identical key). Non-ko pages must pass it, or they read the
 *   Korean entry.
 * @returns The tier-filtered cached response on a valid hit, or `null` on a
 *   miss / corrupt entry / disallowed caller-tier timeframe.
 *
 * @example
 * ```ts
 * const cached = await peekAnalysisCache('AAPL', '1Day');
 * if (cached !== null) return cached.result; // serve in SSR at zero cost
 * ```
 *
 * @see runAnalysis
 *
 * @param cacheOptions - Optional `{ cache }` injection; omitted → the Upstash
 *   cache from env, `null` → no cache. See {@link CacheOptions}.
 */
export async function peekAnalysisCache(
    symbol: string,
    timeframe: Timeframe,
    _fmpSymbol?: string,
    modelId?: ModelId,
    reasoning?: boolean,
    tier: Tier = DEFAULT_TIER,
    tierConfig: TierConfig = TIER_CONFIG,
    positionBucket?: PositionBucket,
    locale?: AnalysisLocale,
    cacheOptions?: CacheOptions
): Promise<FilteredAnalysisResult | null> {
    if (!isTimeframeAllowed(tier, timeframe, tierConfig)) return null;

    const cache = resolveCacheProvider(cacheOptions?.cache);
    if (cache === null) return null;

    const effectiveModelId = modelId ?? DEFAULT_ANALYSIS_MODEL_ID;
    // Reads the peek pointer, not the exact key — see buildAnalysisPeekCacheKey
    // for why the exact key is unreachable from a read-only caller.
    const cacheKey = buildAnalysisPeekCacheKey(
        symbol,
        timeframe,
        effectiveModelId,
        tier,
        reasoning,
        positionBucket,
        locale
    );

    const cached = await cache
        .get<AnalysisResponse>(cacheKey)
        .catch((error: unknown) => {
            console.error('[Peek] Analysis cache read failed:', error);
            return null;
        });
    if (cached == null) return null;

    try {
        const result = normalizeCachedAnalysisResponse(cached);
        // Cache MISS semantics for poisoned entries: the normalizer never
        // returns null, so a corrupt/empty payload becomes a content-free
        // shape — treat that as a miss instead of serving an empty body.
        if (isEmptyAnalysis(result)) return null;
        return filterAnalysisResult(result, tier, tierConfig);
    } catch (error) {
        // Corrupt string payload (e.g. invalid JSON) — normalizeCachedAnalysisResponse
        // can throw via extractJsonFromLlmResponse. Surface as a miss.
        console.error('[Peek] Analysis cache payload invalid:', error);
        return null;
    }
}
