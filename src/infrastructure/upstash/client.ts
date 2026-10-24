import type { Redis } from '@upstash/redis';
import { loadOptionalSdk } from '@/infrastructure/optionalPeer/loadOptionalSdk';

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
 * A failure is memoized and logged once. Unlike a Redis outage it is a setup
 * error that does not heal on retry — a missing package, or a URL the client
 * constructor rejects. Adapters fail open on Redis errors, so without the log
 * the misconfiguration would silently switch features off (for example the
 * chat token limit); without the memo every operation would re-run the failing
 * module resolution and repeat the error.
 *
 * Call it inside the adapter's `try` so the failure takes the same path as a
 * Redis outage.
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
                console.error(
                    '[upstash] Redis client unavailable; Redis-backed features degrade until the setup is fixed',
                    error
                );
                throw error;
            });
        return client;
    };
}
