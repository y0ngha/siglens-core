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
import type { AnalysisLocale } from '@/domain/analysis/outputLocale';
import type {
    AnalysisResponse,
    AssembledPromptRecord,
    AssetClass,
    CurrencyCode,
    EarningsCalendarItem,
    EconomicCalendarEvent,
    EnrichedNewsItem,
    FinancialsScorecard,
    FundamentalAnalysisResponse,
    ModelId,
    NewsAnalysisResponse,
    OptionsAnalysisResponse,
    OptionsSnapshot,
    OverallAnalysisResponse,
    PriorAnalysis,
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
import type { MarketDataProvider } from '@/domain/ports/marketDataProvider';

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
    /**
     * Per-request deep-thinking toggle (member-reasoning-toggle spec, Part A),
     * scoped across all four axes AND the overall job's own AI call — mirrors
     * how `modelId` propagates uniformly to every axis submit. Folded into
     * {@link buildOverallCacheKey} (and the peek key) so overall's own ON/OFF
     * results never collide. An axis-level `reasoning` override (set on
     * `technical`/`fundamental`/`news`/`options`) takes precedence over this
     * top-level value for that one axis, same override precedence as
     * `userApiKey`.
     */
    reasoning?: boolean;
    /**
     * Output language for the generated analysis text.
     *
     * Omit it to keep the previous behaviour exactly: Korean output and the
     * same cache key this request used before the field existed.
     */
    locale?: AnalysisLocale;
    /**
     * Prior-analysis-context history for this symbol + timeframe, supplied
     * by the consumer (siglens / siglens-trader) from its own database —
     * mirrors `SubmitAnalysisOptions.priorAnalyses`, but feeds the OVERALL
     * prompt's own `## Prior Analyses` section directly (via
     * `buildOverallAnalysisPrompt`'s `priorAnalyses` param), NOT the
     * technical axis resolved inside this pipeline — that axis reads
     * `technical.priorAnalyses` (see below), and a consumer that wants the
     * technical axis to share a cache entry with its own standalone
     * `runAnalysis` call must supply the same value in both places.
     * Size the query with `analysisHistoryQuery(timeframe, 'overall')`
     * before fetching, including its `generatedBeforeMs` bound (the start of the
     * `OVERALL_CACHE_TTL_SECONDS` window). Both axes take the same lookback;
     * only the excluded recency window differs — leaving the window in the
     * `LIMIT` lets fresh generations evict older rows and change the key on
     * every request.
     *
     * Narrowed twice before reaching the LLM, same two-stage design as the
     * technical axis: once for the cache key (folded into `inputHash` via a
     * `narrowPriorAnalysesForCacheKey` fingerprint, since
     * `buildOverallCacheKey` has no dedicated history parameter), then again
     * bar-anchored for the prompt. Omitting this field (or supplying `[]`)
     * produces a prompt AND a cache key byte-identical to what this call
     * produced before this field existed.
     */
    priorAnalyses?: readonly PriorAnalysis[];
    /**
     * Callback that receives the exact prompt sent to the model for the
     * OVERALL axis, mirroring `SubmitAnalysisOptions.onPromptAssembled`
     * (technical axis) so a consumer can persist prompts from both axes
     * alongside the analyses they produced.
     *
     * Called synchronously exactly ONCE, immediately after the prompt is
     * assembled and before the provider call — and ONLY on a cache miss.
     * Omitting it leaves behavior byte-identical.
     *
     * The callback's own throw is caught and logged by core and never
     * propagates — a consumer's persistence failure must not fail an
     * analysis.
     *
     * **Fires at most once per real generation, not once per caller.** The
     * invocation lives inside the in-flight dedup factory: concurrent callers
     * that miss the same cache key each assemble their own prompt, but only
     * the winner's factory runs and the rest receive the winner's result.
     * Firing per caller would both duplicate the record and hand losers a
     * prompt that was never sent.
     *
     * **A fired record can be orphaned.** It fires immediately before the
     * provider call, so an abort (`signal`) or a provider failure after
     * retries leaves a captured prompt with no corresponding result and no
     * cache entry. Retries themselves do NOT re-fire — the retry wrapper
     * reuses the same assembled strings. A consumer persisting these must
     * therefore tolerate prompt records with no matching analysis row rather
     * than assuming a 1:1 correspondence.
     *
     * **May be async.** A rejected promise is caught and logged, exactly like
     * a synchronous throw. This is spelled out because the naive shape —
     * declaring `=> void` and wrapping the call in `try`/`catch` — silently
     * fails for the realistic case: a throw inside an `async` function never
     * surfaces synchronously, so the `catch` sees nothing and the rejection
     * goes unhandled, which Node terminates the process for by default. The
     * documented use here is persisting the prompt, i.e. an async write.
     *
     * **A concurrent loser's callback is not called at all.** Because the
     * invocation lives inside the dedup factory, when two callers miss the
     * same cache key with DIFFERENT callbacks only the winner's runs — the
     * loser still receives the winner's analysis result, but its own callback
     * never fires and it therefore has no prompt to store for that result.
     * This is the deliberate trade-off against the alternative, which is
     * worse: firing every caller's callback would hand losers a prompt that
     * was never sent, quietly misattributing text to a result it did not
     * produce. Consumers must treat the captured prompt as best-effort and
     * tolerate result rows with no prompt attached.
     */
    onPromptAssembled?: (record: AssembledPromptRecord) => void | Promise<void>;
    /** Fundamental data provider implementation injected by the caller. */
    fundamentalProvider: FundamentalDataProvider;
    /**
     * Market data provider injected by the consumer (siglens app).
     *
     * Must be provided when a cache miss can occur and the daily fear/greed
     * bars will be fetched for the overall prompt.
     * May be omitted only when the overall submission is guaranteed to
     * short-circuit before the fetch site (e.g. `skipEnqueueIfMiss: true` in
     * {@link SubmitOverallAnalysisOptions}).
     */
    marketDataProvider?: MarketDataProvider;
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
     * Scheduled macro-economic releases (FOMC, CPI, etc.), forwarded
     * unchanged to the news axis (`runNewsAnalysis`'s `macroCalendar`
     * option — spec 2026-09-28 §5). Kept top-level (mirroring
     * `upcomingCalendar`) rather than folded into the `news` per-axis
     * options object, so a standalone `runNewsAnalysis` call and this
     * overall call built from the same top-level inputs produce the same
     * news input and therefore the same cache key. Defaults to `[]`,
     * matching `runNewsAnalysis`'s own default.
     */
    macroCalendar?: readonly EconomicCalendarEvent[];
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
     *
     * NOTE on `priorAnalyses`/`marketEvents`: both fold into the technical
     * axis' cache key (`:hist=` / `:evt=` segments — see
     * `buildAnalysisCacheKey`). A consumer that supplies them to its own
     * `runAnalysis` call but NOT here gets two keys for one analysis, and the
     * overall pipeline regenerates a technical analysis it could have read
     * from cache. That is not hypothetical: siglens ran exactly that shape
     * from 2026-09-11 (the day its `analysis_history` table started
     * returning rows, so its standalone key grew a `:hist=` segment this one
     * never had) and paid for a duplicate ~5k-token technical generation per
     * symbol per nightly pre-warm. Supply the same values in both places, or
     * in neither.
     */
    technical: Pick<
        SubmitAnalysisOptions,
        | 'usage'
        | 'tierContext'
        | 'tierConfig'
        | 'modelId'
        | 'userApiKey'
        | 'waitUntil'
        | 'reasoning'
        | 'priorAnalyses'
        | 'marketEvents'
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
        | 'tier'
        | 'tierConfig'
        | 'usage'
        | 'now'
        | 'waitUntil'
        | 'userApiKey'
        | 'reasoning'
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
              | 'reasoning'
          >
        | ReadonlyArray<EnrichedNewsItem>;
    /**
     * @deprecated Use `news` instead. Kept for one minor version for backward
     *   compatibility with the previous field name. Will be removed in a
     *   future minor release.
     */
    newsOptions?: Pick<
        SubmitNewsAnalysisOptions,
        | 'tier'
        | 'tierConfig'
        | 'usage'
        | 'now'
        | 'waitUntil'
        | 'userApiKey'
        | 'reasoning'
    >;

    /**
     * Pre-fetched options snapshot. Caller fetches via OptionsDataProvider
     * (or app-side adapter). Omit (or set undefined) to skip the options axis
     * gracefully — the resolver routes through an internal `no_chains_error`
     * branch and the resulting `DependencyStateCached.options` is set to
     * `null`, so the prompt builder receives a null options context (the
     * "옵션 미상장" hint). `DependencyState` itself has no dedicated
     * `'options_skipped'` variant; the skip is encoded as `kind: 'cached'`
     * with `options: null`.
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
        | 'usage'
        | 'tier'
        | 'tierConfig'
        | 'modelId'
        | 'userApiKey'
        | 'waitUntil'
        | 'reasoning'
    >;

    /**
     * OI snapshot staleness marker. Forwarded to the prompt as a hint and
     * echoed back on `OverallAnalysisResponse.optionsOiStale` so the UI can
     * show a stale badge. Caller-determined: set to `true` when the snapshot
     * was captured outside U.S. options regular trading hours and the
     * open-interest counts are stale (still reflecting the previous session).
     */
    optionsOiStale?: boolean;

    /**
     * Pre-computed financials scorecard. Unlike the four polled dependency axes
     * (technical / fundamental / news / options), the financials axis is computed
     * synchronously and injected directly into the prompt without a polling job.
     * Omit to skip the financials axis in the overall analysis.
     */
    financialsScorecard?: FinancialsScorecard;

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

    /**
     * Instrument asset class. Controls which axes the dependency resolver
     * submits:
     * - `'equity'` (default): all four axes — technical, fundamental, news,
     *   options.
     * - `'crypto'`: technical + news only. The fundamental and options axes
     *   are skipped entirely (not submitted, not surfaced as errors). The
     *   resolved `DependencyStateCached` carries `fundamental: null` /
     *   `options: null` so the prompt builder treats them as intentionally
     *   absent rather than missing data.
     *
     * Also forwarded verbatim to the news axis's `runNewsAnalysis` call
     * (review round 1 finding 9, spec 2026-09-28) — a standalone
     * `runNewsAnalysis` call and this overall call must build the SAME news
     * prompt from the same `assetClass`, since `buildNewsCacheKey` does not
     * fold `assetClass` into the cache key: an overall call that omitted it
     * would write an equity-framed prompt under the exact key a correctly
     * framed crypto `/news` call reads (and vice versa). NOT currently
     * forwarded to the technical/fundamental/options axes — none of their
     * per-axis `Pick`s carry `assetClass`, so extending this to them is a
     * separate, wider change if their prompts ever need the same guarantee.
     *
     * Optional for backward compatibility — omit to keep equity behavior.
     */
    assetClass?: AssetClass;

    /**
     * Listing quote currency, supplied from the caller's market profile (core
     * never derives it from the symbol — see {@link CurrencyCode}). Forwarded
     * to the technical, fundamental, and news axes and used by the overall
     * prompt's framing and level precision.
     * Defaults to `'USD'`.
     */
    currency?: CurrencyCode;
}

// ─────────────────────────────────────────
// Dependency resolver output types
// ─────────────────────────────────────────

/**
 * @internal
 * All four dependency axes resolved — overall analysis can be built immediately.
 *
 * `options` is `null` when the axis was gracefully skipped (the caller omitted
 * `optionsSnapshot` or `submitOptionsAnalysis` returned `no_chains_error`).
 * Non-null payloads carry the full options analysis to feed into the prompt.
 *
 * `fundamental` is `null` when the asset class is `'crypto'` — the fundamental
 * axis is intentionally not submitted for crypto instruments (no FMP company
 * profile exists). The prompt builder treats `null` as "no fundamentals"
 * rather than a missing-data error, matching the same null-means-skipped
 * convention already used by the options axis.
 */
export interface DependencyStateCached {
    kind: 'cached';
    technical: AnalysisResponse;
    /**
     * `null` when the fundamental axis was gracefully skipped (e.g. for
     * `assetClass: 'crypto'`). Non-null for equity instruments.
     */
    fundamental: FundamentalAnalysisResponse | null;
    news: NewsAnalysisResponse;
    /**
     * Options axis result. `null` indicates a graceful skip (NoChains symbol
     * or absent snapshot). Optional so existing consumers that constructed
     * `DependencyStateCached` without options before this PR (e.g. test mocks
     * from prior versions) still type-check; the resolver always sets it.
     */
    options?: OptionsAnalysisResponse | null;
}

/**
 * @internal
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
 * @internal
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
 * @internal
 * Resolver state indicating at least one axis missed cache and the resolver
 * was told (via `skipEnqueueIfMiss`) not to trigger a job. The overall caller
 * should surface a fallback without enqueueing anything itself.
 */
export interface DependencyStateMissNoTrigger {
    kind: 'miss_no_trigger';
}

/**
 * @internal
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
// Crypto-skip sentinel types
// ─────────────────────────────────────────

/**
 * @internal
 * Sentinel returned by the dependency resolver when the fundamental axis is
 * gracefully skipped for a crypto instrument. Mirrors the options-axis
 * `no_chains_error` skip pattern — the resolver produces this value instead
 * of calling `submitFundamentalAnalysis`, so no provider error can propagate.
 *
 * `status` and `code` share the same literal so consumers can narrow on either
 * field without ambiguity.
 */
export interface FundamentalCryptoSkip {
    status: 'no_fundamental_crypto';
    code: 'no_fundamental_crypto';
    error: string;
}

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
    // NOTE: `assetClass` is inherited from `OverallDependencyInputs`, which
    // controls both the dependency resolver (which axes to submit) and the
    // prompt builder framing. See `OverallDependencyInputs.assetClass`.
}

/**
 * The caller receives a cached overall analysis — no new job was created.
 */
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

/**
 * A new overall analysis job was submitted; poll with `jobId` for the result.
 */
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

/**
 * Result variant when BYOK API key is required for the overall job's own AI call.
 */
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
// Run (direct, non-queued)
// ─────────────────────────────────────────

/**
 * Options for a `runOverallAnalysis` call — the direct (non-queued) successor
 * to the `submitOverallAnalysis` + `pollOverallAnalysis` pair.
 *
 * Extends {@link SubmitOverallAnalysisOptions} with a cancellation signal so a
 * dropped connection aborts the entire dependency tree (technical, fundamental,
 * news, options) AND the overall LLM call in one shot. The signal is threaded
 * through to every axis's `run*` function and to `callAnalysisAi`.
 */
export interface RunOverallAnalysisOptions extends SubmitOverallAnalysisOptions {
    /**
     * Cancellation signal. When the client disconnects, all four dependency
     * `run*` calls and the overall `callAnalysisAi` call are aborted via
     * the same signal, so no in-flight LLM call leaks after the request ends.
     */
    signal?: AbortSignal;
    /**
     * Retry a failed server-key DeepSeek generation once on the fallback Gemini
     * model (see `callAnalysisAi`). Default off — set only by callers where the
     * user could not choose the model (SEO prewarm, the ai.siglens.io agent);
     * a user-selected model must fail visibly instead.
     */
    providerFallback?: boolean;
}

/**
 * Overall analysis completed successfully — result is the normalized response.
 */
export interface RunOverallAnalysisDone {
    status: 'done';
    result: OverallAnalysisResponse;
}

/**
 * Union of all possible outcomes from {@link runOverallAnalysis}.
 *
 * - `cached` — a recent overall analysis exists in the cache; result embedded.
 * - `done` — all four dependency axes resolved and the overall LLM completed;
 *   result embedded. Unlike the queued path, `pending_dependencies` and
 *   `submitted` can never occur — the dependencies are awaited server-side.
 * - `miss_no_trigger` — `skipEnqueueIfMiss` was set and at least one axis
 *   (or the overall cache) missed.
 * - `error` — a dependency axis or the overall gate returned an error.
 * - `limit_error` — the overall-scoped daily limit was exceeded.
 * - `key_error` — BYOK API key required for the requested model.
 *
 * LLM-level failures (provider errors, network, AbortError) propagate as
 * thrown exceptions so the SSE handler can map them to appropriate HTTP responses.
 */
export type RunOverallAnalysisResult =
    | SubmitOverallAnalysisCached
    | RunOverallAnalysisDone
    | SubmitOverallAnalysisMissNoTrigger
    | SubmitOverallAnalysisError
    | SubmitOverallAnalysisLimitError
    | SubmitOverallAnalysisApiKeyRequiredError;

// ─────────────────────────────────────────
// Poll
// ─────────────────────────────────────────

/**
 * Options controlling a public overall-analysis poll response.
 *
 * Mirrors {@link PollAnalysisOptions} (`@/application/market/types`): the
 * resolved caller tier is intentionally supplied at poll time so a job can
 * outlive a tier change, and its submit-time tier must never determine what
 * a later caller can read.
 */
export interface PollOverallAnalysisOptions extends BackgroundTaskOptions {
    /** Resolved tier of the caller receiving this poll response. */
    tier?: Tier;
    /** Tier policy used to gate this poll response's timeframe. */
    tierConfig?: TierConfig;
}

/**
 * Outcome of {@link pollOverallAnalysis}: still processing, finished, or errored.
 *
 * - `processing` — the worker has not finished yet; caller should retry.
 * - `done` — the overall analysis is ready; result is embedded.
 * - `error`: the worker reported a failure, the payload could not be
 *   normalized, or the caller tier is not allowed to access the job's
 *   timeframe (parity with {@link pollAnalysis}'s caller-tier timeframe gate).
 */
export type PollOverallAnalysisResult =
    | { status: 'processing' }
    | { status: 'done'; result: OverallAnalysisResponse }
    | { status: 'error'; error: string };
