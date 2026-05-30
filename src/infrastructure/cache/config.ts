import type {
    DashboardTimeframe,
    OptionsExpirationFilter,
    Timeframe,
} from '@/domain/types';
import {
    SECONDS_PER_DAY,
    SECONDS_PER_HOUR,
    SECONDS_PER_MINUTE,
} from '@/domain/constants/time';
import {
    computeSecondsUntilCacheExpiry,
    isEtRegularSessionOpen,
    secondsUntilNextEtRegularOpen,
} from '@/domain/utils';

/**
 * @internal TTL for cached market briefings (in seconds).
 *
 * Set to one hour so all callers within a given hour share a single AI
 * briefing for the same dashboard summary. The briefing cache key
 * incorporates the ISO date+hour, so rollover happens automatically.
 */
export const MARKET_BRIEFING_CACHE_TTL = SECONDS_PER_HOUR;

/** @internal 1시간봉 섹터 시그널 캐시 TTL(분) — 데이터 갱신 주기에 맞춤. */
export const SECTOR_SIGNALS_1HOUR_TTL_MINUTES = 15;
/** @internal 15분봉 섹터 시그널 캐시 TTL(분) — 데이터 갱신 주기에 맞춤. */
export const SECTOR_SIGNALS_15MIN_TTL_MINUTES = 5;

/** @internal 타임프레임별 섹터 시그널 캐시 TTL(초) 매핑. */
export const SECTOR_SIGNALS_TTL_BY_TIMEFRAME: Record<
    DashboardTimeframe,
    number
> = {
    '1Day': SECONDS_PER_HOUR,
    '1Hour': SECTOR_SIGNALS_1HOUR_TTL_MINUTES * SECONDS_PER_MINUTE,
    '15Min': SECTOR_SIGNALS_15MIN_TTL_MINUTES * SECONDS_PER_MINUTE,
};

/**
 * @internal Per-timeframe TTL (seconds) for cached symbol analyses.
 *
 * Keyed by {@link Timeframe} — shorter timeframes get shorter TTLs so
 * stale results never stay cached longer than the underlying bar
 * resolution. {@link computeEffectiveTtl} clamps these values further when
 * the daily KST cache-expiry boundary is approaching.
 */
export const ANALYSIS_CACHE_TTL: Record<Timeframe, number> = {
    '5Min': 5 * SECONDS_PER_MINUTE,
    '15Min': 15 * SECONDS_PER_MINUTE,
    '30Min': 30 * SECONDS_PER_MINUTE,
    '1Hour': SECONDS_PER_HOUR,
    '4Hour': 4 * SECONDS_PER_HOUR,
    '1Day': SECONDS_PER_DAY,
};

/**
 * @internal Daily cache-expiry boundary in KST hours (24-hour clock).
 *
 * KST 05:00 = UTC 20:00 (prev day) = EDT 16:00 — aligned with U.S.
 * regular-session close so cached analyses expire as the final price is
 * printed, and the next request after close receives fresh results.
 *
 * @remarks
 * **Known asymmetry vs the usage day boundary.** The analysis cache rolls over
 * at KST 05:00 (= UTC 20:00 of the previous calendar day), but the daily usage
 * counter in {@link hashUsageIp} (`infrastructure/usage/hash.ts`) buckets by
 * UTC `YYYY-MM-DD`, i.e. it rolls over at UTC 00:00. This produces a 4-hour
 * window each day where new requests hit fresh cache (post-close) but still
 * count against the *previous* UTC usage day (until UTC 00:00 ticks over).
 * Aligning the two boundaries requires a stakeholder decision on which axis to
 * move; until then this comment is the documented source of truth.
 */
export const CACHE_EXPIRY_HOUR_KST = 5;

/**
 * @internal Compute the effective analysis-cache TTL for a given timeframe at `now`.
 *
 * Returns the smaller of:
 * - `ANALYSIS_CACHE_TTL[timeframe]` — the static per-timeframe ceiling.
 * - Seconds remaining until the next `CACHE_EXPIRY_HOUR_KST` boundary —
 *   ensures cached results don't survive into the next trading day.
 *
 * @param timeframe - Bar resolution.
 * @param now - The "now" reference; useful in tests.
 * @returns Effective TTL in seconds.
 */
export function computeEffectiveTtl(timeframe: Timeframe, now: Date): number {
    return Math.min(
        ANALYSIS_CACHE_TTL[timeframe],
        computeSecondsUntilCacheExpiry(now, CACHE_EXPIRY_HOUR_KST)
    );
}

/** @internal Cache TTL (seconds) for bars during a regular NYSE session (09:30–16:00 ET). */
export const BARS_OPEN_TTL_SECONDS = SECONDS_PER_MINUTE;
/** @internal Max cache TTL (seconds) for bars outside a regular session; caps "time until next open" when the next session is >24h away. */
export const BARS_OFFHOURS_TTL_CEILING_SECONDS = SECONDS_PER_DAY;

/**
 * Computes the effective cache TTL (seconds) for bars (OHLCV + indicators) at `now`.
 *
 * - During regular session: 60 s (`BARS_OPEN_TTL_SECONDS`) — the last bar is
 *   still forming; stale data must not survive past the next bar's close.
 * - Off-hours / weekends: `min(BARS_OFFHOURS_TTL_CEILING_SECONDS, seconds until next open)` —
 *   completed bars do not change until the next session opens, so the cache can
 *   survive exactly until that boundary.
 *
 * Unlike the analysis-cache TTL policy (which clamps to the session **close**
 * boundary), this function uses the session **open** boundary.
 *
 * @param _timeframe - Bar resolution. Currently all timeframes share the same policy;
 *   the parameter is kept for signature consistency with the analysis-cache TTL helper.
 * @param now - Reference time for market-session detection. Pass explicitly for
 *   deterministic testing.
 * @returns Effective TTL in seconds.
 */
export function computeBarsEffectiveTtl(
    _timeframe: Timeframe,
    now: Date
): number {
    if (isEtRegularSessionOpen(now)) return BARS_OPEN_TTL_SECONDS;
    return Math.min(
        BARS_OFFHOURS_TTL_CEILING_SECONDS,
        secondsUntilNextEtRegularOpen(now)
    );
}

/** @internal Fallback model identifier used in cache keys when no specific model is tracked. */
export const DEFAULT_ANALYSIS_MODEL_ID = 'analysis-worker';

/**
 * Prompt-template version folded into the technical and fundamental analysis
 * cache keys.
 *
 * This is a **separate invalidation axis** from {@link CACHE_KEY_SCHEMA_VERSION}:
 * the schema version tracks the cached *response shape*, while this tracks the
 * *prompt template* fed to the LLM. The technical/fundamental keys carry no
 * input/prompt hash (unlike news/overall, which fold a skill fingerprint into
 * their input hash), so without this lever editing a prompt template would not
 * invalidate already-cached analyses until the TTL elapsed.
 *
 * Bump this string whenever a technical or fundamental prompt template changes
 * in a way that would make previously cached results stale. Old keys (e.g.
 * `p1`) are simply never looked up after a bump and naturally expire via TTL.
 *
 * @internal
 */
export const PROMPT_TEMPLATE_VERSION = 'p1' as const;

/**
 * @internal Build the Redis key for a cached symbol (technical) analysis.
 *
 * Format: `analysis:<symbol>:<timeframe>:<modelId>:<promptVersion>`. Symbol is
 * used verbatim — pass the canonical uppercase form. Including the model
 * identifier ensures results from different AI models are cached independently;
 * the trailing {@link PROMPT_TEMPLATE_VERSION} segment invalidates the cache
 * when the technical prompt template changes.
 *
 * @param symbol - U.S. equity ticker.
 * @param timeframe - Bar resolution.
 * @param modelId - LLM model identifier. Defaults to {@link DEFAULT_ANALYSIS_MODEL_ID}
 *   so existing callers that do not pass a model remain backward-compatible.
 * @returns The cache key.
 *
 * @example
 * ```ts
 * const key = buildAnalysisCacheKey('AAPL', '1Day', 'gemini-2.5-flash');
 * // → 'analysis:AAPL:1Day:gemini-2.5-flash:p1'
 * ```
 */
export function buildAnalysisCacheKey(
    symbol: string,
    timeframe: Timeframe,
    modelId = DEFAULT_ANALYSIS_MODEL_ID
): string {
    return `analysis:${symbol}:${timeframe}:${modelId}:${PROMPT_TEMPLATE_VERSION}`;
}

/**
 * @internal Build the Redis key for a cached market briefing.
 *
 * Format: `briefing:market:<dateHour>`. The `dateHour` argument is the ISO
 * date+hour prefix (e.g. `"2026-04-26T14"`) so all callers within a given
 * hour share a single cached briefing.
 *
 * @param dateHour - ISO date+hour prefix.
 * @returns The cache key.
 */
export function buildBriefingCacheKey(dateHour: string): string {
    return `briefing:market:${dateHour}`;
}

/** @internal 타임프레임+버킷 기준 섹터 시그널 캐시 키 빌더. */
export function buildSectorSignalsCacheKey(
    timeframe: DashboardTimeframe,
    bucket: string
): string {
    return `dashboard:signals:${timeframe}:${bucket}`;
}

/**
 * Schema version prefix applied to every analysis cache key (fundamental,
 * news, news-card, overall).
 *
 * Bump this string whenever any cached response shape changes; it serves as a
 * global cache invalidation lever — old keys (e.g. `v1:...`) are simply never
 * looked up after a bump and naturally expire via TTL.
 *
 * Examples of what should trigger a bump:
 * - Adding/removing/renaming a field on `FundamentalAnalysisResponse`,
 *   `NewsAnalysisResponse`, `NewsCardAnalysis`, or `OverallAnalysisResponse`.
 * - Changing the semantics of an existing field (units, enum value, etc.).
 *
 * @internal
 */
export const CACHE_KEY_SCHEMA_VERSION = 'v1' as const;

/** @internal TTL for fundamental analysis cache results. Default: 24 hours. */
export const FUNDAMENTAL_CACHE_TTL_SECONDS = SECONDS_PER_DAY;
/** @internal TTL for news analysis aggregate cache results. Default: 24 hours. */
export const NEWS_CACHE_TTL_SECONDS = SECONDS_PER_DAY;
/** @internal TTL for overall (three-axis) analysis cache results. Default: 24 hours. */
export const OVERALL_CACHE_TTL_SECONDS = SECONDS_PER_DAY;
/** @internal TTL for options analysis cache results. Default: 24 hours. */
export const OPTIONS_CACHE_TTL_SECONDS = SECONDS_PER_DAY;

/**
 * Build the Redis key for a cached fundamental analysis result.
 *
 * Format: `{version}:analysis:fundamental:<symbol>:<modelId>:<promptVersion>`.
 *
 * The key is intentionally free of an input hash so that the cache lookup
 * can happen before any FMP data fetch — avoiding 13 parallel API calls on
 * every page load when a warm result already exists. Cache freshness is
 * governed by the 24-hour TTL ({@link FUNDAMENTAL_CACHE_TTL_SECONDS}), the
 * schema-version prefix ({@link CACHE_KEY_SCHEMA_VERSION}) for response-shape
 * changes, and the trailing {@link PROMPT_TEMPLATE_VERSION} segment for
 * prompt-template changes: bump the relevant axis whenever a change would make
 * old cached results incorrect.
 *
 * @internal
 * @param symbol - U.S. equity ticker (canonical uppercase).
 * @param modelId - LLM model identifier.
 * @returns The cache key.
 */
export function buildFundamentalCacheKey(
    symbol: string,
    modelId: string
): string {
    return `${CACHE_KEY_SCHEMA_VERSION}:analysis:fundamental:${symbol}:${modelId}:${PROMPT_TEMPLATE_VERSION}`;
}

/**
 * Build the Redis key for a cached news analysis result.
 *
 * Format: `analysis:news:<symbol>:<modelId>:<inputHash>`.
 *
 * @internal Consumer cannot construct `inputHash` themselves — it is derived
 *   inside `submitNewsAnalysis`. Do not depend on this function from outside
 *   the core library.
 * @param symbol - U.S. equity ticker (canonical uppercase).
 * @param modelId - LLM model identifier.
 * @param inputHash - Short hash of the news items used as prompt input.
 * @returns The cache key.
 */
export function buildNewsCacheKey(
    symbol: string,
    modelId: string,
    inputHash: string
): string {
    return `${CACHE_KEY_SCHEMA_VERSION}:analysis:news:${symbol}:${modelId}:${inputHash}`;
}

/**
 * Build the Redis key for a cached overall (3-axis) analysis result.
 *
 * Format: `analysis:overall:<symbol>:<timeframe>:<modelId>:<inputHash>`.
 * The `timeframe` distinguishes analyses run with different chart contexts.
 *
 * @internal Consumer cannot construct `inputHash` themselves — it is derived
 *   inside `submitOverallAnalysis`. Do not depend on this function from outside
 *   the core library.
 * @param symbol - U.S. equity ticker (canonical uppercase).
 * @param timeframe - Bar resolution used for the technical axis.
 * @param modelId - LLM model identifier.
 * @param inputHash - Short hash of the combined technical/fundamental/news inputs.
 * @returns The cache key.
 */
export function buildOverallCacheKey(
    symbol: string,
    timeframe: Timeframe,
    modelId: string,
    inputHash: string
): string {
    return `${CACHE_KEY_SCHEMA_VERSION}:analysis:overall:${symbol}:${timeframe}:${modelId}:${inputHash}`;
}

/**
 * Build the **content-free** "peek" key for the latest cached overall analysis.
 *
 * Format: `{version}:analysis:overall:peek:<symbol>:<timeframe>:<modelId>`.
 *
 * Unlike {@link buildOverallCacheKey}, this key omits the input hash so it can
 * be reconstructed from `(symbol, timeframe, modelId)` alone — without
 * resolving the four dependency axes (which is the only way to derive the
 * input hash, and which would entail cache reads / potential generation).
 *
 * {@link pollOverallAnalysis} writes the normalized result under **both** keys:
 * the canonical hashed key (for the exact-input cache the submit path looks up)
 * and this peek key (an overwrite-latest pointer to the most recently generated
 * overall analysis for the symbol/timeframe/model). `peekOverallAnalysisCache`
 * reads this key to surface a cached overall analysis in SSR HTML at zero LLM
 * cost — accepting "latest cached" semantics because a content-free read cannot
 * reproduce the input hash.
 *
 * @internal
 * @param symbol - U.S. equity ticker (canonical uppercase).
 * @param timeframe - Bar resolution used for the technical axis.
 * @param modelId - LLM model identifier.
 * @returns The content-free peek cache key.
 */
export function buildOverallPeekCacheKey(
    symbol: string,
    timeframe: Timeframe,
    modelId: string
): string {
    return `${CACHE_KEY_SCHEMA_VERSION}:analysis:overall:peek:${symbol}:${timeframe}:${modelId}`;
}

/**
 * @internal Build the Redis key for a cached options analysis result.
 *
 * Format: `{version}:analysis:options:<symbol>:<expirationDate>:<modelId>:<snapshotInputHash>`.
 *
 * The schema-version prefix ({@link CACHE_KEY_SCHEMA_VERSION}) ensures future
 * shape changes invalidate the cache automatically, matching the sibling
 * analysis cache-key builders above.
 *
 * @param symbol - Underlying ticker (uppercase).
 * @param expirationDate - {@link OptionsExpirationFilter} — `'YYYY-MM-DD'` or the
 *   `'all'` sentinel for aggregate analysis across every available expiration.
 * @param modelId - LLM model identifier scoping the cache.
 * @param snapshotInputHash - Hash of the snapshot inputs — a fresher snapshot
 *   produces a different hash and therefore a new cache entry.
 * @returns The cache key.
 */
export function buildOptionsCacheKey(
    symbol: string,
    expirationDate: OptionsExpirationFilter,
    modelId: string,
    snapshotInputHash: string
): string {
    return `${CACHE_KEY_SCHEMA_VERSION}:analysis:options:${symbol}:${expirationDate}:${modelId}:${snapshotInputHash}`;
}
