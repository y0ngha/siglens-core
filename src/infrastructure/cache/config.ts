import type { DashboardTimeframe, Timeframe } from '@/domain/types';
import {
    SECONDS_PER_DAY,
    SECONDS_PER_HOUR,
    SECONDS_PER_MINUTE,
} from '@/domain/constants/time';
import { computeSecondsUntilCacheExpiry } from '@/domain/utils';

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

/** @internal TTL for fundamental analysis cache results. Default: 24 hours. The submit path may use a shorter dynamic TTL when next earnings is imminent. */
export const FUNDAMENTAL_CACHE_TTL_SECONDS = SECONDS_PER_DAY;
/** @internal TTL for news analysis aggregate cache results. Default: 24 hours. */
export const NEWS_CACHE_TTL_SECONDS = SECONDS_PER_DAY;
/** @internal TTL for per-card news analysis cache (translation + sentiment + summary). Default: 30 days — effectively permanent for the lifetime of a news article. */
export const NEWS_CARD_CACHE_TTL_SECONDS = 30 * SECONDS_PER_DAY;
/** @internal TTL for overall (three-axis) analysis cache results. Default: 24 hours. */
export const OVERALL_CACHE_TTL_SECONDS = SECONDS_PER_DAY;

/**
 * Build the Redis key for a cached fundamental analysis result.
 *
 * Format: `analysis:fundamental:<symbol>:<modelId>:<inputHash>`.
 * The `inputHash` is a short hash of the FundamentalSnapshot contents so that
 * results from different data vintages are cached independently.
 *
 * @internal Consumer cannot construct `inputHash` themselves — it is derived
 *   inside `submitFundamentalAnalysis`. Do not depend on this function from
 *   outside the core library.
 * @param symbol - U.S. equity ticker (canonical uppercase).
 * @param modelId - LLM model identifier.
 * @param inputHash - Short hash of the prompt input data.
 * @returns The cache key.
 */
export function buildFundamentalCacheKey(
    symbol: string,
    modelId: string,
    inputHash: string
): string {
    return `analysis:fundamental:${symbol}:${modelId}:${inputHash}`;
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
    return `analysis:news:${symbol}:${modelId}:${inputHash}`;
}

/**
 * @internal Fixed model identifier used for per-news-card translation and sentiment analysis.
 * Single source of truth — also consumed by `submitNewsCardAnalysis`.
 */
export const NEWS_CARD_MODEL_ID = 'gemini-2.5-flash-lite' as const;

/**
 * Build the Redis key for a cached per-news-card analysis result.
 *
 * The model is fixed to {@link NEWS_CARD_MODEL_ID} (`gemini-2.5-flash-lite`)
 * for translation and sentiment analysis.
 * Format: `analysis:news-card:<newsId>:gemini-2.5-flash-lite`.
 *
 * @internal Keyed only by `newsId` — consumer cannot reuse this key without
 *   knowing the fixed model. Do not depend on this function from outside the
 *   core library.
 * @param newsId - Stable unique identifier of the news article.
 * @returns The cache key.
 */
export function buildNewsCardCacheKey(newsId: string): string {
    return `analysis:news-card:${newsId}:${NEWS_CARD_MODEL_ID}`;
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
    return `analysis:overall:${symbol}:${timeframe}:${modelId}:${inputHash}`;
}
