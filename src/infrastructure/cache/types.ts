/**
 * Generic key-value cache contract used throughout the package.
 *
 * Implementations should fail-safe: read errors return `null`, write errors
 * are silently swallowed (the caller decides whether to log them). The
 * Upstash-backed implementation in `cache/redis.ts` uses JSON serialization
 * automatically — pass plain objects to `set` / receive plain objects from `get`.
 */
export interface CacheProvider {
    /** Read a previously stored value, or `null` when absent. */
    get<T>(key: string): Promise<T | null>;
    /** Store `value` under `key` with the given TTL (in seconds). */
    set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
    /** Remove the value at `key`. */
    delete(key: string): Promise<void>;
}

/** @internal Cached payload for a market briefing entry. */
export interface CachedBriefingData {
    briefing: unknown;
    generatedAt: string;
}
