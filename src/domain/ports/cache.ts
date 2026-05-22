/**
 * @port
 * Generic key-value cache contract the domain depends on for memoizing
 * expensive analyses (LLM responses, briefings, sector signals, …).
 *
 * Adapters live in `infrastructure/cache/` and surface the underlying
 * client's errors to the caller — graceful degradation (e.g. treating a
 * cache failure as a miss) is the responsibility of the application-layer
 * caller, not the adapter. Adapters are expected to serialize JSON
 * automatically — pass plain objects to `set` / receive plain objects
 * from `get`.
 */
export interface CacheProvider {
    /** Read a previously stored value, or `null` when absent. */
    get<T>(key: string): Promise<T | null>;
    /** Store `value` under `key` with the given TTL (in seconds). */
    set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
    /** Remove the value at `key`. */
    delete(key: string): Promise<void>;
}
