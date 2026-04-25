import { Redis } from '@upstash/redis';
import type { CacheProvider } from '@/infrastructure/cache/types';
import { readUpstashConfig } from '@/infrastructure/upstash/config';

export function createCacheProvider(): CacheProvider | null {
    const config = readUpstashConfig();
    if (!config) return null;

    const writer = new Redis({ url: config.url, token: config.token });
    const reader = config.readonlyToken
        ? new Redis({ url: config.url, token: config.readonlyToken })
        : writer;

    return {
        async get<T>(key: string): Promise<T | null> {
            return reader.get<T>(key);
        },
        async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
            await writer.set(key, value, { ex: ttlSeconds });
        },
        async delete(key: string): Promise<void> {
            await writer.del(key);
        },
    };
}
