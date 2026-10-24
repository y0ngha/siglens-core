import type { Redis } from '@upstash/redis';
import { MS_PER_SECOND, SECONDS_PER_MINUTE } from '@/domain/constants/time';
import type { Timeframe } from '@/domain/types';
import type { AcquireReanalyzeCooldownResult } from '@/infrastructure/market/types';
import { lazyRedisClient } from '@/infrastructure/upstash/client';
import { readUpstashConfig } from '@/infrastructure/upstash/config';

const REANALYZE_COOLDOWN_SEC = 5 * SECONDS_PER_MINUTE;
const REANALYZE_COOLDOWN_MS = REANALYZE_COOLDOWN_SEC * MS_PER_SECOND;

function buildKey(symbol: string, timeframe: Timeframe): string {
    return `analysis:cooldown:${symbol}:${timeframe}`;
}

let _redis: (() => Promise<Redis>) | undefined;
let _configKey: string | undefined;

/**
 * Lazy client for the current Upstash env, or `null` when it is not set.
 * `@upstash/redis` is loaded on first use (INF-11); call the returned function
 * inside `try` so a missing package fails open like a Redis outage.
 */
function getRedis(): (() => Promise<Redis>) | null {
    const config = readUpstashConfig();
    if (!config) return null;
    const key = `${config.url}:${config.token}`;
    if (_redis !== undefined && _configKey === key) return _redis;
    _redis = lazyRedisClient(config.url, config.token);
    _configKey = key;
    return _redis;
}

/**
 * Attempt to acquire the per-symbol reanalysis cooldown lock.
 *
 * Used by the UI to prevent the same user (or duplicate concurrent tabs)
 * from triggering a fresh analysis for the same symbol+timeframe within a
 * 5-minute window. Implemented as Redis `SET key NX EX 300`.
 *
 * Behaviour:
 * - Lock acquired → `{ ok: true }`. Caller proceeds with the analysis.
 * - Lock held → `{ ok: false, remainingMs }`. Caller blocks (or returns
 *   cached) and shows the remaining time to the user.
 * - Upstash env missing or Redis call throws → `{ ok: true }`. Cooldown is
 *   a UX safeguard, not a security boundary; failing open is preferred
 *   over failing closed.
 *
 * @param symbol - U.S. equity ticker.
 * @param timeframe - Bar resolution.
 * @returns The acquisition result.
 *
 * @see releaseReanalyzeCooldown
 * @see getReanalyzeCooldownMs
 */
export async function tryAcquireReanalyzeCooldown(
    symbol: string,
    timeframe: Timeframe
): Promise<AcquireReanalyzeCooldownResult> {
    const redis = getRedis();
    if (redis === null) return { ok: true };

    const key = buildKey(symbol, timeframe);

    try {
        const client = await redis();
        const acquired = await client.set(key, '1', {
            ex: REANALYZE_COOLDOWN_SEC,
            nx: true,
        });
        if (acquired === 'OK') return { ok: true };

        const pttl = await client.pttl(key);
        const remainingMs = pttl > 0 ? pttl : REANALYZE_COOLDOWN_MS;
        return { ok: false, remainingMs };
    } catch (error) {
        // Redis 오류 시 사용자가 분석 자체를 못 하는 일이 없도록 통과시킨다.
        console.error('[ReanalyzeCooldown] acquire 실패:', error);
        return { ok: true };
    }
}

/**
 * Release the cooldown lock for a symbol+timeframe.
 *
 * Called when an analysis completes early (e.g. cache hit) so the next
 * request for the same symbol does not have to wait for the natural TTL
 * to expire. Errors are logged and swallowed.
 *
 * No-op when Upstash env is not configured.
 *
 * @param symbol - U.S. equity ticker.
 * @param timeframe - Bar resolution.
 *
 * @see tryAcquireReanalyzeCooldown
 */
export async function releaseReanalyzeCooldown(
    symbol: string,
    timeframe: Timeframe
): Promise<void> {
    const redis = getRedis();
    if (redis === null) return;
    try {
        const client = await redis();
        await client.del(buildKey(symbol, timeframe));
    } catch (error) {
        console.error('[ReanalyzeCooldown] release 실패:', error);
    }
}

/**
 * Inspect the remaining cooldown for a symbol+timeframe (in milliseconds).
 *
 * Useful for surfacing a countdown in the UI without trying to acquire the
 * lock. Returns `0` when no cooldown is held, when Upstash env is missing,
 * or when the Redis call fails.
 *
 * @param symbol - U.S. equity ticker.
 * @param timeframe - Bar resolution.
 * @returns Remaining cooldown in milliseconds, or `0`.
 *
 * @see tryAcquireReanalyzeCooldown
 */
export async function getReanalyzeCooldownMs(
    symbol: string,
    timeframe: Timeframe
): Promise<number> {
    const redis = getRedis();
    if (redis === null) return 0;

    try {
        const client = await redis();
        const pttl = await client.pttl(buildKey(symbol, timeframe));
        return pttl > 0 ? pttl : 0;
    } catch (error) {
        console.error('[ReanalyzeCooldown] pttl 조회 실패:', error);
        return 0;
    }
}
