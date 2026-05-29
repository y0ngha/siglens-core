import {
    EMPTY_ANALYSIS_FALLBACK_SUMMARY,
    normalizeCachedAnalysisResponse,
} from '@/domain/analysis/confidence';
import type { AnalysisResponse, ModelId, Timeframe } from '@/domain/types';
import {
    buildAnalysisCacheKey,
    DEFAULT_ANALYSIS_MODEL_ID,
} from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';

/**
 * `true` when a normalized analysis carries no analytical content — i.e. an
 * empty or fallback summary and every analytical array empty. Such a shape is
 * the by-product of normalizing a poisoned / empty cached payload (the writer
 * never persists it; see `pollAnalysis`'s `isFallbackAnalysis` skip), so the
 * peek treats it as a cache miss rather than serving an empty body.
 */
function isEmptyAnalysis(result: AnalysisResponse): boolean {
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
 * This is the read-only twin of {@link submitAnalysis}: it reuses the exact
 * same internal cache key (`buildAnalysisCacheKey`) and the exact same read +
 * validate path (the env-configured {@link createCacheProvider} plus
 * {@link normalizeCachedAnalysisResponse}) that `submitAnalysis` runs on a
 * cache hit — but it omits the enqueue/fetch/generate branch entirely.
 *
 * Intended for search-engine bots in Server-Side Rendering: an RSC can surface
 * a cached analysis in the initial HTML at zero LLM cost, and render a fallback
 * (or trigger generation through the normal `submitAnalysis` path on a real
 * user request) when the cache is cold.
 *
 * Zero side effects: no job creation, no LLM call, no market-data fetch, no
 * writes. A cache miss, a missing cache provider (Upstash env absent), a read
 * error, or a corrupt/empty cached payload all resolve to `null`.
 *
 * The "corrupt → null" guard is necessary because
 * {@link normalizeCachedAnalysisResponse} never throws on a non-string garbage
 * payload — it synthesises a content-free shape (empty/fallback summary, all
 * arrays empty). {@link isEmptyAnalysis} detects that shape so a poisoned or
 * empty cache entry surfaces as a miss (`null`) rather than as an empty body.
 * (`pollAnalysis` already refuses to *write* such fallback shapes — see its
 * `isFallbackAnalysis` guard — so a valid HIT always carries real content.)
 *
 * @param symbol - U.S. equity ticker (canonical uppercase, matching the writer).
 * @param timeframe - Bar resolution literal.
 * @param _fmpSymbol - Currently unused: the technical analysis cache key is not
 *   scoped by `fmpSymbol`, so this argument does not affect the lookup. Retained
 *   in the signature for API-surface familiarity with `submitAnalysis` (a caller
 *   that already tracks an `fmpSymbol` can keep passing it). Note the positions
 *   differ — `submitAnalysis(symbol, timeframe, force?, fmpSymbol?, options?)`
 *   carries it at index 3, whereas it sits at index 2 here — so this is not a
 *   drop-in positional match.
 * @param modelId - LLM model identifier. Defaults to
 *   {@link DEFAULT_ANALYSIS_MODEL_ID} — the same default `submitAnalysis`
 *   applies — so an un-modelled peek reads the same key the writer wrote.
 * @returns The cached {@link AnalysisResponse} on a valid hit, or `null` on a
 *   miss / corrupt entry.
 *
 * @example
 * ```ts
 * const cached = await peekAnalysisCache('AAPL', '1Day');
 * if (cached !== null) return cached; // serve in SSR at zero cost
 * ```
 *
 * @see submitAnalysis
 */
export async function peekAnalysisCache(
    symbol: string,
    timeframe: Timeframe,
    _fmpSymbol?: string,
    modelId?: ModelId
): Promise<AnalysisResponse | null> {
    const cache = createCacheProvider();
    if (cache === null) return null;

    const cacheKey = buildAnalysisCacheKey(
        symbol,
        timeframe,
        modelId ?? DEFAULT_ANALYSIS_MODEL_ID
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
        return result;
    } catch (error) {
        // Corrupt string payload (e.g. invalid JSON) — normalizeCachedAnalysisResponse
        // can throw via extractJsonFromLlmResponse. Surface as a miss.
        console.error('[Peek] Analysis cache payload invalid:', error);
        return null;
    }
}
