import type { DashboardTimeframe, Timeframe } from '@/domain/types';
import {
    SECONDS_PER_DAY,
    SECONDS_PER_HOUR,
    SECONDS_PER_MINUTE,
    SECONDS_PER_YEAR,
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

// 티커 검색 결과: 하루 캐시
export const TICKER_SEARCH_CACHE_TTL = SECONDS_PER_DAY;

// 한국어 이름 매핑: 장기 보존 (sync 스크립트로 주기 갱신)
export const KOREAN_NAMES_CACHE_TTL = SECONDS_PER_YEAR;

// 한국어 미보유: 번역 대기 → 12시간 후 재시도 가능하도록 단기 보존
export const ASSET_INFO_HOURS_WITHOUT_KOREAN = 12;
export const ASSET_INFO_CACHE_TTL_WITHOUT_KOREAN =
    ASSET_INFO_HOURS_WITHOUT_KOREAN * SECONDS_PER_HOUR;
// 한국어 보유: 완성된 데이터 → 1년 장기 보존
export const ASSET_INFO_CACHE_TTL_WITH_KOREAN = SECONDS_PER_YEAR;

export const KOREAN_TICKERS_CACHE_KEY = 'korean:tickers';

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
 * KST 17:00 = UTC 08:00 = EST 04:00 — chosen to flush cached analyses
 * just before the U.S. pre-market opens, so the next session starts
 * with fresh results.
 */
export const CACHE_EXPIRY_HOUR_KST = 17;

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

/**
 * Build the Redis key for a cached symbol analysis.
 *
 * Format: `analysis:<symbol>:<timeframe>:<modelId>`. Symbol is used verbatim
 * — pass the canonical uppercase form. Including the model identifier ensures
 * results from different AI models are cached independently.
 *
 * @param symbol - U.S. equity ticker.
 * @param timeframe - Bar resolution.
 * @param modelId - LLM model identifier (e.g. `"gemini-2.5-flash"`).
 * @returns The cache key.
 */
export function buildAnalysisCacheKey(
    symbol: string,
    timeframe: Timeframe,
    modelId: string
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

export function buildTickerSearchCacheKey(query: string): string {
    return `ticker:search:${query.toLowerCase()}`;
}

export function buildAssetInfoCacheKey(symbol: string): string {
    return `asset-info:${symbol.toUpperCase()}`;
}

export function buildSectorSignalsCacheKey(
    timeframe: DashboardTimeframe,
    bucket: string
): string {
    return `dashboard:signals:${timeframe}:${bucket}`;
}
