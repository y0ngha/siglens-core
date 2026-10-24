import { createHash } from 'node:crypto';
import { SECONDS_PER_DAY } from '@/domain/constants/time';
import type { ChatTokenStore } from '@/domain/ports/chatTokenStore';
import { lazyRedisClient } from '@/infrastructure/upstash/client';
import { readUpstashConfig } from '@/infrastructure/upstash/config';

/** @internal Daily per-client chat token allowance. */
export const CHAT_TOKEN_LIMIT = 5;
/** @internal TTL (seconds) for the daily chat token bucket; one day. */
export const CHAT_TOKEN_TTL_SEC = SECONDS_PER_DAY;

function buildChatTokenKey(hashedClientId: string): string {
    return `chat:tokens:${hashedClientId}`;
}

/**
 * Produce a stable, unlinkable key for a client IP address.
 *
 * Hashes the raw IP with SHA-256 so the original address cannot be recovered
 * from the result, keeping the daily token-bucket key free of personally
 * identifiable data.
 *
 * @param clientIp - Raw client IP string (e.g. `"203.0.113.42"`).
 * @returns Hex-encoded SHA-256 digest used as the token-bucket key suffix.
 */
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
 * same way so a Redis outage does not block chat traffic. `@upstash/redis` is
 * loaded on first use; a missing package degrades the same way.
 *
 * @returns A configured chat token store. Never `null` — graceful degradation
 *   happens per-operation rather than at construction.
 *
 * @see ChatTokenStore
 */
export function createChatTokenStore(): ChatTokenStore {
    const config = readUpstashConfig();
    const redis =
        config === null ? null : lazyRedisClient(config.url, config.token);

    return {
        async tryConsumeToken(hashedClientId: string): Promise<boolean> {
            if (redis === null) return true;

            try {
                const client = await redis();
                const key = buildChatTokenKey(hashedClientId);
                const count = await client.incr(key);
                await client.expire(key, CHAT_TOKEN_TTL_SEC, 'NX');
                return count <= CHAT_TOKEN_LIMIT;
            } catch {
                return true;
            }
        },

        async refundConsumedToken(hashedClientId: string): Promise<void> {
            if (redis === null) return;

            try {
                const client = await redis();
                const key = buildChatTokenKey(hashedClientId);
                const count = await client.get<number>(key);
                if (count !== null && count > 0) {
                    await client.decr(key);
                }
            } catch {
                return;
            }
        },

        async getRemainingTokens(hashedClientId: string): Promise<number> {
            if (redis === null) return CHAT_TOKEN_LIMIT;

            try {
                const client = await redis();
                const key = buildChatTokenKey(hashedClientId);
                const count = await client.get<number>(key);
                return count === null
                    ? CHAT_TOKEN_LIMIT
                    : Math.max(0, CHAT_TOKEN_LIMIT - count);
            } catch {
                return CHAT_TOKEN_LIMIT;
            }
        },
    };
}
