import type { BackgroundTaskOptions } from '@/application/types';
import type { AnalysisLimitError } from '@/application/usage/types';
import type {
    EarningsCalendarItem,
    EnrichedNewsItem,
    NewsAnalysisResponse,
    NewsCardAnalysis,
    ModelId,
    NewsItem,
    Tier,
    TierConfig,
} from '@/domain/types';
import type { UsageRepository } from '@/infrastructure/db';

// ─────────────────────────────────────────
// Submit News Analysis
// ─────────────────────────────────────────

/** @internal Usage tracking options for news analysis submissions. */
export interface NewsAnalysisUsageOptions {
    /** Repository used to check today's count and record successful usage. */
    usageRepository: UsageRepository;
    /** Raw client IP. Hashed before persistence. */
    clientIp: string;
}

/** Options controlling news analysis submission behavior. */
export interface SubmitNewsAnalysisOptions extends BackgroundTaskOptions {
    /** U.S. equity ticker (e.g. `"AAPL"`). */
    symbol: string;
    /** LLM model identifier used for the analysis and cache scoping. */
    modelId: ModelId;
    /**
     * Enriched news items (already analyzed per-card by flash-lite).
     * If empty, submission returns `{ status: 'error', code: 'no_news' }`.
     */
    news: ReadonlyArray<EnrichedNewsItem>;
    /** Upcoming or recent earnings calendar entries for the symbol. */
    upcomingCalendar: readonly EarningsCalendarItem[];
    /**
     * Resolved subscription tier. Required only when `usage` is also provided;
     * omit before Phase 4 (siglens passes neither).
     */
    tier?: Tier;
    /** Tier configuration override, mainly for tests and controlled rollouts. */
    tierConfig?: TierConfig;
    /**
     * Optional usage tracking. When provided together with `tier`, the daily
     * analysis limit is checked before submission. Omit to skip all limit checks.
     */
    usage?: NewsAnalysisUsageOptions;
    /**
     * Reference timestamp for limit checks. Defaults to `new Date()` at call
     * time. Useful in tests that need a fixed clock.
     */
    now?: Date;
}

/** @internal The caller receives a cached analysis — no new job was created. */
export interface SubmitNewsAnalysisCached {
    status: 'cached';
    result: NewsAnalysisResponse;
}

/** @internal A new analysis job was submitted; poll with `jobId` for the result. */
export interface SubmitNewsAnalysisSubmitted {
    status: 'submitted';
    jobId: string;
}

/** @internal Result variant when no news items were provided to analyze. */
export interface SubmitNewsAnalysisNoNewsError {
    status: 'error';
    code: 'no_news';
    error: string;
}

/** @internal Result variant when the daily analysis limit is exceeded. */
export interface SubmitNewsAnalysisLimitError {
    status: 'error';
    code: 'usage_limit_exceeded';
    error: AnalysisLimitError;
}

/** Union of all possible outcomes from {@link submitNewsAnalysis}. */
export type SubmitNewsAnalysisResult =
    | SubmitNewsAnalysisCached
    | SubmitNewsAnalysisSubmitted
    | SubmitNewsAnalysisNoNewsError
    | SubmitNewsAnalysisLimitError;

// ─────────────────────────────────────────
// Poll News Analysis
// ─────────────────────────────────────────

/** Outcome of {@link pollNewsAnalysis}: still processing, finished, or errored. */
export type PollNewsAnalysisResult =
    | { status: 'processing' }
    | { status: 'done'; result: NewsAnalysisResponse }
    | { status: 'error'; error: string };

// ─────────────────────────────────────────
// Submit News Card Analysis
// ─────────────────────────────────────────

/** @internal Options controlling per-card news analysis submission behavior. */
export interface SubmitNewsCardAnalysisOptions extends BackgroundTaskOptions {
    /** The raw news item to analyze. */
    item: NewsItem;
}

/** @internal The caller receives a cached card analysis — no new job was created. */
export interface SubmitNewsCardAnalysisCached {
    status: 'cached';
    result: NewsCardAnalysis;
}

/** @internal A new card analysis job was submitted; poll with `jobId` for the result. */
export interface SubmitNewsCardAnalysisSubmitted {
    status: 'submitted';
    jobId: string;
}

/** Union of all possible outcomes from {@link submitNewsCardAnalysis}. */
export type SubmitNewsCardAnalysisResult =
    | SubmitNewsCardAnalysisCached
    | SubmitNewsCardAnalysisSubmitted;

// ─────────────────────────────────────────
// Poll News Card Analysis
// ─────────────────────────────────────────

/** @internal Outcome of {@link pollNewsCardAnalysis}: still processing, finished, or errored. */
export type PollNewsCardAnalysisResult =
    | { status: 'processing' }
    | { status: 'done'; result: NewsCardAnalysis }
    | { status: 'error'; error: string };
