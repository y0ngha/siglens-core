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

/**
 * Most distinct failures tracked at once. When full, entries past the window go
 * first, then the oldest — so failures whose text changes on every call (a
 * request id in the message) cannot grow the map without bound.
 */
const FAILURE_LOG_MAX_KEYS = 100;

/**
 * Last log time per failure key (`url` + error, never the token), on the
 * monotonic clock so a wall-clock step back cannot silence the log.
 */
const lastLoggedAt = new Map<string, number>();

function describeValue(value: unknown): string {
    return value instanceof Error
        ? `${value.name}: ${value.message}`
        : inspect(value, { depth: 2 });
}

/** Name, message, `code` and `cause` — what tells two failures apart. */
function errorKey(error: unknown): string {
    if (!(error instanceof Error)) return describeValue(error);
    const code =
        'code' in error && error.code !== undefined
            ? ` [${String(error.code)}]`
            : '';
    const cause =
        error.cause !== undefined
            ? ` (cause: ${describeValue(error.cause)})`
            : '';
    return `${describeValue(error)}${code}${cause}`;
}

function trackLogged(key: string, now: number): void {
    if (lastLoggedAt.size >= FAILURE_LOG_MAX_KEYS) {
        // Deleting the entry just visited is safe while iterating a Map; one pass
        // removes everything past the window.
        for (const [staleKey, at] of lastLoggedAt)
            if (now - at >= FAILURE_LOG_WINDOW_MS)
                lastLoggedAt.delete(staleKey);
        // Still full: drop the oldest. A Map iterates in insertion order and a
        // re-logged key is deleted before it is set again, so the first key is
        // the least recently logged.
        const oldest = lastLoggedAt.keys().next();
        if (lastLoggedAt.size >= FAILURE_LOG_MAX_KEYS && !oldest.done)
            lastLoggedAt.delete(oldest.value);
    }
    lastLoggedAt.delete(key);
    lastLoggedAt.set(key, now);
}

/**
 * Log a client failure, at most once per window for the same URL and error.
 * Adapters fail open, so without the log a broken setup would silently switch
 * features off; consumers build factories per request and every failed call
 * reaches here, so an unthrottled log would grow with traffic. The window also
 * means a failure that recurs after a recovery is logged again.
 */
function logFailure(url: string, error: unknown): void {
    const now = performance.now();
    const key = `${url}\u0000${errorKey(error)}`;
    const last = lastLoggedAt.get(key);
    if (last !== undefined && now - last < FAILURE_LOG_WINDOW_MS) return;
    trackLogged(key, now);
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
 * Trade-offs (`src/infrastructure/CLAUDE.md#INF-10`): while the setup is broken,
 * every Redis operation re-runs the failing load (a synchronous `require` lookup
 * in the CommonJS build); that cost exists only until the setup is fixed. Calls
 * waiting on the same failed attempt all fail together, so a burst at that
 * moment fails open as a group, the same as a Redis outage. Failures are logged
 * through a time window ({@link logFailure}). Revisit with a short negative TTL
 * (remember a failure for a few seconds) if a broken deployment shows the
 * reload in request latency.
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
                // A memo cache has to drop a failed entry; `loadOptionalSdk` does the
                // same. CONVENTIONS.md#CP-7 targets flags derived inside a handler,
                // not a cache slot that must be cleared for the next attempt.
                client = undefined;
                logFailure(url, error);
                throw error;
            });
        return client;
    };
}
