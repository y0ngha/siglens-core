import type { BackgroundTaskOptions } from '@/application/types';
import type { AnalysisLocale } from '@/domain/analysis/outputLocale';
import type { KeyPolicy } from '@/domain/keyRouting';
import type { InvestorFlowsDataProvider } from '@/domain/ports/investorFlowsDataProvider';
import type {
    ModelId,
    InvestorFlowsAnalysisResponse,
    InvestorFlowsMarket,
    InvestorFlowsScorecard,
    SqueezeRiskContext,
    Tier,
} from '@/domain/types';

/**
 * Options for {@link runInvestorFlowsAnalysis}.
 *
 * Investor flows data is public, so there is NO usage-limit gate and no BYOK-required
 * check — tier gating for `modelId` is the caller's responsibility, as with
 * congress. `userApiKey` is forwarded to the AI call unchanged.
 */
export interface RunInvestorFlowsAnalysisOptions extends BackgroundTaskOptions {
    /** Ticker (`"AAPL"`, or a Korean listing such as `"005930.KS"` whose snapshot is `market: 'kr'`). */
    symbol: string;
    /** LLM model identifier used for the analysis and cache scoping. */
    modelId: ModelId;
    /** Investor flows snapshot provider (injected by the caller). */
    dataProvider: InvestorFlowsDataProvider;
    /** Subscription tier forwarded to the AI call. Defaults to the default tier. */
    tier?: Tier;
    /** On a cache miss return `{ status: 'miss_no_trigger' }` instead of generating (bot/crawler gating). */
    skipEnqueueIfMiss?: boolean;
    /** Bypass the cache read and regenerate. */
    force?: boolean;
    /** Per-request deep-thinking toggle; folded into the cache key and the seed. */
    reasoning?: boolean;
    /** Output language of the generated text. Omit for Korean (the default adds nothing to the cache key); `en`, `ja` and `zh` get their own cache entries. */
    locale?: AnalysisLocale;
    /** BYOK API key forwarded to the AI call. */
    userApiKey?: string;
    /**
     * Which key pays for generation. Default `'tier'` (free/member models on
     * the server key, byok-class models on `userApiKey`). `'byok-only'` makes
     * every generation use `userApiKey` regardless of model or tier, throws
     * `UserApiKeyMissingError` when it is missing, disables the server-key
     * `providerFallback`, and never reads a server key. Not part of any cache
     * key, so results are shared across policies; a cache hit is served even
     * without a key (the key gate runs after the cache read, before the
     * snapshot fetch or provider call), and concurrent byok-only runs only join
     * runs on the same key. See {@link KeyPolicy}.
     */
    keyPolicy?: KeyPolicy;
    /** Aborts the in-flight AI call. */
    signal?: AbortSignal;
    /** Retry a failed server-key DeepSeek generation once on the fallback model. */
    providerFallback?: boolean;
    /**
     * `false` drops the FINRA short data from the scorecard and the prompt
     * (FINRA terms limit it to non-commercial use). Folded into the cache key.
     * Default `true`.
     */
    includeFinraData?: boolean;
    /**
     * `false` drops the Reg SHO threshold-list status from the scorecard, the
     * squeeze score and the prompt (the exchange lists are licensed for
     * non-commercial use only). Folded into the cache key. Default `true`.
     */
    includeExchangeLists?: boolean;
    /**
     * Daily bars for the price-aware squeeze score (see `evaluateSqueezeRisk`).
     * Its presence is folded into the cache key (`:squeeze=on`) because it adds
     * the squeeze block to the prompt; the bars themselves are not hashed. Omit
     * to keep the price-free squeeze rule.
     */
    squeezeContext?: SqueezeRiskContext;
    /**
     * Market of the symbol, as the provider will report it in
     * `snapshot.market`. Only shapes the cache key, which is built before the
     * snapshot is fetched: for `'kr'` the FINRA, exchange-list and squeeze
     * suffixes are left off because those sources do not exist for Korean
     * listings and cannot change the output. Core never infers the market from
     * the symbol. Default `'us'`.
     */
    market?: InvestorFlowsMarket;
}

/**
 * A cached investor flows (수급) analysis is ready.
 *
 * Unlike {@link RunInvestorFlowsAnalysisDone} it carries no scorecard: a cache
 * hit returns before the snapshot fetch, and recomputing the scorecard would
 * need that fetch. Consumers compute the scorecard separately (their own
 * snapshot plus `evaluateInvestorFlows`) and must expect it may show newer
 * numbers than the cached prose, which can be up to 12 hours old.
 */
export interface RunInvestorFlowsAnalysisCached {
    status: 'cached';
    result: InvestorFlowsAnalysisResponse;
}

/** The AI call completed and the analysis is ready. */
export interface RunInvestorFlowsAnalysisDone {
    status: 'done';
    result: InvestorFlowsAnalysisResponse;
    /** The scorecard the analysis interpreted, so the caller can render the same numbers. */
    scorecard: InvestorFlowsScorecard;
}

/** Cache missed and `skipEnqueueIfMiss` was set. */
export interface RunInvestorFlowsAnalysisMissNoTrigger {
    status: 'miss_no_trigger';
}

/**
 * The provider returned no snapshot, or every axis was insufficient. The AI is
 * never called — a deliberate cost guard.
 */
export interface RunInvestorFlowsAnalysisNoData {
    status: 'no_data';
}

/** The snapshot fetch failed. */
export interface RunInvestorFlowsAnalysisFetchError {
    status: 'error';
    code: 'fetch_failed';
    error: string;
}

/**
 * Outcome of `runInvestorFlowsAnalysis`. AI-call failures propagate as thrown
 * exceptions so the route handler can map them to HTTP responses.
 */
export type RunInvestorFlowsAnalysisResult =
    | RunInvestorFlowsAnalysisCached
    | RunInvestorFlowsAnalysisDone
    | RunInvestorFlowsAnalysisMissNoTrigger
    | RunInvestorFlowsAnalysisNoData
    | RunInvestorFlowsAnalysisFetchError;
