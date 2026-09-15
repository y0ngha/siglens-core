import type { BackgroundTaskOptions } from '@/application/types';
import type { AnalysisLocale } from '@/domain/analysis/outputLocale';
import type { CongressTradesProvider } from '@/domain/ports/congressTradesProvider';
import type { CongressTrendResponse, ModelId, Tier } from '@/domain/types';

// ─────────────────────────────────────────
// Submit
// ─────────────────────────────────────────

/**
 * Options controlling congressional-trade trend analysis submission.
 *
 * Congress data is fully public, so — unlike the financials submit options —
 * there is NO `usage` / `now` field: no daily-limit check applies. The
 * worker payload always carries a `tier`: the caller-supplied
 * {@link SubmitCongressTrendOptions.tier}, or {@link DEFAULT_TIER} when
 * `tier` is omitted.
 *
 * `userApiKey` IS present here, unlike the "no usage/now" fields above: a
 * member who registered their own provider key must be able to route
 * congress analysis through a premium model too, even though congress data
 * itself needs no usage-limit or tier gate. Core does not gate on it (no
 * BYOK-required check the way `submitAnalysis` has one) — tier gating for
 * `modelId` stays the caller's (siglens) responsibility, same as the rest of
 * this options type.
 */
export interface SubmitCongressTrendOptions extends BackgroundTaskOptions {
    /** U.S. equity ticker (e.g. `"AAPL"`). */
    symbol: string;
    /** LLM model identifier used for the analysis and cache scoping. */
    modelId: ModelId;
    /**
     * Congress trades provider implementation (injected by the caller).
     * Core depends only on the interface — never on a concrete HTTP client.
     */
    dataProvider: CongressTradesProvider;
    /**
     * Resolved subscription tier forwarded to the worker payload. Defaults to
     * {@link DEFAULT_TIER}. Congress is public, so this is informational only —
     * no gating is applied.
     */
    tier?: Tier;
    /**
     * When `true`, skip enqueueing a new analysis job on cache miss and return
     * `{ status: 'miss_no_trigger' }` instead. Cache hits are unaffected.
     * Intended for consumer-side gating of bot/crawler traffic.
     */
    skipEnqueueIfMiss?: boolean;
    /** When true, bypass the cache and enqueue a fresh analysis. */
    force?: boolean;
    /** Number of trade records to fetch per chamber. Defaults to `50`. */
    limit?: number;
    /**
     * Per-request deep-thinking toggle (member-reasoning-toggle spec, Part A).
     * `true` requests the model's default/spec reasoning depth; `false` or
     * omitted requests the provider-minimized setting — the pre-toggle
     * default. Folded into the cache key so ON and OFF results never
     * collide; forwarded to the worker `/analyze` body only when `true`.
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
     * BYOK API key. When provided, forwarded to the worker as the
     * `X-AI-API-KEY` header — the same mechanism every other submit use-case
     * uses (`submitAnalysis`, `submitFinancialsAnalysis`, etc.). Core does
     * not gate on tier/model here (see the type-level doc above); the caller
     * decides when a key is required.
     */
    userApiKey?: string;
    /**
     * Cancellation signal for the in-flight LLM call (used by `runCongressTrend`).
     * When provided, passed through to `callAnalysisAi` so a dropped connection
     * can abort the underlying AI provider request.
     *
     * Has no effect on `submitCongressTrend` (the worker-based path).
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

/** The caller receives a cached analysis — no new job was created. */
export interface SubmitCongressTrendCached {
    status: 'cached';
    result: CongressTrendResponse;
}

/** A new analysis job was submitted; poll with `jobId` for the result. */
export interface SubmitCongressTrendSubmitted {
    status: 'submitted';
    jobId: string;
}

/**
 * Result indicating the analysis cache missed but no job was enqueued because
 * the caller opted out via `skipEnqueueIfMiss`. The consumer renders a fallback.
 */
export interface SubmitCongressTrendMissNoTrigger {
    status: 'miss_no_trigger';
}

/**
 * Result variant when the data fetch returned zero trades after normalization.
 *
 * Congress 0건 = 정상(NOT an error): many symbols simply have no disclosures.
 * No job is enqueued and the LLM is never called — a deliberate cost guard.
 */
export interface SubmitCongressTrendNoTrades {
    status: 'no_trades';
}

/** Result variant when the provider fetch or data normalization fails. */
export interface SubmitCongressTrendFetchError {
    status: 'error';
    code: 'fetch_failed';
    error: string;
}

/** Union of all possible outcomes from `submitCongressTrend`. */
export type SubmitCongressTrendResult =
    | SubmitCongressTrendCached
    | SubmitCongressTrendSubmitted
    | SubmitCongressTrendMissNoTrigger
    | SubmitCongressTrendNoTrades
    | SubmitCongressTrendFetchError;

// ─────────────────────────────────────────
// Poll
// ─────────────────────────────────────────

/** Outcome of polling congress trend analysis: processing, finished, or errored. */
export type PollCongressTrendResult =
    | { status: 'processing' }
    | { status: 'done'; result: CongressTrendResponse }
    | { status: 'error'; error: string };

// ─────────────────────────────────────────
// Run Congress Trend (direct-await, non-queued)
// ─────────────────────────────────────────

/** Result variant when the LLM completed and the congress analysis is ready. */
export interface RunCongressTrendDone {
    status: 'done';
    result: CongressTrendResponse;
}

/**
 * Result of a `runCongressTrend` call — the direct (non-queued) successor to
 * the `submitCongressTrend` + `pollCongressTrend` pair.
 *
 * - `cached`: a recent analysis was found in the cache (non-empty summary).
 * - `done`: the LLM completed and the result is ready.
 * - `miss_no_trigger`: cache missed and `skipEnqueueIfMiss` was set.
 * - `no_trades`: senate + house trades normalized to zero; LLM not called.
 * - `error`: the data provider fetch failed (`code: 'fetch_failed'`).
 *
 * LLM-level failures propagate as thrown exceptions so the route handler
 * can map them to appropriate HTTP responses. There is no BYOK gate in core —
 * tier gating for `modelId` is the caller's responsibility.
 */
export type RunCongressTrendResult =
    | SubmitCongressTrendCached
    | RunCongressTrendDone
    | SubmitCongressTrendMissNoTrigger
    | SubmitCongressTrendNoTrades
    | SubmitCongressTrendFetchError;
