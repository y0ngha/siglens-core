/**
 * @port
 * Per-client daily chat token bucket the application layer depends on to
 * rate-limit chat completion requests. Implementations track how many tokens
 * a given hashed client identifier has consumed within the active window and
 * expose a refund operation so failed downstream calls can release the slot
 * back to the user.
 *
 * Implementations surface the underlying client's errors to the caller —
 * graceful degradation (e.g. treating a store outage as "limit not reached"
 * so chat remains usable) is the responsibility of the adapter or the
 * application-layer caller depending on the operation.
 *
 * All identifiers are expected to be already hashed before being passed to
 * this port — the port never sees raw client IPs.
 */
export interface ChatTokenStore {
    /**
     * Atomically claim one token for `hashedClientId`.
     *
     * @param hashedClientId - SHA-256 hashed client IP identifier.
     * @returns `true` when the caller is still within the daily limit (the
     *   request may proceed), `false` when the limit has been exhausted.
     */
    tryConsumeToken(hashedClientId: string): Promise<boolean>;
    /**
     * Release one previously-consumed token back to `hashedClientId`. Used
     * when a downstream call (e.g. LLM provider) fails and the caller should
     * not be charged for the attempt.
     *
     * @param hashedClientId - SHA-256 hashed client IP identifier.
     * @returns A promise that resolves when the token has been refunded.
     */
    refundConsumedToken(hashedClientId: string): Promise<void>;
    /**
     * Return the number of tokens still available to `hashedClientId`.
     *
     * @param hashedClientId - SHA-256 hashed client IP identifier.
     * @returns The number of remaining tokens within the current daily window.
     */
    getRemainingTokens(hashedClientId: string): Promise<number>;
}
