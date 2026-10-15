import { dedupeInFlight } from '@/application/analysis/inFlight';
import type {
    GenerationDedupeOptions,
    LockClaim,
    LockingCacheProvider,
    PublishedGeneration,
} from '@/application/analysis/types';
import type { CacheProvider } from '@/domain/ports/cache';
import {
    buildGenerationLockKey,
    buildGenerationResultKey,
    GENERATION_LOCK_TTL_SECONDS,
    GENERATION_RESULT_MAX_LENGTH,
    GENERATION_RESULT_TTL_SECONDS,
} from '@/infrastructure/cache/config';

/**
 * @internal How long a peer waits for the lock winner before generating itself.
 * Matches `withRetry`'s wall-clock budget (240s): a winner still running past
 * it is a degraded provider, and the waiter's own caller deadline is near.
 */
export const GENERATION_WAIT_MAX_MS = 240_000;

/** @internal Delay between a waiting peer's checks for the winner's result. */
export const GENERATION_POLL_INTERVAL_MS = 2_000;

const LOG_TAG = '[GenerationLock]';

function supportsLocking(
    cache: CacheProvider | null
): cache is LockingCacheProvider {
    return cache !== null && typeof cache.setIfAbsent === 'function';
}

function isPublishedGeneration(value: unknown): value is PublishedGeneration {
    return (
        typeof value === 'object' &&
        value !== null &&
        'raw' in value &&
        typeof value.raw === 'string'
    );
}

/**
 * @internal Default {@link GenerationDedupeOptions.accept}: the raw output is a
 * strict JSON document. Fenced or otherwise lenient output is still usable by
 * the winner's own caller; it just is not shared, so peers generate their own.
 */
export function isStrictJson(raw: string): boolean {
    try {
        JSON.parse(raw);
        return true;
    } catch {
        return false;
    }
}

function safeAccept(accept: (raw: string) => boolean, raw: string): boolean {
    try {
        return accept(raw);
    } catch {
        return false;
    }
}

function sleepUnlessAborted(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason);
            return;
        }
        const onAbort = (): void => {
            clearTimeout(timer);
            reject(signal?.reason);
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

async function readLockToken(
    cache: CacheProvider,
    lockKey: string
): Promise<string | null> {
    try {
        const value = await cache.get<unknown>(lockKey);
        return typeof value === 'string' ? value : null;
    } catch (error) {
        console.error(LOG_TAG, 'Lock read failed:', error);
        return null;
    }
}

async function readPublished(
    cache: CacheProvider,
    cacheKey: string,
    token: string,
    accept: (raw: string) => boolean
): Promise<string | null> {
    try {
        const value = await cache.get<unknown>(
            buildGenerationResultKey(cacheKey, token)
        );
        return isPublishedGeneration(value) && safeAccept(accept, value.raw)
            ? value.raw
            : null;
    } catch (error) {
        console.error(LOG_TAG, 'Result read failed:', error);
        return null;
    }
}

/**
 * Poll for the current lock holder's published output.
 *
 * Reads once before the first sleep, so a result that is already there costs
 * no delay. The waiter only reads the result keyed by the token it saw in the
 * lock, so an earlier generation's output for the same `cacheKey` is never
 * reused. When the token changes (the holder released, or its lock expired and
 * someone else took it) the old token's result gets one last look — the winner
 * publishes BEFORE releasing — and then the waiter follows the new holder, or
 * gives up when no one holds the lock.
 */
async function waitForPeer(
    cache: CacheProvider,
    cacheKey: string,
    options: GenerationDedupeOptions,
    accept: (raw: string) => boolean
): Promise<string | null> {
    const lockKey = buildGenerationLockKey(cacheKey);
    const pollIntervalMs =
        options.pollIntervalMs ?? GENERATION_POLL_INTERVAL_MS;
    const deadline = Date.now() + (options.maxWaitMs ?? GENERATION_WAIT_MAX_MS);
    let token = await readLockToken(cache, lockKey);
    while (token !== null) {
        const published = await readPublished(cache, cacheKey, token, accept);
        if (published !== null) return published;
        if (Date.now() >= deadline) return null;
        await sleepUnlessAborted(pollIntervalMs, options.signal);
        const current = await readLockToken(cache, lockKey);
        if (current !== token) {
            const last = await readPublished(cache, cacheKey, token, accept);
            if (last !== null) return last;
        }
        token = current;
    }
    return null;
}

async function tryClaim(
    cache: LockingCacheProvider,
    lockKey: string
): Promise<LockClaim> {
    const token = globalThis.crypto.randomUUID();
    try {
        const acquired = await cache.setIfAbsent(
            lockKey,
            token,
            GENERATION_LOCK_TTL_SECONDS
        );
        return acquired ? { kind: 'owned', token } : { kind: 'contended' };
    } catch (error) {
        // Fail open: a Redis outage must not block generation.
        console.error(LOG_TAG, 'Lock acquire failed:', error);
        return { kind: 'failOpen' };
    }
}

/**
 * Release only if this caller still owns the lock (atomic compare-and-delete).
 * A provider without `deleteIfEquals` gets no explicit release — the TTL
 * frees the lock — because a plain delete could drop a successor's lock after
 * ours expired.
 */
async function releaseLock(
    cache: CacheProvider,
    lockKey: string,
    token: string
): Promise<void> {
    if (typeof cache.deleteIfEquals !== 'function') return;
    try {
        await cache.deleteIfEquals(lockKey, token);
    } catch (error) {
        console.error(LOG_TAG, 'Lock release failed:', error);
    }
}

async function generateAndPublish(
    cache: CacheProvider,
    cacheKey: string,
    token: string,
    generate: () => Promise<string>,
    accept: (raw: string) => boolean
): Promise<string> {
    try {
        const raw = await generate();
        // Publish before releasing so a peer that sees the lock vanish always
        // finds the result. Oversized or unacceptable output is not shared;
        // peers then generate their own once the lock is released.
        if (
            raw.length <= GENERATION_RESULT_MAX_LENGTH &&
            safeAccept(accept, raw)
        ) {
            await cache
                .set<PublishedGeneration>(
                    buildGenerationResultKey(cacheKey, token),
                    { raw },
                    GENERATION_RESULT_TTL_SECONDS
                )
                .catch((error: unknown) =>
                    console.error(LOG_TAG, 'Result publish failed:', error)
                );
        }
        return raw;
    } finally {
        // Released on failure too, so peers stop waiting and generate
        // themselves instead of sitting out the lock TTL.
        await releaseLock(cache, buildGenerationLockKey(cacheKey), token);
    }
}

async function generateOnceAcrossInstances(
    cache: CacheProvider | null,
    cacheKey: string,
    generate: () => Promise<string>,
    options: GenerationDedupeOptions
): Promise<string> {
    if (!supportsLocking(cache)) return generate();
    const accept = options.accept ?? isStrictJson;
    const claim = await tryClaim(cache, buildGenerationLockKey(cacheKey));
    if (claim.kind === 'failOpen') return generate();
    if (claim.kind === 'owned') {
        return generateAndPublish(
            cache,
            cacheKey,
            claim.token,
            generate,
            accept
        );
    }
    const peerRaw = await waitForPeer(cache, cacheKey, options, accept);
    // Bounded wait ran out, the winner failed, or its output was unusable:
    // generate once ourselves. Not published — the lock is someone else's or
    // no one's.
    return peerRaw ?? generate();
}

/**
 * @internal
 * Run an expensive LLM generation at most once per in-flight key — within this
 * process AND across instances sharing the cache. The in-flight key is
 * `options.inFlightKey`, defaulting to `cacheKey`: callers pass `cacheKey` under
 * `keyPolicy: 'tier'` (so website callers share one run) and a per-key-hash
 * scoped key under `'byok-only'` (so a run only ever serves callers on the same
 * user key). Across instances the Redis lock and result keys derive from
 * `cacheKey` alone, so a cross-instance waiter still coordinates with a winner
 * on any key, and generates on its own key if that winner failed.
 *
 * In-process callers join one promise ({@link dedupeInFlight}). Across
 * instances, the first caller takes a Redis `SET NX` lock derived from
 * `cacheKey`, holding a random token, and generates; the others poll for the
 * winner's **raw** LLM output, published under a short-lived key bound to that
 * token, and return it as if they had generated it. Every caller then runs its
 * own post-processing and cache write on that raw text, exactly as in-process
 * joiners already do, so call sites keep a single code path.
 *
 * **Shared signal.** In-process joiners share the first caller's run, so the
 * first caller's `options.signal` governs both its LLM call and its peer wait;
 * a later joiner's signal is not observed. If the first caller aborts, every
 * joiner rejects with that abort — the same semantics `dedupeInFlight` always
 * had for the LLM call itself.
 *
 * Bounded and fail-open: a waiter gives up after `maxWaitMs`, or as soon as the
 * lock disappears without a usable result (the winner failed), and generates
 * once itself. This is deliberate fail-open: when a winner fails, every
 * waiting instance generates concurrently (bounded by the number of instances
 * contending for the key) rather than leaving users without a result. A cache without `setIfAbsent`, or a Redis error while claiming,
 * degrades to process-local dedupe only (and never releases a lock it does not
 * own). Release is an atomic compare-and-delete on the token
 * (`deleteIfEquals`); without that method the lock simply expires after
 * {@link GENERATION_LOCK_TTL_SECONDS}.
 *
 * @param cache - The cache provider the caller reads/writes `cacheKey` with.
 * @param cacheKey - The result's cache key; the cross-instance lock and
 *   result keys are scoped to it.
 * @param generate - The LLM call. Runs at most once per winner; a waiter that
 *   receives the peer's output never calls it.
 * @param options - `signal` aborts a waiter's polling; wait/poll bounds; the
 *   `accept` check for shareable output; `inFlightKey` scopes the in-process
 *   join (default `cacheKey`) without changing the cache or Redis keys.
 * @returns The raw LLM output — this caller's, or the winning peer's.
 */
export function dedupeGeneration(
    cache: CacheProvider | null,
    cacheKey: string,
    generate: () => Promise<string>,
    options: GenerationDedupeOptions = {}
): Promise<string> {
    return dedupeInFlight(options.inFlightKey ?? cacheKey, () =>
        generateOnceAcrossInstances(cache, cacheKey, generate, options)
    );
}
