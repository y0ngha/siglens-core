import type { Timeframe } from '@/domain/types';
import {
    KST_OFFSET_HOURS,
    MS_PER_DAY,
    MS_PER_HOUR,
    MS_PER_SECOND,
    SECONDS_PER_DAY,
    SECONDS_PER_HOUR,
    SECONDS_PER_MINUTE,
} from '@/domain/constants/time';

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

export function computeSecondsUntilCacheExpiry(now: Date): number {
    const kstNow = new Date(now.getTime() + KST_OFFSET_HOURS * MS_PER_HOUR);

    // 오늘 KST 17:00 설정 (kstNow는 UTC+9 오프셋이 더해진 가상 UTC 날짜)
    const kst17Today = new Date(
        Date.UTC(
            kstNow.getUTCFullYear(),
            kstNow.getUTCMonth(),
            kstNow.getUTCDate(),
            CACHE_EXPIRY_HOUR_KST,
            0,
            0,
            0
        )
    );

    const rawDiffMs = kst17Today.getTime() - kstNow.getTime();

    // 현재 시각이 KST 17:00 이후이면 내일 17:00 기준으로 전환
    const diffMs = rawDiffMs <= 0 ? rawDiffMs + MS_PER_DAY : rawDiffMs;

    // 최소 1초를 보장하여 Redis EX 0 오류 방지
    return Math.max(1, Math.floor(diffMs / MS_PER_SECOND));
}

export function computeEffectiveTtl(timeframe: Timeframe, now: Date): number {
    return Math.min(
        ANALYSIS_CACHE_TTL[timeframe],
        computeSecondsUntilCacheExpiry(now)
    );
}

export function buildAnalysisCacheKey(
    symbol: string,
    timeframe: Timeframe
): string {
    return `analysis:${symbol}:${timeframe}`;
}

export interface UpstashEnvConfig {
    url: string;
    token: string;
    readonlyToken: string;
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
