import { inspect } from 'node:util';
import type { Redis } from '@upstash/redis';
import {
    loadOptionalSdk,
    MissingSdkError,
} from '@/infrastructure/optionalPeer/loadOptionalSdk';

const loadUpstash = loadOptionalSdk(
    '@upstash/redis',
    'the Upstash Redis cache and counters',
    () => import('@upstash/redis')
);

/**
 * Set once `@upstash/redis` turns out to be missing. Unlike `loadOptionalSdk`
 * (which retries so a runtime install can succeed), a missing Redis package is
 * remembered for the process: Redis adapters run on hot paths, and in the
 * CommonJS build every retry is a synchronous `require` lookup through
 * `node_modules`. Installing the package needs a restart anyway.
 */
let missingPackage: MissingSdkError | undefined;

/** Failures already logged, keyed by client and error. Cleared on any success. */
const loggedFailures = new Set<string>();

function errorKey(error: unknown): string {
    if (!(error instanceof Error)) return inspect(error, { depth: 2 });
    const cause =
        error.cause instanceof Error ? ` (cause: ${error.cause.message})` : '';
    return `${error.name}: ${error.message}${cause}`;
}

/**
 * Log a failure once per client and error. Adapters fail open, so without the
 * log a misconfiguration would silently switch features off; consumers build
 * factories per request, so logging per client instance would repeat on every
 * request. The writer and read-only clients are told apart by token.
 */
function logFailureOnce(clientKey: string, error: unknown): void {
    const key = `${clientKey}\u0000${errorKey(error)}`;
    if (loggedFailures.has(key)) return;
    loggedFailures.add(key);
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
 * {@link loadOptionalSdk} the first time the returned function is called.
 *
 * Failures are handled by kind:
 * - The constructor rejecting `url`/`token` always recurs for this client, so
 *   it is remembered for the client.
 * - A missing package is remembered for the process ({@link missingPackage}).
 * - Any other load failure may be transient (a flaky fs read during the
 *   import) and is retried on the next call. Callers keep the returned
 *   function for the life of the process (`reanalyzeCooldown` holds it
 *   module-wide) and adapters fail open, so remembering a transient failure
 *   would leave a feature off until restart — the reanalysis cooldown is what
 *   stops cache-bypassing LLM calls.
 *
 * Each failure is logged once per client and error; a later success clears the
 * record so a recurrence is logged again.
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
    const clientKey = `${url}\u0000${token}`;
    let client: Promise<Redis> | undefined;
    const fail = (error: unknown, remember: boolean): Promise<never> => {
        logFailureOnce(clientKey, error);
        if (!remember) client = undefined;
        return Promise.reject(error);
    };
    return () => {
        if (missingPackage) return Promise.reject(missingPackage);
        client ??= loadUpstash().then(
            ({ Redis: RedisClient }) => {
                try {
                    const created = new RedisClient({ url, token });
                    loggedFailures.clear();
                    return created;
                } catch (error) {
                    return fail(error, true);
                }
            },
            (error: unknown) => {
                if (error instanceof MissingSdkError) missingPackage = error;
                return fail(error, error instanceof MissingSdkError);
            }
        );
        return client;
    };
}
