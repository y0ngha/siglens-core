/**
 * @port
 * Per-client daily chat token bucket the application layer depends on to
 * rate-limit chat completion requests. Implementations track how many tokens
 * a given hashed client identifier has consumed within the active window and
 * expose a refund operation so failed downstream calls can release the slot
 * back to the user.
 *
 * Adapters live in `infrastructure/chat/` and surface the underlying client's
 * errors to the caller — graceful degradation (e.g. treating a store outage
 * as "limit not reached" so chat remains usable) is the responsibility of the
 * adapter or the application-layer caller depending on the operation.
 *
 * All identifiers are expected to be already hashed (see `hashClientIp` in
 * the adapter module) — the port never sees raw client IPs.
 */
export interface ChatTokenStore {
    /**
     * Atomically claim one token for `hashedClientId`.
     *
     * @returns `true` when the caller is still within the daily limit (the
     *   request may proceed), `false` when the limit has been exhausted.
     */
    tryConsumeToken(hashedClientId: string): Promise<boolean>;
    /**
     * Release one previously-consumed token back to `hashedClientId`. Used
     * when a downstream call (e.g. LLM provider) fails and the caller should
     * not be charged for the attempt.
     */
    refundConsumedToken(hashedClientId: string): Promise<void>;
    /** Return the number of tokens still available to `hashedClientId`. */
    getRemainingTokens(hashedClientId: string): Promise<number>;
}
