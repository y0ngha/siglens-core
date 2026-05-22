/** Outcome of {@link tryAcquireReanalyzeCooldown}. */
export type AcquireReanalyzeCooldownResult =
    | { ok: true }
    | { ok: false; remainingMs: number };

/** @internal Validated worker configuration (URL + shared secret). */
export interface WorkerConfig {
    workerUrl: string;
    workerSecret: string;
}

/** @internal Validated Alpaca API credentials. */
export interface AlpacaConfig {
    apiKey: string;
    secretKey: string;
}
