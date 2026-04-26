import type { DashboardTimeframe, Timeframe } from '@/domain/types';
import {
    SECONDS_PER_DAY,
    SECONDS_PER_HOUR,
    SECONDS_PER_MINUTE,
    SECONDS_PER_YEAR,
} from '@/domain/constants/time';
import { computeSecondsUntilCacheExpiry } from '@/domain/utils';

// 시장 브리핑: 1시간 캐시 (시장 데이터 변화 주기에 맞춤)
export const MARKET_BRIEFING_CACHE_TTL = SECONDS_PER_HOUR;

// 대시보드 섹터 시그널: 타임프레임별 데이터 갱신 주기에 맞춘 TTL
export const SECTOR_SIGNALS_TTL_BY_TIMEFRAME: Record<
    DashboardTimeframe,
    number
> = {
    '1Day': SECONDS_PER_HOUR,
    '1Hour': 15 * SECONDS_PER_MINUTE,
    '15Min': 5 * SECONDS_PER_MINUTE,
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

export const ANALYSIS_CACHE_TTL: Record<Timeframe, number> = {
    '5Min': 5 * SECONDS_PER_MINUTE,
    '15Min': 15 * SECONDS_PER_MINUTE,
    '30Min': 30 * SECONDS_PER_MINUTE,
    '1Hour': SECONDS_PER_HOUR,
    '4Hour': 4 * SECONDS_PER_HOUR,
    '1Day': SECONDS_PER_DAY,
};

// KST 17:00 = UTC 08:00 = EST 04:00 (미국 프리마켓 시작 전)
// 전날 분석 캐시를 장 시작 전에 갱신하기 위한 기준 시각
export const CACHE_EXPIRY_HOUR_KST = 17;

export function computeEffectiveTtl(timeframe: Timeframe, now: Date): number {
    return Math.min(
        ANALYSIS_CACHE_TTL[timeframe],
        computeSecondsUntilCacheExpiry(now, CACHE_EXPIRY_HOUR_KST)
    );
}

export function buildAnalysisCacheKey(
    symbol: string,
    timeframe: Timeframe
): string {
    return `analysis:${symbol}:${timeframe}`;
}

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
