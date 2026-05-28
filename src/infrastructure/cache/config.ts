import type { DashboardTimeframe, Timeframe } from '@/domain/types';
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
 * TTL for cached market briefings (in seconds).
 *
 * Set to one hour so all callers within a given hour share a single AI
 * briefing for the same dashboard summary. The briefing cache key
 * incorporates the ISO date+hour, so rollover happens automatically.
 */
export const MARKET_BRIEFING_CACHE_TTL = SECONDS_PER_HOUR;

// 대시보드 섹터 시그널: 타임프레임별 데이터 갱신 주기에 맞춘 TTL
export const SECTOR_SIGNALS_1HOUR_TTL_MINUTES = 15;
export const SECTOR_SIGNALS_15MIN_TTL_MINUTES = 5;

export const SECTOR_SIGNALS_TTL_BY_TIMEFRAME: Record<
    DashboardTimeframe,
    number
> = {
    '1Day': SECONDS_PER_HOUR,
    '1Hour': SECTOR_SIGNALS_1HOUR_TTL_MINUTES * SECONDS_PER_MINUTE,
    '15Min': SECTOR_SIGNALS_15MIN_TTL_MINUTES * SECONDS_PER_MINUTE,
};

/**
 * Per-timeframe TTL (seconds) for cached symbol analyses.
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
 * Daily cache-expiry boundary in KST hours (24-hour clock).
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
 * Compute the effective analysis-cache TTL for a given timeframe at `now`.
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

/** 개장 중 bars 캐시 TTL(초). 마지막 봉이 실시간 형성되나 FMP 시세는 최대 15분 지연이라 1분이면 충분. */
export const BARS_OPEN_TTL_SECONDS = SECONDS_PER_MINUTE;
/** 장외/주말 bars 캐시 TTL 상한(초). 다음 개장까지가 이보다 길면 이 값으로 캡. */
export const BARS_OFFHOURS_TTL_CEILING_SECONDS = SECONDS_PER_DAY;

/**
 * bars(OHLCV+지표) 캐시의 effective TTL(초)을 `now` 기준으로 계산.
 *
 * - 정규장 중: {@link BARS_OPEN_TTL_SECONDS}(60s) — 마지막 봉이 형성 중.
 * - 장외/주말: `min(`{@link BARS_OFFHOURS_TTL_CEILING_SECONDS}`, 다음 개장까지)` —
 *   마감 후 완성된 봉은 다음 개장 전까지 변하지 않으므로 개장 직전 만료.
 *
 * 분석 캐시({@link computeEffectiveTtl}, 마감 경계)와 달리 **개장 경계**를 쓴다.
 * @param _timeframe - 봉 해상도(현재 모든 TF 동일 정책, 시그니처 일관성 위해 유지).
 * @param now - 기준 시각(테스트용).
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
 * Build the Redis key for a cached symbol analysis.
 *
 * Format: `analysis:<symbol>:<timeframe>:<modelId>`. Symbol is used verbatim
 * — pass the canonical uppercase form. Including the model identifier ensures
 * results from different AI models are cached independently.
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
 * // → 'analysis:AAPL:1Day:gemini-2.5-flash'
 * ```
 */
export function buildAnalysisCacheKey(
    symbol: string,
    timeframe: Timeframe,
    modelId = DEFAULT_ANALYSIS_MODEL_ID
): string {
    return `analysis:${symbol}:${timeframe}:${modelId}`;
}

/**
 * Build the Redis key for a cached market briefing.
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
 * Format: `{version}:analysis:fundamental:<symbol>:<modelId>`.
 *
 * The key is intentionally free of an input hash so that the cache lookup
 * can happen before any FMP data fetch — avoiding 13 parallel API calls on
 * every page load when a warm result already exists. Cache freshness is
 * governed solely by the 24-hour TTL ({@link FUNDAMENTAL_CACHE_TTL_SECONDS})
 * and the schema-version prefix ({@link CACHE_KEY_SCHEMA_VERSION}): bump the
 * version whenever the response shape or prompt logic changes in a way that
 * would make old cached results incorrect.
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
    return `${CACHE_KEY_SCHEMA_VERSION}:analysis:fundamental:${symbol}:${modelId}`;
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
