import type { BackgroundTaskOptions } from '@/application/types';
import type { UserApiKeyRequiredError } from '@/application/byok/types';
import type {
    AnalysisLimitError,
    AnalysisUsageOptions,
} from '@/application/usage/types';
import type {
    ModelId,
    OptionsAnalysisResponse,
    OptionsSnapshot,
    Tier,
    TierConfig,
} from '@/domain/types';

// ─────────────────────────────────────────
// Submit Options Analysis
// ─────────────────────────────────────────

/** Options controlling options analysis submission behavior. */
export interface SubmitOptionsAnalysisOptions extends BackgroundTaskOptions {
    /** U.S. equity ticker (e.g. `"AAPL"`). */
    symbol: string;
    /** Company display name for the prompt. Defaults to `symbol` when omitted. */
    companyName?: string;
    /**
     * Target expiration. `"YYYY-MM-DD"` selects a single expiration; `"all"`
     * aggregates every expiration in the snapshot (per-chain summaries only,
     * never the full chain, to keep prompt tokens bounded).
     */
    expirationDate: string | 'all';
    /** LLM model identifier used for the analysis and cache scoping. */
    modelId: ModelId;
    /**
     * Caller pre-fetches the options snapshot through the {@link OptionsDataProvider}
     * interface and passes it in. This keeps the use-case decoupled from the
     * concrete provider implementation.
     */
    snapshot: OptionsSnapshot;
    /**
     * Resolved subscription tier. Must be provided when `usage` is also
     * given (enforces the daily analysis limit) or when a premium model is
     * requested (BYOK requirement). Defaults to {@link DEFAULT_TIER}
     * (`'free'`) when omitted.
     */
    tier?: Tier;
    /** Tier configuration override, mainly for tests and controlled rollouts. */
    tierConfig?: TierConfig;
    /**
     * Optional usage tracking. When provided together with `tier`, the daily
     * analysis limit is checked before submission, and one usage record is
     * written on every path that returns a result.
     */
    usage?: AnalysisUsageOptions;
    /** Reference timestamp for limit checks. Defaults to `new Date()`. */
    now?: Date;
    /** BYOK API key. Must be provided when a non-pro tier requests a premium model. */
    userApiKey?: string;
    /**
     * When `true`, skip enqueueing on cache miss and return `miss_no_trigger`.
     * Used to gate bot/crawler traffic.
     */
    skipEnqueueIfMiss?: boolean;
}

/** The caller receives a cached analysis — no new job was created. */
export interface SubmitOptionsAnalysisCached {
    status: 'cached';
    result: OptionsAnalysisResponse;
}

/** A new analysis job was submitted; poll with `jobId` for the result. */
export interface SubmitOptionsAnalysisSubmitted {
    status: 'submitted';
    jobId: string;
}

/** The analysis cache missed but no job was enqueued (`skipEnqueueIfMiss`). */
export interface SubmitOptionsAnalysisMissNoTrigger {
    status: 'miss_no_trigger';
}

/**
 * Result variant when the daily analysis limit is exceeded.
 *
 * The `status` is `'limit_error'` (not `'error'`) so callers can
 * exhaustively narrow the union via `switch (result.status)` without
 * needing to inspect the `code` field.
 */
export interface SubmitOptionsAnalysisLimitError {
    status: 'limit_error';
    code: 'usage_limit_exceeded';
    error: AnalysisLimitError;
}

/**
 * Result variant when the underlying snapshot has no chains to analyze.
 *
 * The `status` is `'no_chains_error'` (not `'error'`) so callers can
 * exhaustively narrow the union via `switch (result.status)` without
 * needing to inspect the `code` field.
 */
export interface SubmitOptionsAnalysisNoChainsError {
    status: 'no_chains_error';
    code: 'no_options_chains';
    error: string;
}

/** Result variant when a user BYOK API key is required for the requested model+tier combo. */
export type SubmitOptionsAnalysisApiKeyRequiredError = UserApiKeyRequiredError;

/** Union of all possible outcomes from `submitOptionsAnalysis`. */
export type SubmitOptionsAnalysisResult =
    | SubmitOptionsAnalysisCached
    | SubmitOptionsAnalysisSubmitted
    | SubmitOptionsAnalysisMissNoTrigger
    | SubmitOptionsAnalysisNoChainsError
    | SubmitOptionsAnalysisLimitError
    | SubmitOptionsAnalysisApiKeyRequiredError;

// ─────────────────────────────────────────
// Poll Options Analysis
// ─────────────────────────────────────────

/** Outcome of `pollOptionsAnalysis`: still processing, finished, or errored. */
export type PollOptionsAnalysisResult =
    | { status: 'processing' }
    | { status: 'done'; result: OptionsAnalysisResponse }
    | { status: 'error'; error: string };
