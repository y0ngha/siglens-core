/** @internal Options accepted by {@link JobStateStore.set}. */
export interface JobStateSetOpts {
    /** TTL in seconds. */
    ttlSeconds: number;
}

/**
 * @port @internal
 * Minimal key-value surface the job-queue layer depends on for tracking
 * analysis-job lifecycle state (status, result, error, meta, cancelled flag).
 *
 * Unlike {@link CacheProvider}, this port exposes a multi-key `deleteMany`
 * so `cleanupJob` can drop every key associated with a finished job in one
 * round-trip. Adapters live in `infrastructure/jobs/` and surface the
 * underlying client's errors to the caller — graceful degradation
 * (skipping the call when the adapter factory returned `null`) is the
 * responsibility of the job-queue helpers, not the adapter.
 */
export interface JobStateStore {
    /** Read a previously stored value, or `null` when absent. */
    get<T>(key: string): Promise<T | null>;
    /** Store `value` under `key` with the given TTL (see {@link JobStateSetOpts}). */
    set<T>(key: string, value: T, opts: JobStateSetOpts): Promise<void>;
    /** Delete all specified keys in a single round-trip; returns the number of keys removed. */
    deleteMany(...keys: string[]): Promise<number>;
}
