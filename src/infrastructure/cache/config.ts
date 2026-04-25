import type { Timeframe } from '@/domain/types';
import {
    SECONDS_PER_DAY,
    SECONDS_PER_HOUR,
    SECONDS_PER_MINUTE,
} from '@/domain/constants/time';
import { computeSecondsUntilCacheExpiry } from '@/domain/utils';
import type { UpstashEnvConfig } from '@/infrastructure/cache/types';

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

export function readUpstashConfig(): UpstashEnvConfig | null {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return null;
    return {
        url,
        token,
        readonlyToken: process.env.UPSTASH_REDIS_REST_READONLY_TOKEN ?? '',
    };
}
