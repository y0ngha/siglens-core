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
