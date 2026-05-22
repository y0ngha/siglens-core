import { Redis } from '@upstash/redis';
import type { CacheProvider } from '@/domain/ports/cache';
import { readUpstashConfig } from '@/infrastructure/upstash/config';

/**
 * @adapter implements {@link CacheProvider}
 *
 * Construct a {@link CacheProvider} backed by Upstash Redis.
 *
 * Reads connection settings from env. Returns
 * `null` when the required vars are not present so callers can degrade
 * gracefully (cache miss on every operation) instead of crashing.
 *
 * When `UPSTASH_REDIS_REST_READONLY_TOKEN` is provided, reads use the
 * read-only token while writes go through the writer token — useful when
 * deploying with split credentials.
 *
 * @returns A configured cache provider, or `null` when Upstash env is
 *   missing.
 *
 * @example
 * ```ts
 * const cache = createCacheProvider();
 * if (cache) {
 *     await cache.set('key', value, 3600);
 *     const fresh = await cache.get('key');
 * }
 * ```
 *
 * @see CacheProvider
 */
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
