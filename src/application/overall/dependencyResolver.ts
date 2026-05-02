import { submitAnalysis } from '@/application/market/submitAnalysis';
import { submitFundamentalAnalysis } from '@/application/fundamental/submitFundamentalAnalysis';
import { submitNewsAnalysis } from '@/application/news/submitNewsAnalysis';
import type {
    DependencyState,
    DependencyStateCached,
    DependencyStatePending,
    DependencyStateError,
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

// Re-export types for direct imports from this module.
// Primary export location is application/overall/types.ts.
export type {
    DependencyState,
    DependencyStateCached,
    DependencyStatePending,
    DependencyStateError,
    OverallDependencyInputs,
};
