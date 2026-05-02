import { submitAnalysis } from '@/application/market/submitAnalysis';
import { submitFundamentalAnalysis } from '@/application/fundamental/submitFundamentalAnalysis';
import { submitNewsAnalysis } from '@/application/news/submitNewsAnalysis';
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
    Timeframe,
} from '@/domain/types';
import type { FundamentalDataProvider } from '@/infrastructure/fundamental/types';

// ─────────────────────────────────────────
// Input types
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
// Output types
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
    pendingJobs: Record<
        'technical' | 'fundamental' | 'news',
        string | undefined
    >;
}

/**
 * One of the dependency axes returned `status: 'error'` from its submit function.
 *
 * `axis` identifies which axis failed; `error` carries the error payload from
 * the respective submit result (string message or structured `AnalysisLimitError`).
 */
export interface DependencyStateError {
    kind: 'error';
    axis: 'technical' | 'fundamental' | 'news';
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
// Resolver
// ─────────────────────────────────────────

/**
 * Resolve the three dependency axes (technical, fundamental, news) for an
 * overall analysis submission.
 *
 * All three submit functions are called in parallel via `Promise.all`.
 * If **all** resolve to `status: 'cached'`, the function returns
 * `{ kind: 'cached', ... }` with the three embedded results so the caller
 * can immediately build the overall prompt.
 *
 * If **any** axis resolves to `status: 'submitted'`, the function returns
 * `{ kind: 'pending', pendingJobs }` containing the `jobId` for submitted
 * axes (`undefined` for cached ones).
 *
 * If **any** axis resolves to `status: 'error'` (tier gate, usage limit, or
 * fetch failure), the function returns `{ kind: 'error', axis, error }` immediately
 * so the caller can surface the failure to the user without waiting for other axes.
 *
 * @param inputs - Symbol, timeframe, model, providers, and pass-through
 *   options for each submit function.
 * @returns `{ kind: 'cached' }` if all axes were cache hits,
 *   `{ kind: 'pending', pendingJobs }` if one or more are still processing, or
 *   `{ kind: 'error', axis, error }` if an axis returned an error.
 *
 * @example
 * ```ts
 * const state = await resolveOverallDependencies(inputs);
 * if (state.kind === 'error') return { status: 'error', axis: state.axis, error: state.error };
 * if (state.kind === 'pending') return { status: 'pending_dependencies', pendingJobs: state.pendingJobs };
 * // All three cached — build overall prompt with state.technical/fundamental/news
 * ```
 *
 * @see submitOverallAnalysis
 */
export async function resolveOverallDependencies(
    inputs: OverallDependencyInputs
): Promise<DependencyState> {
    const {
        symbol,
        timeframe,
        modelId,
        fundamentalProvider,
        news,
        upcomingCalendar,
        technical: technicalOptions,
        fundamental: fundamentalOptions,
        newsOptions,
    } = inputs;

    // ── Kick off all three axes in parallel ──
    const [technicalResult, fundamentalResult, newsResult] = await Promise.all([
        submitAnalysis(symbol, timeframe, false, undefined, {
            ...technicalOptions,
            modelId: technicalOptions.modelId ?? modelId,
            userApiKey: technicalOptions.userApiKey,
        }),
        submitFundamentalAnalysis({
            symbol,
            modelId,
            dataProvider: fundamentalProvider,
            ...fundamentalOptions,
        }),
        submitNewsAnalysis({
            symbol,
            modelId,
            news,
            upcomingCalendar,
            ...newsOptions,
        }),
    ]);

    // ── Check for axis errors — surface immediately, do not coerce to pending ──
    if (technicalResult.status === 'error') {
        return { kind: 'error', axis: 'technical', error: technicalResult.error };
    }
    if (fundamentalResult.status === 'error') {
        return {
            kind: 'error',
            axis: 'fundamental',
            error: fundamentalResult.error,
        };
    }
    if (newsResult.status === 'error') {
        return { kind: 'error', axis: 'news', error: newsResult.error };
    }

    // ── Determine pending job IDs for each axis ──
    const technicalJobId =
        technicalResult.status === 'submitted'
            ? technicalResult.jobId
            : undefined;
    const fundamentalJobId =
        fundamentalResult.status === 'submitted'
            ? fundamentalResult.jobId
            : undefined;
    const newsJobId =
        newsResult.status === 'submitted' ? newsResult.jobId : undefined;

    // ── All three cached → return cached state ──
    if (
        technicalResult.status === 'cached' &&
        fundamentalResult.status === 'cached' &&
        newsResult.status === 'cached'
    ) {
        return {
            kind: 'cached',
            technical: technicalResult.result,
            fundamental: fundamentalResult.result,
            news: newsResult.result,
        };
    }

    // ── At least one axis is pending → return pending state ──
    return {
        kind: 'pending',
        pendingJobs: {
            technical: technicalJobId,
            fundamental: fundamentalJobId,
            news: newsJobId,
        },
    };
}
