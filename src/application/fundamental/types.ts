import type { BackgroundTaskOptions } from '@/application/types';
import type { UserApiKeyRequiredError } from '@/application/byok/types';
import type {
    AnalysisLimitError,
    AnalysisUsageOptions,
} from '@/application/usage/types';
import type {
    FundamentalAnalysisResponse,
    ModelId,
    Tier,
    TierConfig,
} from '@/domain/types';
import type { FundamentalDataProvider } from '@/infrastructure/fundamental/types';

// ─────────────────────────────────────────
// Submit
// ─────────────────────────────────────────

/**
 * @deprecated Use {@link AnalysisUsageOptions} instead. Kept as an alias for
 *   one minor version so existing callers keep compiling. Will be removed in
 *   a future minor release.
 *
 * The unified {@link AnalysisUsageOptions} adds optional `userId`,
 * `modelUsed`, and `occurredAt` fields needed by `recordUsage` on cache-hit
 * and post-submit paths.
 */
export type FundamentalAnalysisUsageOptions = AnalysisUsageOptions;

/** Options controlling fundamental analysis submission behavior. */
export interface SubmitFundamentalAnalysisOptions extends BackgroundTaskOptions {
    /** U.S. equity ticker (e.g. `"AAPL"`). */
    symbol: string;
    /** LLM model identifier used for the analysis and cache scoping. */
    modelId: ModelId;
    /**
     * Fundamental data provider implementation (injected by the caller).
     * Core depends only on the interface — never on a concrete HTTP client.
     */
    dataProvider: FundamentalDataProvider;
    /**
     * Resolved subscription tier. Required only when `usage` is also provided;
     * omit before Phase 4 (siglens passes neither).
     */
    tier?: Tier;
    /** Tier configuration override, mainly for tests and controlled rollouts. */
    tierConfig?: TierConfig;
    /**
     * Optional usage tracking. When provided together with `tier`, the daily
     * analysis limit is checked before fetching data, and one usage record is
     * written on every path that returns a result (cache hit or successful
     * submit). Omit to skip both checks and recording (pre-Phase 4 behavior).
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
}

/** The caller receives a cached analysis — no new job was created. */
export interface SubmitFundamentalAnalysisCached {
    status: 'cached';
    result: FundamentalAnalysisResponse;
}

/** A new analysis job was submitted; poll with `jobId` for the result. */
export interface SubmitFundamentalAnalysisSubmitted {
    status: 'submitted';
    jobId: string;
}

/** Result variant when the daily analysis limit is exceeded. */
export interface SubmitFundamentalAnalysisLimitError {
    status: 'error';
    code: 'usage_limit_exceeded';
    error: AnalysisLimitError;
}

/** Result variant when the provider fetch or data normalization fails. */
export interface SubmitFundamentalAnalysisFetchError {
    status: 'error';
    code: 'fetch_failed';
    error?: string;
}

/** Result variant when a user BYOK API key is required for the requested model+tier combo. */
export type SubmitFundamentalAnalysisApiKeyRequiredError = UserApiKeyRequiredError;

/** Union of all possible outcomes from {@link submitFundamentalAnalysis}. */
export type SubmitFundamentalAnalysisResult =
    | SubmitFundamentalAnalysisCached
    | SubmitFundamentalAnalysisSubmitted
    | SubmitFundamentalAnalysisLimitError
    | SubmitFundamentalAnalysisFetchError
    | SubmitFundamentalAnalysisApiKeyRequiredError;

// ─────────────────────────────────────────
// Poll
// ─────────────────────────────────────────

/** Outcome of {@link pollFundamentalAnalysis}: still processing, finished, or errored. */
export type PollFundamentalAnalysisResult =
    | { status: 'processing' }
    | { status: 'done'; result: FundamentalAnalysisResponse }
    | { status: 'error'; error: string };
