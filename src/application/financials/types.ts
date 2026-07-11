import type { BackgroundTaskOptions } from '@/application/types';
import type { UserApiKeyRequiredError } from '@/application/byok/types';
import type {
    AnalysisLimitError,
    AnalysisUsageOptions,
} from '@/application/usage/types';
import type {
    FinancialsAnalysisResponse,
    ModelId,
    StatementPeriod,
    Tier,
    TierConfig,
} from '@/domain/types';
import type { FinancialStatementsProvider } from '@/domain/ports/financialStatementsProvider';

// ─────────────────────────────────────────
// Submit
// ─────────────────────────────────────────

/** Options controlling financials analysis submission behavior. */
export interface SubmitFinancialsAnalysisOptions extends BackgroundTaskOptions {
    /** U.S. equity ticker (e.g. `"AAPL"`). */
    symbol: string;
    /** LLM model identifier used for the analysis and cache scoping. */
    modelId: ModelId;
    /**
     * Financial statements provider implementation (injected by the caller).
     * Core depends only on the interface — never on a concrete HTTP client.
     */
    dataProvider: FinancialStatementsProvider;
    /**
     * Resolved subscription tier.
     *
     * Must be provided when:
     * 1. `usage` is also provided — enforces the daily analysis limit.
     * 2. A premium model is requested — determines the BYOK key requirement.
     * Defaults to {@link DEFAULT_TIER} (`'free'`) when omitted.
     */
    tier?: Tier;
    /** Tier configuration override, mainly for tests and controlled rollouts. */
    tierConfig?: TierConfig;
    /**
     * Optional usage tracking. When provided together with `tier`, the daily
     * analysis limit is checked before fetching data, and one usage record is
     * written on every path that returns a result (cache hit or successful
     * submit). Omit to skip both checks and recording.
     */
    usage?: AnalysisUsageOptions;
    /**
     * Reference timestamp for limit checks. Defaults to `new Date()` at call
     * time. Useful in tests that need a fixed clock.
     */
    now?: Date;
    /**
     * BYOK API key. Must be provided when a non-pro tier requests a premium model.
     * When provided, forwarded to the worker as the X-AI-API-KEY header.
     */
    userApiKey?: string;
    /**
     * When `true`, skip enqueueing a new analysis job on cache miss and return
     * `{ status: 'miss_no_trigger' }` instead. Cache hits are unaffected and
     * still returned. Intended for consumer-side gating of bot/crawler traffic
     * that should not trigger worker compute.
     */
    skipEnqueueIfMiss?: boolean;
    /**
     * When true, bypass the cache and enqueue a fresh analysis. Mirrors
     * submitFundamentalAnalysis's force lever.
     */
    force?: boolean;
    /**
     * Statement period to fetch. Defaults to `'annual'`.
     * The cache key varies by period — `'annual'` and `'quarter'` produce
     * independent cache entries so the two result shapes are never mixed.
     */
    period?: StatementPeriod;
    /** Number of fiscal periods to fetch per statement. Defaults to `5`. */
    limit?: number;
    /**
     * Per-request deep-thinking toggle (member-reasoning-toggle spec, Part A).
     * `true` requests the model's default/spec reasoning depth; `false` or
     * omitted requests the provider-minimized setting — the pre-toggle
     * default. Folded into the cache key so ON and OFF results never
     * collide; forwarded to the worker `/analyze` body only when `true`.
     */
    reasoning?: boolean;
}

/** The caller receives a cached analysis — no new job was created. */
export interface SubmitFinancialsAnalysisCached {
    status: 'cached';
    result: FinancialsAnalysisResponse;
}

/** A new analysis job was submitted; poll with `jobId` for the result. */
export interface SubmitFinancialsAnalysisSubmitted {
    status: 'submitted';
    jobId: string;
}

/** Result variant when the daily analysis limit is exceeded. */
export interface SubmitFinancialsAnalysisLimitError {
    status: 'error';
    code: 'usage_limit_exceeded';
    error: AnalysisLimitError;
}

/** Result variant when the provider fetch or data normalization fails. */
export interface SubmitFinancialsAnalysisFetchError {
    status: 'error';
    code: 'fetch_failed';
    error?: string;
}

/** Result variant when a user BYOK API key is required for the requested model+tier combo. */
export type SubmitFinancialsAnalysisApiKeyRequiredError =
    UserApiKeyRequiredError;

/**
 * Result indicating the analysis cache missed but no job was enqueued because
 * the caller opted out via `skipEnqueueIfMiss`. The consumer is expected to
 * render a fallback in this case.
 */
export interface SubmitFinancialsAnalysisMissNoTrigger {
    status: 'miss_no_trigger';
}

/** Union of all possible outcomes from {@link submitFinancialsAnalysis}. */
export type SubmitFinancialsAnalysisResult =
    | SubmitFinancialsAnalysisCached
    | SubmitFinancialsAnalysisSubmitted
    | SubmitFinancialsAnalysisMissNoTrigger
    | SubmitFinancialsAnalysisLimitError
    | SubmitFinancialsAnalysisFetchError
    | SubmitFinancialsAnalysisApiKeyRequiredError;

// ─────────────────────────────────────────
// Poll
// ─────────────────────────────────────────

/** Outcome of polling financials analysis: still processing, finished, or errored. */
export type PollFinancialsAnalysisResult =
    | { status: 'processing' }
    | { status: 'done'; result: FinancialsAnalysisResponse }
    | { status: 'error'; error: string };
