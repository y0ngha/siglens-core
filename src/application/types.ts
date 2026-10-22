import type { CacheProvider } from '@/domain/ports/cache';
import type { WaitUntil } from '@/domain/types';

/**
 * Runtime hooks for background tasks started by application use-cases.
 */
export interface BackgroundTaskOptions {
    /**
     * Optional serverless lifetime extender for fire-and-forget work.
     *
     * On Vercel, pass `waitUntil` from `@vercel/functions` so worker dispatch,
     * cache writes, cleanup, and other background promises can continue after
     * the response is returned.
     */
    waitUntil?: WaitUntil;
}

/**
 * Optional cache injection shared by every cache-reading use-case. Mixed into
 * the use-case options objects, and accepted as a trailing parameter by the
 * positional `peek*` / `getSectorSignals` functions.
 */
export interface CacheOptions {
    /**
     * Cache backing the use-case's read, write, in-flight lock and peek-pointer
     * keys. Omitted (`undefined`) → the Upstash cache built from env
     * (`createCacheProvider()`, which is `null` when the env is missing).
     * A {@link CacheProvider} → that cache is used throughout. `null` → run with
     * no cache at all; the env cache is NOT consulted.
     */
    cache?: CacheProvider | null;
}
