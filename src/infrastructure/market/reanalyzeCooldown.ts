import { MS_PER_SECOND, SECONDS_PER_MINUTE } from '@/domain/constants/time';
import type { Timeframe } from '@/domain/types';
import type { AcquireReanalyzeCooldownResult } from '@/infrastructure/market/types';
import { readUpstashConfig } from '@/infrastructure/upstash/config';
import { Redis } from '@upstash/redis';

const REANALYZE_COOLDOWN_SEC = 5 * SECONDS_PER_MINUTE;
const REANALYZE_COOLDOWN_MS = REANALYZE_COOLDOWN_SEC * MS_PER_SECOND;

function buildKey(symbol: string, timeframe: Timeframe): string {
    return `analysis:cooldown:${symbol}:${timeframe}`;
}

let _redis: Redis | undefined;
let _configKey: string | undefined;

function getRedis(): Redis | null {
    const config = readUpstashConfig();
    if (!config) return null;
    const key = `${config.url}:${config.token}`;
    if (_redis !== undefined && _configKey === key) return _redis;
    _redis = new Redis({ url: config.url, token: config.token });
    _configKey = key;
    return _redis;
}

export async function tryAcquireReanalyzeCooldown(
    symbol: string,
    timeframe: Timeframe
): Promise<AcquireReanalyzeCooldownResult> {
    const redis = getRedis();
    if (redis === null) return { ok: true };

    const key = buildKey(symbol, timeframe);

    try {
        const acquired = await redis.set(key, '1', {
            ex: REANALYZE_COOLDOWN_SEC,
            nx: true,
        });
        if (acquired === 'OK') return { ok: true };

        const pttl = await redis.pttl(key);
        const remainingMs = pttl > 0 ? pttl : REANALYZE_COOLDOWN_MS;
        return { ok: false, remainingMs };
    } catch (error) {
        // Redis 오류 시 사용자가 분석 자체를 못 하는 일이 없도록 통과시킨다.
        console.error('[ReanalyzeCooldown] acquire 실패:', error);
        return { ok: true };
    }
}

export async function releaseReanalyzeCooldown(
    symbol: string,
    timeframe: Timeframe
): Promise<void> {
    const redis = getRedis();
    if (redis === null) return;
    try {
        await redis.del(buildKey(symbol, timeframe));
    } catch (error) {
        console.error('[ReanalyzeCooldown] release 실패:', error);
    }
}

export async function getReanalyzeCooldownMs(
    symbol: string,
    timeframe: Timeframe
): Promise<number> {
    const redis = getRedis();
    if (redis === null) return 0;

    try {
        const pttl = await redis.pttl(buildKey(symbol, timeframe));
        return pttl > 0 ? pttl : 0;
    } catch (error) {
        console.error('[ReanalyzeCooldown] pttl 조회 실패:', error);
        return 0;
    }
}
