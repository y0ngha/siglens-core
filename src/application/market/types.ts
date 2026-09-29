import type { BackgroundTaskOptions } from '@/application/types';
import type { UserApiKeyRequiredError } from '@/application/byok/types';
import type {
    AnalysisLimitError,
    AnalysisUsageOptions,
} from '@/application/usage/types';
import type { AnalysisLocale } from '@/domain/analysis/outputLocale';
import { getAllowedTimeframes } from '@/domain/tier';
import type {
    AnalysisResponse,
    AssembledPromptRecord,
    AssetClass,
    CurrencyCode,
    FilteredAnalysisResponse,
    MarketBriefingResponse,
    MarketEvent,
    ModelId,
    PositionBucket,
    PriorAnalysis,
    Tier,
    TierConfig,
    TierInfoDepth,
    Timeframe,
    UserTierContext,
} from '@/domain/types';
import type { MarketDataProvider } from '@/domain/ports/marketDataProvider';

export type { UserApiKeyRequiredError };

/**
 * Usage tracking and daily limit options for analysis submissions.
 *
 * Re-exported from `@/application/usage/types` so existing public imports
 * (`@y0ngha/siglens-core` → `AnalysisUsageOptions`) keep working. The same
 * type is shared by every analysis use-case (technical, fundamental, news,
 * overall) — see the canonical definition in `usage/types.ts`.
 */
export type { AnalysisUsageOptions };

/**
 * Options controlling analysis submission behavior.
 */
export interface SubmitAnalysisOptions extends BackgroundTaskOptions {
    /**
     * Market data provider injected by the consumer (siglens app).
     *
     * Must be provided when a cache miss can occur and bars will be fetched.
     * May be omitted when `skipEnqueueIfMiss: true` — that path short-circuits
     * before the fetch site.
     */
    marketDataProvider?: MarketDataProvider;
    /** Optional usage tracking. Omitted callers keep the previous behavior. */
    usage?: AnalysisUsageOptions;
    /** Request-scoped tier context used to enforce timeframe access. */
    tierContext?: UserTierContext;
    /** Tier configuration override, mainly for tests and controlled rollouts. */
    tierConfig?: TierConfig;
    /** LLM model identifier used to isolate cached results per model and for worker routing. */
    modelId?: ModelId;
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
     * Instrument asset class. Controls prompt framing: `'crypto'` drops
     * equity-specific language (earnings, fundamentals, analyst ratings) and
     * adds 24/7 context. Defaults to `'equity'` for backward compatibility.
     */
    assetClass?: AssetClass;
    /**
     * Currency used to render prices in the generated analysis text.
     *
     * Supplied by the caller, which owns the exchange→currency catalog; core
     * never infers it from the symbol (see {@link CurrencyCode}). It sets the
     * prompt's listing framing and price precision (`KRW` → a Korean listing
     * quoted in whole won), its pivot session calendar, and the stop-loss and
     * take-profit figures in `reconciledLevels.exit`. Omitted callers get
     * `'USD'`.
     *
     * ⚠️ Deliberately NOT part of the analysis cache key. Currency is a fixed
     * property of a symbol, so two requests for the same symbol cannot
     * disagree on it, and folding it into the key would change the key shape
     * every consumer peeks with for no benefit. That makes it a caller
     * contract: always pass the same currency for a given symbol. A caller
     * that varied it would have one symbol's framing, precision and pivot
     * calendar served from whichever request wrote the entry first.
     */
    currency?: CurrencyCode;
    /**
     * Per-request deep-thinking toggle (member-reasoning-toggle spec, Part A).
     * `true` requests the model's default/spec reasoning depth; `false` or
     * omitted requests the provider-minimized (worker-side) setting — the
     * pre-toggle default. Folded into the cache key so ON and OFF results
     * never collide (see {@link buildAnalysisCacheKey}); forwarded to the
     * worker `/analyze` body only when `true`. Tier enforcement (free tier
     * must not receive `true`) is the caller's responsibility — core forwards
     * whatever value it is given.
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
     * Member position-bucket hint
     * (personalized-analysis-by-position-bucket spec, Subsystem C). A
     * FINISHED bucket enum — never the raw average price or quantity —
     * derived by the caller from a server-read holding. Folded into the
     * cache key (see {@link buildAnalysisCacheKey}'s `positionBucket` param)
     * AFTER the reasoning suffix, and injected as a neutral Korean hint into
     * the prompt's `dynamic` section (see `buildAnalysisPrompt`'s
     * `positionBucket` param) — never into `stable`, and never joined into
     * the skill-sampling seed (the bucket must not change which skills are
     * sampled). `undefined` (no holding, free tier, or an unbucketable
     * position) produces the exact same cache key and prompt as omitting the
     * option entirely (backward compatible). Tier/holding gating (free tier
     * must never receive a bucket) is the caller's responsibility — core
     * forwards whatever value it is given.
     */
    positionBucket?: PositionBucket;
    /**
     * Prior-analysis-context history for this symbol + timeframe, supplied
     * by the consumer (siglens / siglens-trader) from its own database —
     * core has no storage of its own for past analyses. Size the query with
     * {@link analysisHistoryQuery} before fetching, **including** its
     * `generatedBeforeMs` bound (`generated_at < generatedBeforeMs`) —
     * without it, fresh generations push older rows out of the `LIMIT` and the
     * cache key changes on every request.
     *
     * Core narrows this list TWICE before any of it reaches the LLM: once
     * for the cache key (drops entries generated inside the CURRENT cache
     * window, so one user's freshly-finished analysis cannot invalidate
     * every other user's cache entry mid-window — see
     * `narrowPriorAnalysesForCacheKey`), then again for the prompt itself
     * (bar-anchored, deduped to one entry per bar, capped at
     * `PRIOR_ANALYSIS_LIMIT` — see `selectPriorAnalyses`). Both narrowings
     * are internal; the consumer only supplies the raw history and reads
     * the result.
     *
     * Omitting this field (or supplying `[]`) produces a prompt AND a cache
     * key that are BYTE-IDENTICAL to what this call produced before this
     * field existed — no `## Prior Analyses` section is rendered, and no
     * `:hist=<fingerprint>` key segment is appended (see
     * {@link buildAnalysisCacheKey}'s `historyFingerprint` param).
     */
    priorAnalyses?: readonly PriorAnalysis[];

    /**
     * Market-moving news events for this symbol, supplied by the consumer from
     * its own store — core has no news storage of its own.
     *
     * Core narrows this list twice before it reaches the LLM: once for the
     * cache key (impact filter, then capped at `MARKET_EVENT_CACHE_KEY_CAP` —
     * bars are not available yet, see `narrowMarketEventsForCacheKey`), then
     * again for the prompt itself (bar-window cut, capped at
     * `MARKET_EVENT_LIMIT` — see `selectMarketEvents`). Both cuts use the same
     * impact-first ordering, so the second never has to reach past what the
     * first kept. Both narrowings are internal; the consumer only supplies the
     * raw list.
     *
     * Only the classification travels — never the headline or body. Reading
     * the article is the news and overall axes' job; this axis needs the fact
     * to explain a bar move.
     *
     * Omitting this field (or supplying `[]`) produces a prompt AND a cache key
     * that are BYTE-IDENTICAL to what this call produced before the field
     * existed — no `## Market Events` section, no `:evt=` key segment.
     */
    marketEvents?: readonly MarketEvent[];

    /**
     * Callback that receives the exact prompt sent to the model, for a
     * consumer that persists prompts alongside the analyses they produced
     * (offline evaluation, debugging).
     *
     * Called synchronously exactly ONCE, immediately after the prompt is
     * assembled and before the provider call — and ONLY on a cache miss; a
     * cache hit has no freshly assembled prompt to hand out. Omitting it
     * leaves behavior byte-identical (no prompt bytes, cache key, or result
     * change).
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
    /**
     * Cancellation signal for the in-flight LLM call (used by `runAnalysis`).
     * When provided, passed through to `callAnalysisAi` so a dropped SSE
     * connection can abort the underlying AI provider request rather than
     * letting it run to completion against a gone client.
     *
     * Has no effect on `submitAnalysis` / `pollAnalysis` (the worker-based
     * submit/poll pair does not accept a signal).
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
 * Options controlling a public analysis poll response.
 *
 * The resolved caller tier is intentionally supplied at poll time: a job can
 * outlive a tier change, and its submit-time tier must never determine what a
 * later caller can read.
 */
export interface PollAnalysisOptions extends BackgroundTaskOptions {
    /** Resolved tier of the caller receiving this poll response. */
    tier?: Tier;
    /** Tier policy used to filter this poll response. */
    tierConfig?: TierConfig;
}

/**
 * Error returned when application tier gates block a timeframe request.
 */
export interface TierTimeframeAccessError {
    /** Machine-readable reason for the denial. */
    code: 'timeframe_not_allowed';
    /** Human-readable explanation suitable for API responses. */
    message: string;
    /** Tier used for the access decision. */
    tier: Tier;
    /** Timeframe requested by the caller. */
    timeframe: Timeframe;
    /** Timeframes available to the tier under the active config. */
    allowedTimeframes: Timeframe[];
}

/**
 * Analysis error result when tier timeframe access is denied.
 */
export interface TierGateErrorResult {
    status: 'error';
    error: TierTimeframeAccessError;
}

/**
 * @internal
 * Build the human-readable "timeframe not allowed" message shared by the
 * submit-path {@link buildTimeframeNotAllowedError} and both poll paths
 * (`pollAnalysis`, `pollOverallAnalysis`) so the wording never drifts between
 * the three call sites that report the same denial.
 *
 * @param tier - Tier used for the access decision.
 * @param timeframe - Timeframe requested by the caller.
 * @returns The message string embedded in the timeframe-gate error/result.
 */
export function timeframeNotAllowedMessage(
    tier: Tier,
    timeframe: Timeframe
): string {
    return `Timeframe ${timeframe} is not available for ${tier} tier.`;
}

/**
 * @internal
 * Build the {@link TierTimeframeAccessError} payload for a denied timeframe
 * request. Shared by every submit use-case that runs the timeframe gate
 * (`submitAnalysis`'s `submitAnalysisWithVisibility` and
 * `submitOverallAnalysis`) so the error shape stays byte-identical across
 * axes instead of being hand-duplicated at each call site.
 *
 * @param tier - Tier used for the access decision.
 * @param timeframe - Timeframe requested by the caller.
 * @param tierConfig - Tier configuration; defaults to {@link TIER_CONFIG} at
 *   each call site (this helper takes it as a required parameter so callers
 *   pass the same resolved config they used for the `isTimeframeAllowed` check).
 * @returns The error payload to embed in a `{ status: 'error', error }` result.
 */
export function buildTimeframeNotAllowedError(
    tier: Tier,
    timeframe: Timeframe,
    tierConfig: TierConfig
): TierTimeframeAccessError {
    return {
        code: 'timeframe_not_allowed',
        message: timeframeNotAllowedMessage(tier, timeframe),
        tier,
        timeframe,
        allowedTimeframes: getAllowedTimeframes(tier, tierConfig),
    };
}

/**
 * Analysis error result: usage limit exceeded, tier timeframe denied, or BYOK key required.
 */
export type SubmitAnalysisErrorResult =
    | { status: 'error'; error: AnalysisLimitError }
    | UserApiKeyRequiredError
    | TierGateErrorResult;

/**
 * Result indicating the analysis cache missed but no job was enqueued because
 * the caller opted out via `skipEnqueueIfMiss`. The consumer is expected to
 * render a fallback in this case.
 */
export interface SubmitAnalysisMissNoTrigger {
    status: 'miss_no_trigger';
}

/**
 * Result of a `runAnalysis` call — the direct (non-queued) successor to the
 * `submitAnalysis` + `pollAnalysis` pair.
 *
 * - `cached`: a recent analysis was found in the cache and returned as-is.
 * - `done`: the LLM completed and the result is ready.
 * - `miss_no_trigger`: cache missed and `skipEnqueueIfMiss` was set; caller
 *   should render a fallback.
 * - `error`: a tier gate, usage limit, or BYOK gate denied the request.
 *
 * LLM-level failures (provider errors, network, abort) propagate as thrown
 * exceptions so the SSE handler can map them to appropriate HTTP responses.
 */
export type RunAnalysisResult =
    | {
          status: 'cached';
          result: AnalysisResponse | FilteredAnalysisResponse;
          lockedInfoDepth: readonly TierInfoDepth[];
      }
    | {
          status: 'done';
          result: AnalysisResponse | FilteredAnalysisResponse;
          lockedInfoDepth: readonly TierInfoDepth[];
          /**
           * The same analysis **before** tier filtering — for callers that
           * persist history rather than render.
           *
           * `result` above is what this tier may *see*; the tier's
           * `infoDepth` nulls out whatever it may not. That is right for
           * rendering and wrong for storage: a `free` caller's `infoDepth`
           * is `direction`/`summary`/`skill_detection` only, so `riskLevel`
           * arrives as `null` — and {@link PriorAnalysis} requires both
           * `trend` and `riskLevel`. Persisting the filtered shape therefore
           * yields rows that every later read must discard, which silently
           * empties the prior-analysis history for exactly the traffic that
           * produces most of it (anonymous visitors and SEO pre-warm, which
           * runs as `free` because the tier is folded into the cache key).
           *
           * This costs nothing to provide: the value is already computed and
           * is what gets written to the cache — filtering happens only on the
           * way out to the caller.
           *
           * Present on `done` only. A `cached` result means the row it came
           * from was already persisted when it was first generated.
           */
          unfilteredResult: AnalysisResponse;
      }
    | SubmitAnalysisMissNoTrigger
    | SubmitAnalysisErrorResult;

/**
 * Options for a `runBriefing` call — the direct (non-queued) successor to the
 * `submitBriefing` + `pollBriefing` pair.
 */
export interface RunBriefingOptions {
    /**
     * Cancellation signal. When provided, forwarded to `callBriefingAi` so a
     * dropped connection aborts the underlying AI provider request.
     */
    signal?: AbortSignal;
}

/**
 * Result of a `runBriefing` call.
 *
 * - `cached`: a recent briefing was found in the cache and returned as-is.
 * - `done`: the LLM completed and the result is ready.
 *
 * LLM-level failures (provider errors, network, abort) propagate as thrown
 * exceptions.
 */
export type RunBriefingResult =
    | {
          status: 'cached';
          briefing: MarketBriefingResponse;
          generatedAt: string;
      }
    | { status: 'done'; briefing: MarketBriefingResponse; generatedAt: string };

/** Submit analysis outcome including application-level gate errors. */
export type SubmitAnalysisGatedResult =
    | {
          status: 'cached';
          result: AnalysisResponse | FilteredAnalysisResponse;
          lockedInfoDepth: readonly TierInfoDepth[];
      }
    | { status: 'submitted'; jobId: string }
    | SubmitAnalysisMissNoTrigger
    | SubmitAnalysisErrorResult;
