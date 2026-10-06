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
    /**
     * Store `value` under `key` with the given TTL **only if `key` is absent**
     * (Redis `SET NX EX`), atomically across every process sharing the store.
     *
     * @returns `true` when this call stored the value (it now holds the key),
     *   `false` when the key already existed.
     *
     * Optional so a consumer-built provider (tests, an in-memory stub) stays
     * valid; without it, core skips cross-instance generation dedupe and only
     * deduplicates within the process.
     */
    setIfAbsent?<T>(
        key: string,
        value: T,
        ttlSeconds: number
    ): Promise<boolean>;
    /**
     * Delete `key` **only if** it currently holds the string `value`, as one
     * atomic step (compare-and-delete). Releases a lock taken with
     * `setIfAbsent` without dropping a successor's lock after the original one
     * expired.
     *
     * @returns `true` when the key matched and was deleted.
     *
     * Optional; without it core never deletes a lock explicitly and lets its
     * TTL expire instead (an unconditional delete could free someone else's).
     */
    deleteIfEquals?(key: string, value: string): Promise<boolean>;
}
