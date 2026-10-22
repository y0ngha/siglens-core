import type { CacheProvider } from '@/domain/ports/cache';
import { createCacheProvider } from '@/infrastructure/cache/redis';

/**
 * Resolve the cache a use-case runs with.
 *
 * - `undefined` (option omitted) → the env-configured Upstash cache from
 *   {@link createCacheProvider}, which is `null` when the env is missing.
 * - a {@link CacheProvider} → returned as-is; `createCacheProvider` is not called.
 * - `null` → an explicit "no cache"; returned as `null` WITHOUT falling back to
 *   Upstash. This is why the helper cannot use `??`.
 *
 * @internal Not exported from the package entrypoints.
 */
export function resolveCacheProvider(
    injected: CacheProvider | null | undefined
): CacheProvider | null {
    if (injected === undefined) return createCacheProvider();
    return injected;
}
