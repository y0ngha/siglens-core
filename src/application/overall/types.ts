import type { BackgroundTaskOptions } from '@/application/types';
import type { SubmitAnalysisOptions } from '@/application/market/types';
import type { SubmitFundamentalAnalysisOptions } from '@/application/fundamental/types';
import type { SubmitNewsAnalysisOptions } from '@/application/news/types';
import type {
    AnalysisResponse,
    EarningsCalendarItem,
    EnrichedNewsItem,
    FundamentalAnalysisResponse,
    ModelId,
    NewsAnalysisResponse,
    OverallAnalysisResponse,
    Timeframe,
} from '@/domain/types';
import type { FundamentalDataProvider } from '@/infrastructure/fundamental/types';

/** @internal Axis identifier for the three-axis overall analysis pipeline. */
export type OverallAxis = 'technical' | 'fundamental' | 'news';

// ─────────────────────────────────────────
// Dependency resolver input types
// ─────────────────────────────────────────

/**
 * Inputs carried by the overall dependency resolver.
 *
 * The `technical` field forwards the minimal options that `submitAnalysis`
 * requires (bars data is fetched internally by the technical submit function;
 * this field carries caller-controlled options only). The Phase-2 siglens
 * consumer is responsible for constructing this object.
 */
export interface OverallDependencyInputs {
    /** U.S. equity ticker (e.g. `"AAPL"`). */
    symbol: string;
    /** Bar resolution used for the technical analysis axis. */
    timeframe: Timeframe;
    /** LLM model identifier scoped across all three axes. */
    modelId: ModelId;
    /** Fundamental data provider implementation injected by the caller. */
    fundamentalProvider: FundamentalDataProvider;
    /**
     * Enriched news items (already card-analyzed by flash-lite).
     * Typed as `ReadonlyArray<EnrichedNewsItem>` to mirror `SubmitNewsAnalysisOptions.news`.
     */
    news: ReadonlyArray<EnrichedNewsItem>;
    /** Upcoming or recent earnings calendar entries for the symbol. */
    upcomingCalendar: readonly EarningsCalendarItem[];
    /**
     * Options forwarded verbatim to `submitAnalysis` (the technical axis).
     *
     * The resolver does not interpret these options — the Phase-2 siglens
     * consumer supplies them. This avoids coupling the resolver to
     * bars/indicators data it would otherwise need to fetch itself.
     *
     * Pass at minimum `{}` when no overrides are needed; `submitAnalysis`
     * itself uses sensible defaults.
     */
    technical: Pick<
        SubmitAnalysisOptions,
        | 'usage'
        | 'tierContext'
        | 'tierConfig'
        | 'modelId'
        | 'userApiKey'
        | 'waitUntil'
    >;
    /**
     * Options forwarded verbatim to `submitFundamentalAnalysis`.
     * Omit `symbol`, `modelId`, and `dataProvider` — those are derived from the top-level inputs.
     */
    fundamental?: Pick<
        SubmitFundamentalAnalysisOptions,
        'tier' | 'tierConfig' | 'usage' | 'now' | 'waitUntil'
    >;
    /**
     * Options forwarded verbatim to `submitNewsAnalysis`.
     * Omit `symbol`, `modelId`, `news`, and `upcomingCalendar` — those are derived from the top-level inputs.
     */
    newsOptions?: Pick<
        SubmitNewsAnalysisOptions,
        'tier' | 'tierConfig' | 'usage' | 'now' | 'waitUntil'
    >;
}

// ─────────────────────────────────────────
// Dependency resolver output types
// ─────────────────────────────────────────

/** All three dependency axes resolved from cache — overall analysis can be built immediately. */
export interface DependencyStateCached {
    kind: 'cached';
    technical: AnalysisResponse;
    fundamental: FundamentalAnalysisResponse;
    news: NewsAnalysisResponse;
}

/**
 * One or more dependency axes are still being processed.
 *
 * `pendingJobs` maps each axis to its background `jobId`, or `undefined`
 * if that axis resolved from cache and is not pending.
 */
export interface DependencyStatePending {
    kind: 'pending';
    pendingJobs: Record<OverallAxis, string | undefined>;
}

/**
 * One of the dependency axes returned `status: 'error'` from its submit function.
 *
 * `axis` identifies which axis failed; `error` carries the error payload from
 * the respective submit result (string message or structured `AnalysisLimitError`).
 */
export interface DependencyStateError {
    kind: 'error';
    axis: OverallAxis;
    error: unknown;
}

/**
 * Result returned by {@link resolveOverallDependencies}.
 *
 * - `cached` — all three axes resolved from cache; the results are embedded.
 * - `pending` — one or more axes submitted new jobs; caller should poll.
 * - `error` — one axis returned an error (tier gate, usage limit, or fetch failure).
 */
export type DependencyState =
    | DependencyStateCached
    | DependencyStatePending
    | DependencyStateError;

// ─────────────────────────────────────────
// Submit
// ─────────────────────────────────────────

/**
 * Options controlling overall analysis submission behavior.
 *
 * Extends {@link OverallDependencyInputs} with background-task hooks.
 * The caller is responsible for constructing all three dependency-axis options
 * before invoking {@link submitOverallAnalysis}.
 */
export interface SubmitOverallAnalysisOptions
    extends OverallDependencyInputs, BackgroundTaskOptions {}

/** @internal The caller receives a cached overall analysis — no new job was created. */
export interface SubmitOverallAnalysisCached {
    status: 'cached';
    result: OverallAnalysisResponse;
}

/**
 * @internal
 * One or more dependency axes are still processing.
 *
 * The caller should poll each pending axis by its `jobId`, then retry
 * `submitOverallAnalysis` once all three are resolved.
 */
export interface SubmitOverallAnalysisPendingDependencies {
    status: 'pending_dependencies';
    /**
     * Maps each axis to its background `jobId`, or `undefined` if that
     * axis already resolved from cache and is not pending.
     */
    pendingJobs: Record<OverallAxis, string | undefined>;
}

/** @internal A new overall analysis job was submitted; poll with `jobId` for the result. */
export interface SubmitOverallAnalysisSubmitted {
    status: 'submitted';
    jobId: string;
}

/**
 * @internal
 * One of the dependency axes returned an error (tier gate, usage limit, or
 * fetch failure). The overall job is not submitted.
 */
export interface SubmitOverallAnalysisError {
    status: 'error';
    /** Axis that failed: `'technical'`, `'fundamental'`, or `'news'`. */
    axis: OverallAxis;
    /** Error payload from the failing axis submit result. */
    error: unknown;
}

/**
 * Union of all possible outcomes from {@link submitOverallAnalysis}.
 *
 * - `cached` — a fresh analysis exists in the cache; result is embedded.
 * - `pending_dependencies` — one or more axis jobs are still running; retry after polling each.
 * - `submitted` — overall analysis job submitted; poll via {@link pollOverallAnalysis}.
 * - `error` — one of the dependency axes failed; see `axis` and `error` for details.
 */
export type SubmitOverallAnalysisResult =
    | SubmitOverallAnalysisCached
    | SubmitOverallAnalysisPendingDependencies
    | SubmitOverallAnalysisSubmitted
    | SubmitOverallAnalysisError;

// ─────────────────────────────────────────
// Poll
// ─────────────────────────────────────────

/**
 * Outcome of {@link pollOverallAnalysis}: still processing, finished, or errored.
 *
 * - `processing` — the worker has not finished yet; caller should retry.
 * - `done` — the overall analysis is ready; result is embedded.
 * - `error` — the worker reported a failure or the payload could not be normalized.
 */
export type PollOverallAnalysisResult =
    | { status: 'processing' }
    | { status: 'done'; result: OverallAnalysisResponse }
    | { status: 'error'; error: string };
