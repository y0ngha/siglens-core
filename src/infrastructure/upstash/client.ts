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
 * A failure is **not** memoized: the next call tries again, like
 * `loadOptionalSdk`. Callers cache the returned function for the life of the
 * process (`reanalyzeCooldown` keeps it module-wide), so a remembered failure
 * would turn one transient error — a flaky fs read during the import — into a
 * feature that stays off until restart, and the adapters fail open (the
 * reanalysis cooldown is what stops cache-bypassing LLM calls). The cost is
 * that a deployment with the package missing re-runs the failing module
 * resolution on every operation; that only happens while the setup is broken.
 *
 * Each distinct failure is logged once per process, not once per client.
 * Adapters fail open, so without the log a misconfiguration would silently
 * switch features off; consumers build factories per request, so a per-client
 * log would repeat on every request.
 *
 * Call it inside the adapter's `try` so the failure takes the same path as a
 * Redis outage.
 *
 * @param url - `UPSTASH_REDIS_REST_URL`.
 * @param token - REST token (writer or read-only).
 * @returns A function resolving to the shared client.
 */
/** Failures already logged in this process, keyed by error name and message. */
const loggedFailures = new Set<string>();

function logFailureOnce(error: unknown): void {
    const key =
        error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error);
    if (loggedFailures.has(key)) return;
    loggedFailures.add(key);
    console.error(
        '[upstash] Redis client unavailable; Redis-backed features degrade until the setup is fixed',
        error
    );
}

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
                logFailureOnce(error);
                throw error;
            });
        return client;
    };
}
