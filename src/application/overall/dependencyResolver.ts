import { submitAnalysis } from '@/application/market/submitAnalysis';
import { submitFundamentalAnalysis } from '@/application/fundamental/submitFundamentalAnalysis';
import { submitNewsAnalysis } from '@/application/news/submitNewsAnalysis';
import type {
    DependencyState,
    OverallDependencyInputs,
} from '@/application/overall/types';

/**
 * @internal Object branch of {@link OverallDependencyInputs.news} (per-axis
 * options); excludes the legacy `ReadonlyArray<EnrichedNewsItem>` data shape.
 */
type NewsAxisOptions = NonNullable<
    Exclude<OverallDependencyInputs['news'], readonly unknown[]>
>;

/** Strip the `usage` key from an axis-options object without mutating it. */
function omitUsage<T extends { usage?: unknown }>(opts: T): Omit<T, 'usage'> {
    const { usage: _usage, ...rest } = opts;
    return rest;
}

/**
 * @internal Options that customize how the resolver translates
 * {@link OverallDependencyInputs} into per-axis submit calls.
 */
export interface ResolveOverallDependenciesOptions {
    /**
     * When `true`, the resolver strips `usage` from each axis's forwarded
     * options so the daily limit is neither checked nor recorded per axis.
     * `submitOverallAnalysis` sets this to `true` to keep one overall request
     * counted as exactly one analysis (otherwise three axis submits would each
     * check + record, triple-counting). Standalone callers can leave it
     * `false` (the default) to opt into per-axis tracking.
     */
    dropAxisUsage?: boolean;
}

/**
 * @internal Called by {@link submitOverallAnalysis} — consumers should not call this directly.
 *
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
    inputs: OverallDependencyInputs,
    options: ResolveOverallDependenciesOptions = {}
): Promise<DependencyState> {
    const {
        symbol,
        companyName = symbol,
        timeframe,
        modelId,
        fundamentalProvider,
        newsItems: newsItemsInput,
        upcomingCalendar,
        technical: technicalOptions,
        fundamental: fundamentalOptions,
        news: newsField,
    } = inputs;
    const dropAxisUsage = options.dropAxisUsage ?? false;
    // ── Backward-compat disambiguation for the renamed news fields ──
    // Old API: `news` (data: EnrichedNewsItem[]) + `newsOptions` (axis options).
    // New API: `newsItems` (data) + `news` (axis options).
    // The new `news` field accepts either shape — disambiguated at runtime
    // by Array.isArray to preserve callers using the legacy data alias.
    // Intentional read of @deprecated `newsOptions` for backward compatibility
    // until the legacy field is removed in a future major version. Cast strips
    // the @deprecated tag so we don't surface the deprecation warning at this
    // intentional fallback site.
    // Runtime guarantee: OverallDependencyInputs.newsOptions (when present) is
    // typed as Pick<SubmitNewsAnalysisOptions,...>, which is structurally
    // identical to NewsAxisOptions.
    const newsOptionsLegacy = (inputs as { newsOptions?: NewsAxisOptions })
        .newsOptions;

    const newsFieldIsArray = Array.isArray(newsField);
    const resolvedNewsItems =
        newsItemsInput ?? (newsFieldIsArray ? newsField : undefined);
    // Runtime guarantee: the `!newsFieldIsArray && newsField !== undefined`
    // guard above narrows newsField to the object branch of the union (i.e.
    // Pick<SubmitNewsAnalysisOptions,...>), which is exactly NewsAxisOptions.
    // TS cannot derive this through Array.isArray on a union member, so an
    // explicit cast is required.
    const newsFieldAsOptions: NewsAxisOptions | undefined =
        !newsFieldIsArray && newsField !== undefined
            ? (newsField as NewsAxisOptions)
            : undefined;
    const resolvedNewsOptions: NewsAxisOptions | undefined = newsFieldIsArray
        ? newsOptionsLegacy
        : (newsFieldAsOptions ?? newsOptionsLegacy);

    if (resolvedNewsItems === undefined) {
        throw new Error(
            "OverallDependencyInputs: missing news items — supply 'newsItems' (preferred) or the legacy 'news' array."
        );
    }

    // ── Extract technical positional overrides (force, fmpSymbol) ──
    const {
        force: technicalForce = false,
        fmpSymbol: technicalFmpSymbol,
        ...technicalRest
    } = technicalOptions;

    // ── Strip per-axis `usage` when called from submitOverallAnalysis ──
    // Triple-counting prevention: if the caller forwards `usage` here, three
    // axis submits would each check + record one analysis. Overall owns the
    // single check + single record at its layer (submitOverallAnalysis).
    const technicalAxisOptions = dropAxisUsage
        ? omitUsage(technicalRest)
        : technicalRest;
    const fundamentalAxisOptions =
        dropAxisUsage && fundamentalOptions !== undefined
            ? omitUsage(fundamentalOptions)
            : fundamentalOptions;
    const newsAxisOptions =
        dropAxisUsage && resolvedNewsOptions !== undefined
            ? omitUsage(resolvedNewsOptions)
            : resolvedNewsOptions;

    // ── Kick off all three axes in parallel ──
    const [technicalResult, fundamentalResult, newsResult] = await Promise.all([
        submitAnalysis(
            symbol,
            companyName,
            timeframe,
            technicalForce,
            technicalFmpSymbol,
            {
                ...technicalAxisOptions,
                modelId: technicalAxisOptions.modelId ?? modelId,
            }
        ),
        submitFundamentalAnalysis({
            symbol,
            modelId,
            dataProvider: fundamentalProvider,
            ...fundamentalAxisOptions,
        }),
        submitNewsAnalysis({
            symbol,
            companyName,
            modelId,
            news: resolvedNewsItems,
            upcomingCalendar,
            ...newsAxisOptions,
        }),
    ]);

    // ── Check for axis errors — surface immediately, do not coerce to pending ──
    if (technicalResult.status === 'error') {
        return {
            kind: 'error',
            axis: 'technical',
            error: technicalResult.error,
        };
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
