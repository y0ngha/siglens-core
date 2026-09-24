/** Outcome of {@link tryAcquireReanalyzeCooldown}. */
export type AcquireReanalyzeCooldownResult =
    { ok: true } | { ok: false; remainingMs: number };

/** @internal Validated worker configuration (URL + shared secret). */
