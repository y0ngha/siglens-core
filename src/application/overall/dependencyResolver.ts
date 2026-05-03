import { submitAnalysis } from '@/application/market/submitAnalysis';
import { submitFundamentalAnalysis } from '@/application/fundamental/submitFundamentalAnalysis';
import { submitNewsAnalysis } from '@/application/news/submitNewsAnalysis';
import type {
    DependencyState,
    OverallDependencyInputs,
} from '@/application/overall/types';

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
    inputs: OverallDependencyInputs
): Promise<DependencyState> {
    const {
        symbol,
        timeframe,
        modelId,
        fundamentalProvider,
        newsItems: newsItemsInput,
        upcomingCalendar,
        technical: technicalOptions,
        fundamental: fundamentalOptions,
        news: newsField,
    } = inputs;
    // Intentional read of @deprecated `newsOptions` for backward compatibility
    // until the legacy field is removed in a future major version. Cast strips
    // the @deprecated tag so we don't surface the deprecation warning at this
    // intentional fallback site.
    const newsOptionsLegacy = (
        inputs as { newsOptions?: typeof inputs.news }
    ).newsOptions;

    // ── Backward-compat disambiguation for the renamed news fields ──
    // Old API: `news` (data: EnrichedNewsItem[]) + `newsOptions` (axis options).
    // New API: `newsItems` (data) + `news` (axis options).
    // The new `news` field accepts either shape — disambiguated at runtime
    // by Array.isArray to preserve callers using the legacy data alias.
    const newsFieldIsArray = Array.isArray(newsField);
    const resolvedNewsItems = newsItemsInput ?? (newsFieldIsArray ? newsField : undefined);
    const resolvedNewsOptions = newsFieldIsArray
        ? newsOptionsLegacy
        : (newsField ?? newsOptionsLegacy);

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

    // ── Kick off all three axes in parallel ──
    const [technicalResult, fundamentalResult, newsResult] = await Promise.all([
        submitAnalysis(symbol, timeframe, technicalForce, technicalFmpSymbol, {
            ...technicalRest,
            modelId: technicalRest.modelId ?? modelId,
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
            news: resolvedNewsItems,
            upcomingCalendar,
            ...resolvedNewsOptions,
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
