/**
 * Thrown by fail-closed stores when the backing store is unreachable, so
 * callers can answer `server_busy` instead of "quota exhausted".
 */
export class CounterStoreUnavailableError extends Error {
    constructor(
        readonly prefix: string,
        options?: { cause?: unknown }
    ) {
        super(`counter store unavailable (${prefix})`, options);
        this.name = 'CounterStoreUnavailableError';
    }
}

/**
 * @port
 * Period-bucketed counter used for daily/monthly quotas. Subjects are opaque
 * strings the application composes (e.g. `userId`, `'global'`).
 */
export interface CounterStore {
    /**
     * Atomically claim one unit. Returns `false` only when `limit` would be
     * exceeded. Fail-closed implementations throw
     * {@link CounterStoreUnavailableError} when the store is unreachable —
     * an outage must not look like an exhausted quota.
     */
    consume(subject: string, limit: number): Promise<boolean>;
    /** Release one previously claimed unit (never below zero). */
    refund(subject: string): Promise<void>;
    /** Units left in the current period. Never throws; fail-closed stores return 0 on outage. */
    remaining(subject: string, limit: number): Promise<number>;
}
