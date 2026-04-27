import { createHash } from 'node:crypto';
import { Redis } from '@upstash/redis';
import { SECONDS_PER_DAY } from '@/domain/constants/time';
import type { ChatTokenStore } from '@/infrastructure/chat/types';
import { readUpstashConfig } from '@/infrastructure/upstash/config';

export const CHAT_TOKEN_LIMIT = 5;
export const CHAT_TOKEN_TTL_SEC = SECONDS_PER_DAY;

function buildChatTokenKey(hashedClientId: string): string {
    return `chat:tokens:${hashedClientId}`;
}

export function hashClientIp(clientIp: string): string {
    return createHash('sha256').update(clientIp).digest('hex');
}

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
