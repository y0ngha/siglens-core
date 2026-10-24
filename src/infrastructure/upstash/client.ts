import { inspect } from 'node:util';
import type { Redis } from '@upstash/redis';
import { loadOptionalSdk } from '@/infrastructure/optionalPeer/loadOptionalSdk';

const loadUpstash = loadOptionalSdk(
    '@upstash/redis',
    'the Upstash Redis cache and counters',
    () => import('@upstash/redis')
);

/** The same failure is logged at most once per window. */
const FAILURE_LOG_WINDOW_MS = 5 * 60 * 1000;

/** Above this many distinct failures, entries older than the window are dropped. */
const FAILURE_LOG_PRUNE_AT = 100;

/** Last log time per failure key (`url` + error, never the token). */
const lastLoggedAt = new Map<string, number>();

function errorKey(error: unknown): string {
    if (!(error instanceof Error)) return inspect(error, { depth: 2 });
    const cause =
        error.cause instanceof Error ? ` (cause: ${error.cause.message})` : '';
    return `${error.name}: ${error.message}${cause}`;
}

/**
 * Log a client failure, at most once per window for the same URL and error.
 * Adapters fail open, so without the log a broken setup would silently switch
 * features off; consumers build factories per request and every failed call
 * reaches here, so an unthrottled log would grow with traffic. The window also
 * means a failure that recurs after a recovery is logged again.
 */
function logFailure(url: string, error: unknown): void {
    const now = Date.now();
    const key = `${url}\u0000${errorKey(error)}`;
    const last = lastLoggedAt.get(key);
    if (last !== undefined && now - last < FAILURE_LOG_WINDOW_MS) return;
    if (lastLoggedAt.size >= FAILURE_LOG_PRUNE_AT)
        for (const [staleKey, at] of lastLoggedAt)
            if (now - at >= FAILURE_LOG_WINDOW_MS)
                lastLoggedAt.delete(staleKey);
    lastLoggedAt.set(key, now);
    console.error(
        '[upstash] Redis client unavailable; Redis-backed features degrade until the setup is fixed',
        error
    );
}

/**
 * @internal
 * A Redis client for `url`/`token` that is created on first use.
 *
 * `@upstash/redis` is an optional peer dependency (INF-11), so it must not be
 * `require`d when the package entry is loaded — a consumer that never sets the
 * Upstash env would otherwise fail on import. The module is loaded through
 * {@link loadOptionalSdk} on the first call; a missing package rejects with
 * `MissingSdkError`.
 *
 * Only a created client is kept. Any failure — a missing package, a URL the
 * constructor rejects, a flaky read during the import — is retried on the next
 * call, the same policy as `loadOptionalSdk`. Some callers hold the returned
 * function for the whole process (`reanalyzeCooldown` keeps it module-wide) and
 * the adapters fail open, so a remembered failure would leave a feature off
 * until restart; the reanalysis cooldown is what stops cache-bypassing LLM
 * calls.
 *
 * Trade-offs (INF-10): while the setup is broken, every Redis operation re-runs
 * the failing load (a synchronous `require` lookup in the CommonJS build) — that
 * cost exists only until the setup is fixed. Calls that are waiting on the same
 * failed attempt all fail together, so a burst at that moment fails open as a
 * group, the same as a Redis outage. Failures are logged through a time window
 * ({@link logFailure}).
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
                client = undefined;
                logFailure(url, error);
                throw error;
            });
        return client;
    };
}
