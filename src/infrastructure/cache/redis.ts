import type { CacheProvider } from '@/domain/ports/cache';
import { lazyRedisClient } from '@/infrastructure/upstash/client';
import { readUpstashConfig } from '@/infrastructure/upstash/config';

/**
 * Lua compare-and-delete: deletes `KEYS[1]` only while it still holds
 * `ARGV[1]`. Returns 1 when deleted, 0 otherwise.
 */
const COMPARE_AND_DELETE_SCRIPT =
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

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
 * `@upstash/redis` is loaded on the first operation, not at construction; when
 * the env is set but the package is not installed, operations reject with
 * `MissingSdkError`.
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

    const writer = lazyRedisClient(config.url, config.token);
    const reader = config.readonlyToken
        ? lazyRedisClient(config.url, config.readonlyToken)
        : writer;

    return {
        async get<T>(key: string): Promise<T | null> {
            return (await reader()).get<T>(key);
        },
        async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
            await (await writer()).set(key, value, { ex: ttlSeconds });
        },
        async delete(key: string): Promise<void> {
            await (await writer()).del(key);
        },
        async setIfAbsent<T>(
            key: string,
            value: T,
            ttlSeconds: number
        ): Promise<boolean> {
            // `SET key value NX EX ttl` replies `"OK"` when it wrote and `null`
            // when the key already existed — atomic on the server, so exactly
            // one concurrent caller across all instances gets `true`.
            const reply = await (
                await writer()
            ).set(key, value, {
                nx: true,
                ex: ttlSeconds,
            });
            return reply !== null;
        },
        async deleteIfEquals(key: string, value: string): Promise<boolean> {
            // GET + DEL in one Lua script so no other client can take the key
            // between the comparison and the delete.
            const deleted = await (
                await writer()
            ).eval<[string], number>(COMPARE_AND_DELETE_SCRIPT, [key], [value]);
            return deleted === 1;
        },
    };
}
