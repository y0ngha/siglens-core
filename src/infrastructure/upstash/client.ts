import type { Redis } from '@upstash/redis';
import { loadOptionalSdk } from '@/infrastructure/ai/loadOptionalSdk';

const loadUpstash = loadOptionalSdk(
    '@upstash/redis',
    'the Upstash Redis cache and counters',
    () => import('@upstash/redis')
);

/**
 * @internal
 * A Redis client for `url`/`token` that is created on first use.
 *
 * `@upstash/redis` is an optional peer dependency (INF-11), so it must not be
 * `require`d when the package entry is loaded — a consumer that never sets the
 * Upstash env would otherwise fail on import. The module is loaded through
 * {@link loadOptionalSdk} the first time the returned function is called; a
 * missing package rejects with `MissingSdkError`.
 *
 * The client is memoized per returned function. A failed load is not, so a
 * later call can succeed once the package is installed (same as the AI SDKs).
 *
 * Call it inside the adapter's `try` so a missing package degrades through the
 * same path as a Redis outage.
 *
 * @param url - `UPSTASH_REDIS_REST_URL`.
 * @param token - REST token (writer or read-only).
 * @returns A function resolving to the shared client.
 */
export function lazyRedisClient(
    url: string,
    token: string
): () => Promise<Redis> {
    let client: Promise<Redis> | undefined;
    return () => {
        client ??= loadUpstash()
            .then(({ Redis: RedisClient }) => new RedisClient({ url, token }))
            .catch((error: unknown) => {
                client = undefined;
                throw error;
            });
        return client;
    };
}
