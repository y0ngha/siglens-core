import type { BackgroundTaskOptions } from '@/application/types';
import type { UserApiKeyRequiredError } from '@/application/byok/types';
import type {
    SubmitAnalysisOptions,
    SubmitAnalysisErrorResult,
} from '@/application/market/types';
import type {
    SubmitFundamentalAnalysisOptions,
    SubmitFundamentalAnalysisLimitError,
    SubmitFundamentalAnalysisFetchError,
    SubmitFundamentalAnalysisApiKeyRequiredError,
} from '@/application/fundamental/types';
import type {
    SubmitNewsAnalysisOptions,
    SubmitNewsAnalysisNoNewsError,
    SubmitNewsAnalysisLimitError,
    SubmitNewsAnalysisApiKeyRequiredError,
} from '@/application/news/types';
import type {
    AnalysisLimitError,
    AnalysisUsageOptions,
} from '@/application/usage/types';
import type {
    AnalysisResponse,
    EarningsCalendarItem,
    EnrichedNewsItem,
    FundamentalAnalysisResponse,
    ModelId,
    NewsAnalysisResponse,
    OverallAnalysisResponse,
    Tier,
    TierConfig,
    Timeframe,
} from '@/domain/types';
import type { FundamentalDataProvider } from '@/infrastructure/fundamental/types';

/** Axis identifier for the three-axis overall analysis pipeline. */
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
    /** Company display name used by the technical-analysis prompt. Defaults to `symbol`. */
    companyName?: string;
    /** Bar resolution used for the technical analysis axis. */
    timeframe: Timeframe;
    /** LLM model identifier scoped across all three axes. */
    modelId: ModelId;
    /** Fundamental data provider implementation injected by the caller. */
    fundamentalProvider: FundamentalDataProvider;
    /**
     * Resolved subscription tier. Optional for backward compatibility with
     * direct test callers; submitOverallAnalysis defaults to DEFAULT_TIER
     * when omitted.
     */
    tier?: Tier;
    /**
     * BYOK API key (top-level scope). Provided once at the overall level;
     * the dependency resolver propagates it to each axis option
     * (axis-level values take precedence if already set).
     */
    userApiKey?: string;
    /**
     * Enriched news items (already card-analyzed by flash-lite).
     *
     * Renamed from `news` to disambiguate from the per-axis options field
     * (`news`, see below). Typed as `ReadonlyArray<EnrichedNewsItem>` to
     * mirror `SubmitNewsAnalysisOptions.news`.
     *
     * Optional purely for backward compatibility — callers must supply
     * either `newsItems` (preferred) or the `@deprecated` `news` array alias.
     */
    newsItems?: ReadonlyArray<EnrichedNewsItem>;
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
     * itself uses sensible defaults. `force` and `fmpSymbol` are forwarded
     * to `submitAnalysis`'s positional parameters of the same name.
     *
     * NOTE on `usage`: any `usage` set here is **dropped** by the resolver
     * when the resolver is called from {@link submitOverallAnalysis} — usage
     * tracking is owned at the overall layer to prevent triple-counting one
     * overall call as three analyses. The field stays in the type for
     * standalone resolver callers, but `submitOverallAnalysis` users should
     * leave it unset.
     */
    technical: Pick<
        SubmitAnalysisOptions,
        | 'usage'
        | 'tierContext'
        | 'tierConfig'
        | 'modelId'
        | 'userApiKey'
        | 'waitUntil'
    > & {
        /** Forwarded to `submitAnalysis(... , force, ...)`. Defaults to `false`. */
        force?: boolean;
        /** Forwarded to `submitAnalysis(... , fmpSymbol, ...)`. */
        fmpSymbol?: string;
    };
    /**
     * Options forwarded verbatim to `submitFundamentalAnalysis`.
     * Omit `symbol`, `modelId`, and `dataProvider` — those are derived from the top-level inputs.
     *
     * Same `usage`-drop rule applies as for `technical` — see above.
     */
    fundamental?: Pick<
        SubmitFundamentalAnalysisOptions,
        'tier' | 'tierConfig' | 'usage' | 'now' | 'waitUntil' | 'userApiKey'
    >;
    /**
     * Options forwarded verbatim to `submitNewsAnalysis`.
     * Omit `symbol`, `modelId`, `news`, and `upcomingCalendar` — those are derived from the top-level inputs.
     *
     * Renamed from `newsOptions` for naming parity with `fundamental` and `technical`.
     *
     * Same `usage`-drop rule applies as for `technical` — see above.
     *
     * Backward-compat: this field also accepts `ReadonlyArray<EnrichedNewsItem>`,
     * the legacy shape of the `news` *data* field (renamed to `newsItems`).
     * The resolver disambiguates at runtime by checking `Array.isArray(news)`:
     * - array → treated as enriched news items (legacy data alias)
     * - object → treated as the new per-axis options
     * Prefer the new fields (`newsItems` for data, `news` for options).
     */
    news?:
        | Pick<
              SubmitNewsAnalysisOptions,
              | 'tier'
              | 'tierConfig'
              | 'usage'
              | 'now'
              | 'waitUntil'
              | 'userApiKey'
          >
        | ReadonlyArray<EnrichedNewsItem>;
    /**
     * @deprecated Use `news` instead. Kept for one minor version for backward
     *   compatibility with the previous field name. Will be removed in a
     *   future minor release.
     */
    newsOptions?: Pick<
        SubmitNewsAnalysisOptions,
        'tier' | 'tierConfig' | 'usage' | 'now' | 'waitUntil' | 'userApiKey'
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
 * One of the dependency axes returned `status: 'error'` or `status: 'key_error'`
 * from its submit function.
 *
 * `axis` identifies which axis failed; `error` carries the full submit result
 * object from the failing axis so consumers can narrow on `error.status` without
 * runtime `typeof` / `'status' in` guards.
 */
export interface DependencyStateError {
    kind: 'error';
    axis: OverallAxis;
    /**
     * Full submit result object from the failing axis.
     *
     * Carries the original status discriminant (`'error'` or `'key_error'`),
     * so consumers (notably `submitOverallAnalysis`) can re-surface BYOK
     * errors with full type narrowing.
     */
    error:
        | SubmitAnalysisErrorResult
        | SubmitFundamentalAnalysisLimitError
        | SubmitFundamentalAnalysisFetchError
        | SubmitFundamentalAnalysisApiKeyRequiredError
        | SubmitNewsAnalysisNoNewsError
        | SubmitNewsAnalysisLimitError
        | SubmitNewsAnalysisApiKeyRequiredError;
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
 * Extends {@link OverallDependencyInputs} with background-task hooks plus an
 * overall-scoped tier/usage gate. The caller is responsible for constructing
 * all three dependency-axis options before invoking {@link submitOverallAnalysis}.
 *
 * Usage tracking is intentionally owned at this layer (not per axis): a
 * single `submitOverallAnalysis` call must count as exactly one analysis,
 * even though it dispatches three axis submits internally. The dependency
 * resolver therefore drops any `usage` provided in `technical`/`fundamental`/
 * `news` axis options when called from overall — see
 * {@link resolveOverallDependencies}.
 */
export interface SubmitOverallAnalysisOptions
    extends OverallDependencyInputs, BackgroundTaskOptions {
    /** Tier configuration override, mainly for tests and controlled rollouts. */
    tierConfig?: TierConfig;
    /**
     * Optional usage tracking. When provided together with `tier`, the daily
     * analysis limit is checked once before any axis submit, and one usage
     * record is written on every path that returns a result (overall cache
     * hit or successful overall submit). Pending-dependency and axis-error
     * paths do not record.
     */
    usage?: AnalysisUsageOptions;
    /**
     * Reference timestamp for the overall-scoped limit check and usage record.
     * Defaults to `usage?.occurredAt ?? new Date()`.
     */
    now?: Date;
}

/** The caller receives a cached overall analysis — no new job was created. */
export interface SubmitOverallAnalysisCached {
    status: 'cached';
    result: OverallAnalysisResponse;
}

/**
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

/** A new overall analysis job was submitted; poll with `jobId` for the result. */
export interface SubmitOverallAnalysisSubmitted {
    status: 'submitted';
    jobId: string;
}

/**
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
 * Daily analysis limit was exceeded by the overall-scoped usage check.
 * No axis submit was dispatched.
 *
 * Uses its own `status: 'limit_error'` discriminant (not `'error'`) so a
 * consumer narrowing on `result.status === 'error'` keeps the existing
 * `SubmitOverallAnalysisError` shape (with `axis` field) unaffected.
 */
export interface SubmitOverallAnalysisLimitError {
    status: 'limit_error';
    /** Machine-readable error code shared with per-axis usage limit errors. */
    code: 'usage_limit_exceeded';
    /** Structured limit error including the resolved tier. */
    error: AnalysisLimitError;
}

/** Result variant when BYOK API key is required for the overall job's own AI call. */
export type SubmitOverallAnalysisApiKeyRequiredError = UserApiKeyRequiredError;

/**
 * Union of all possible outcomes from {@link submitOverallAnalysis}.
 *
 * - `cached` — a fresh analysis exists in the cache; result is embedded.
 * - `pending_dependencies` — one or more axis jobs are still running; retry after polling each.
 * - `submitted` — overall analysis job submitted; poll via {@link pollOverallAnalysis}.
 * - `error` — one of the dependency axes failed; see `axis` and `error` for details.
 * - `key_error` — BYOK API key required for the overall job's own AI call.
 */
export type SubmitOverallAnalysisResult =
    | SubmitOverallAnalysisCached
    | SubmitOverallAnalysisPendingDependencies
    | SubmitOverallAnalysisSubmitted
    | SubmitOverallAnalysisError
    | SubmitOverallAnalysisLimitError
    | SubmitOverallAnalysisApiKeyRequiredError;

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
