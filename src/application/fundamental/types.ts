import type { BackgroundTaskOptions } from '@/application/types';
import type { AnalysisLimitError } from '@/application/usage/types';
import type {
    FundamentalAnalysisResponse,
    ModelId,
    Tier,
    TierConfig,
} from '@/domain/types';
import type { FundamentalDataProvider } from '@/infrastructure/fundamental/types';
import type { UsageRepository } from '@/infrastructure/db';

// ─────────────────────────────────────────
// Submit
// ─────────────────────────────────────────

/** @internal Usage tracking options for fundamental analysis submissions. */
export interface FundamentalAnalysisUsageOptions {
    /** Repository used to check today's count and record successful usage. */
    usageRepository: UsageRepository;
    /** Raw client IP. Hashed before persistence. */
    clientIp: string;
}

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
     * analysis limit is checked before fetching data. Omit to skip all limit
     * checks (pre-Phase 4 behavior).
     */
    usage?: FundamentalAnalysisUsageOptions;
    /**
     * Reference timestamp for limit checks. Defaults to `new Date()` at call
     * time. Useful in tests that need a fixed clock.
     */
    now?: Date;
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

/** Union of all possible outcomes from {@link submitFundamentalAnalysis}. */
export type SubmitFundamentalAnalysisResult =
    | SubmitFundamentalAnalysisCached
    | SubmitFundamentalAnalysisSubmitted
    | SubmitFundamentalAnalysisLimitError
    | SubmitFundamentalAnalysisFetchError;

// ─────────────────────────────────────────
// Poll
// ─────────────────────────────────────────

/** Outcome of {@link pollFundamentalAnalysis}: still processing, finished, or errored. */
export type PollFundamentalAnalysisResult =
    | { status: 'processing' }
    | { status: 'done'; result: FundamentalAnalysisResponse }
    | { status: 'error'; error: string };
