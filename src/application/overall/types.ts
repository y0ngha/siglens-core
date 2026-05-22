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
    OptionsAnalysisResponse,
    OptionsSnapshot,
    OverallAnalysisResponse,
    Tier,
    TierConfig,
    Timeframe,
} from '@/domain/types';
import type {
    SubmitOptionsAnalysisLimitError,
    SubmitOptionsAnalysisApiKeyRequiredError,
    SubmitOptionsAnalysisOptions,
} from '@/application/options/types';
import type { FundamentalDataProvider } from '@/domain/ports/fundamentalDataProvider';

/** Axis identifier for the four-axis overall analysis pipeline. */
export type OverallAxis = 'technical' | 'fundamental' | 'news' | 'options';

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
    /** LLM model identifier scoped across all four axes. */
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
     * When `true`, the resolver forwards `skipEnqueueIfMiss: true` to every
     * axis submit call so cache misses on any axis return `'miss_no_trigger'`
     * instead of triggering a worker job. When all sub-axes resolve from
     * cache but the overall cache itself misses, `submitOverallAnalysis`
     * also returns `'miss_no_trigger'` directly instead of enqueueing the
     * overall worker job — see {@link submitOverallAnalysis}. Intended for
     * consumer-side gating of bot/crawler traffic.
     */
    skipEnqueueIfMiss?: boolean;
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

    /**
     * Pre-fetched options snapshot. Caller fetches via OptionsDataProvider
     * (or app-side adapter). Omit (or set undefined) to skip the options axis
     * gracefully — the resolver returns kind: 'options_skipped' and the
     * prompt builder receives a null options context.
     */
    optionsSnapshot?: OptionsSnapshot;

    /**
     * Per-axis options forwarded verbatim to `submitOptionsAnalysis`.
     * Mirrors the technical/fundamental/news per-axis option fields.
     * `expirationDate` is computed by the resolver via pickNearestExpiration —
     * do not set it here.
     */
    options?: Pick<
        SubmitOptionsAnalysisOptions,
        'usage' | 'tier' | 'tierConfig' | 'modelId' | 'userApiKey' | 'waitUntil'
    >;

    /**
     * OI snapshot staleness marker. Forwarded to the prompt as a hint and
     * echoed back on `OverallAnalysisResponse.optionsOiStale` so the UI can
     * show a stale badge. Computed by the caller (app side) using
     * isOpenInterestSnapshotStale + isUsOptionsRegularSession.
     */
    optionsOiStale?: boolean;

    /**
     * Top-level force flag. When true, the resolver forwards `force: true` to
     * every axis submit call. Effective per-axis force is computed as
     * `topLevel.force ?? axis.force ?? false`, but only the `technical` axis
     * has a per-axis `force` field in its Pick (preserved for backward
     * compatibility). For `fundamental`/`news`/`options` the formula collapses
     * to `topLevel.force ?? false`. Used by the re-analyze button in the app,
     * which performs a 4-axis full refresh.
     *
     * Note on `??` semantics: this is undefined-fallthrough, not OR. An
     * explicit `topLevel.force = false` will NOT defer to a per-axis
     * `force = true` — `false` is a real value, not a missing one.
     */
    force?: boolean;
}

// ─────────────────────────────────────────
// Dependency resolver output types
// ─────────────────────────────────────────

/**
 * All four dependency axes resolved — overall analysis can be built immediately.
 *
 * `options` is `null` when the axis was gracefully skipped (the caller omitted
 * `optionsSnapshot` or `submitOptionsAnalysis` returned `no_chains_error`).
 * Non-null payloads carry the full options analysis to feed into the prompt.
 */
export interface DependencyStateCached {
    kind: 'cached';
    technical: AnalysisResponse;
    fundamental: FundamentalAnalysisResponse;
    news: NewsAnalysisResponse;
    options: OptionsAnalysisResponse | null;
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
        | SubmitNewsAnalysisApiKeyRequiredError
        | SubmitOptionsAnalysisLimitError
        | SubmitOptionsAnalysisApiKeyRequiredError;
}

/**
 * Resolver state indicating at least one axis missed cache and the resolver
 * was told (via `skipEnqueueIfMiss`) not to trigger a job. The overall caller
 * should surface a fallback without enqueueing anything itself.
 */
export interface DependencyStateMissNoTrigger {
    kind: 'miss_no_trigger';
}

/**
 * Result returned by {@link resolveOverallDependencies}.
 *
 * - `cached` — all four axes resolved from cache; the results are embedded.
 * - `pending` — one or more axes submitted new jobs; caller should poll.
 * - `error` — one axis returned an error (tier gate, usage limit, or fetch failure).
 * - `miss_no_trigger` — at least one axis missed cache and the resolver was
 *   asked to skip enqueueing (bot/crawler gating).
 */
export type DependencyState =
    | DependencyStateCached
    | DependencyStatePending
    | DependencyStateError
    | DependencyStateMissNoTrigger;

// ─────────────────────────────────────────
// Submit
// ─────────────────────────────────────────

/**
 * Options controlling overall analysis submission behavior.
 *
 * Extends {@link OverallDependencyInputs} with background-task hooks plus an
 * overall-scoped tier/usage gate. The caller is responsible for constructing
 * all four dependency-axis options before invoking {@link submitOverallAnalysis}.
 *
 * Usage tracking is intentionally owned at this layer (not per axis): a
 * single `submitOverallAnalysis` call must count as exactly one analysis,
 * even though it dispatches four axis submits internally. The dependency
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
 * `submitOverallAnalysis` once all four are resolved.
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
    /** Axis that failed: `'technical'`, `'fundamental'`, `'news'`, or `'options'`. */
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
 * Result indicating no overall analysis job was enqueued because the caller
 * opted out via `skipEnqueueIfMiss`. Returned in two cases:
 *
 * 1. At least one sub-axis cache missed — the dependency resolver
 *    short-circuits to `kind: 'miss_no_trigger'` and the overall cache is
 *    never even checked.
 * 2. All four sub-axes resolved from cache, but the overall cache itself
 *    missed — `submitOverallAnalysis` short-circuits after the overall
 *    cache lookup.
 *
 * The consumer is expected to render a fallback in either case (typically
 * used for bot/crawler gating).
 */
export interface SubmitOverallAnalysisMissNoTrigger {
    status: 'miss_no_trigger';
}

/**
 * Union of all possible outcomes from {@link submitOverallAnalysis}.
 *
 * - `cached` — a fresh analysis exists in the cache; result is embedded.
 * - `pending_dependencies` — one or more axis jobs are still running; retry after polling each.
 * - `submitted` — overall analysis job submitted; poll via {@link pollOverallAnalysis}.
 * - `miss_no_trigger` — cache miss but enqueue skipped via `skipEnqueueIfMiss`.
 * - `error` — one of the dependency axes failed; see `axis` and `error` for details.
 * - `key_error` — BYOK API key required for the overall job's own AI call.
 */
export type SubmitOverallAnalysisResult =
    | SubmitOverallAnalysisCached
    | SubmitOverallAnalysisPendingDependencies
    | SubmitOverallAnalysisSubmitted
    | SubmitOverallAnalysisMissNoTrigger
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
