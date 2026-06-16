import type { BackgroundTaskOptions } from '@/application/types';
import type { CongressTradesProvider } from '@/domain/ports/congressTradesProvider';
import type {
    CongressTrendResponse,
    ModelId,
    Tier,
    TierConfig,
} from '@/domain/types';

// ─────────────────────────────────────────
// Submit
// ─────────────────────────────────────────

/**
 * Options controlling congressional-trade trend analysis submission.
 *
 * Congress data is fully public, so — unlike the financials submit options —
 * there is NO `usage` / `now` / `userApiKey` field: no daily-limit check and no
 * BYOK gate apply. The worker payload always carries {@link DEFAULT_TIER}.
 */
export interface SubmitCongressTrendOptions extends BackgroundTaskOptions {
    /** U.S. equity ticker (e.g. `"AAPL"`). */
    symbol: string;
    /** LLM model identifier used for the analysis and cache scoping. */
    modelId: ModelId;
    /**
     * Congress trades provider implementation (injected by the caller).
     * Core depends only on the interface — never on a concrete HTTP client.
     */
    dataProvider: CongressTradesProvider;
    /**
     * Resolved subscription tier forwarded to the worker payload. Defaults to
     * {@link DEFAULT_TIER}. Congress is public, so this is informational only —
     * no gating is applied.
     */
    tier?: Tier;
    /** Tier configuration override, mainly for tests and controlled rollouts. */
    tierConfig?: TierConfig;
    /**
     * When `true`, skip enqueueing a new analysis job on cache miss and return
     * `{ status: 'miss_no_trigger' }` instead. Cache hits are unaffected.
     * Intended for consumer-side gating of bot/crawler traffic.
     */
    skipEnqueueIfMiss?: boolean;
    /** When true, bypass the cache and enqueue a fresh analysis. */
    force?: boolean;
    /** Number of trade records to fetch per chamber. Defaults to `50`. */
    limit?: number;
}

/** The caller receives a cached analysis — no new job was created. */
export interface SubmitCongressTrendCached {
    status: 'cached';
    result: CongressTrendResponse;
}

/** A new analysis job was submitted; poll with `jobId` for the result. */
export interface SubmitCongressTrendSubmitted {
    status: 'submitted';
    jobId: string;
}

/**
 * Result indicating the analysis cache missed but no job was enqueued because
 * the caller opted out via `skipEnqueueIfMiss`. The consumer renders a fallback.
 */
export interface SubmitCongressTrendMissNoTrigger {
    status: 'miss_no_trigger';
}

/**
 * Result variant when the data fetch returned zero trades after normalization.
 *
 * Congress 0건 = 정상(NOT an error): many symbols simply have no disclosures.
 * No job is enqueued and the LLM is never called — a deliberate cost guard.
 */
export interface SubmitCongressTrendNoTrades {
    status: 'no_trades';
}

/** Result variant when the provider fetch or data normalization fails. */
export interface SubmitCongressTrendFetchError {
    status: 'error';
    code: 'fetch_failed';
    error?: string;
}

/** Union of all possible outcomes from `submitCongressTrend`. */
export type SubmitCongressTrendResult =
    | SubmitCongressTrendCached
    | SubmitCongressTrendSubmitted
    | SubmitCongressTrendMissNoTrigger
    | SubmitCongressTrendNoTrades
    | SubmitCongressTrendFetchError;

// ─────────────────────────────────────────
// Poll
// ─────────────────────────────────────────

/** Outcome of polling congress trend analysis: processing, finished, or errored. */
export type PollCongressTrendResult =
    | { status: 'processing' }
    | { status: 'done'; result: CongressTrendResponse }
    | { status: 'error'; error: string };
