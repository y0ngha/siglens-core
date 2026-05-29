import { createHash } from 'node:crypto';
import { Redis } from '@upstash/redis';
import { SECONDS_PER_DAY } from '@/domain/constants/time';
import type { ChatTokenStore } from '@/domain/ports/chatTokenStore';
import { readUpstashConfig } from '@/infrastructure/upstash/config';

/** @internal Daily per-client chat token allowance. */
export const CHAT_TOKEN_LIMIT = 5;
/** @internal TTL (seconds) for the daily chat token bucket; one day. */
export const CHAT_TOKEN_TTL_SEC = SECONDS_PER_DAY;

function buildChatTokenKey(hashedClientId: string): string {
    return `chat:tokens:${hashedClientId}`;
}

export function hashClientIp(clientIp: string): string {
    return createHash('sha256').update(clientIp).digest('hex');
}

/**
 * @adapter implements {@link ChatTokenStore}
 *
 * Construct a {@link ChatTokenStore} backed by Upstash Redis.
 *
 * Reads connection settings from env via `readUpstashConfig`. When Upstash
 * env is missing the adapter is still returned, but every operation degrades
 * gracefully: `tryConsumeToken` reports the caller as within-limit,
 * `refundConsumedToken` is a no-op, and `getRemainingTokens` returns the
 * full daily allowance. Runtime Redis errors are caught and degraded the
 * same way so a Redis outage does not block chat traffic.
 *
 * @returns A configured chat token store. Never `null` — graceful degradation
 *   happens per-operation rather than at construction.
 *
 * @see ChatTokenStore
 */
export function createChatTokenStore(): ChatTokenStore {
    const config = readUpstashConfig();
    const redis =
        config === null
            ? null
            : new Redis({ url: config.url, token: config.token });

    return {
        async tryConsumeToken(hashedClientId: string): Promise<boolean> {
            if (redis === null) return true;

            try {
                const key = buildChatTokenKey(hashedClientId);
                const count = await redis.incr(key);
                await redis.expire(key, CHAT_TOKEN_TTL_SEC, 'NX');
                return count <= CHAT_TOKEN_LIMIT;
            } catch {
                return true;
            }
        },

        async refundConsumedToken(hashedClientId: string): Promise<void> {
            if (redis === null) return;

            try {
                const key = buildChatTokenKey(hashedClientId);
                const count = await redis.get<number>(key);
                if (count !== null && count > 0) {
                    await redis.decr(key);
                }
            } catch {
                return;
            }
        },

        async getRemainingTokens(hashedClientId: string): Promise<number> {
            if (redis === null) return CHAT_TOKEN_LIMIT;

            try {
                const key = buildChatTokenKey(hashedClientId);
                const count = await redis.get<number>(key);
                return count === null
                    ? CHAT_TOKEN_LIMIT
                    : Math.max(0, CHAT_TOKEN_LIMIT - count);
            } catch {
                return CHAT_TOKEN_LIMIT;
            }
        },
    };
}
