import { submitAnalysis } from '@/application/market/submitAnalysis';
import { submitFundamentalAnalysis } from '@/application/fundamental/submitFundamentalAnalysis';
import { submitNewsAnalysis } from '@/application/news/submitNewsAnalysis';
import { submitOptionsAnalysis } from '@/application/options/submitOptionsAnalysis';
import { pickNearestExpiration } from '@/application/overall/pickNearestExpiration';
import { DEFAULT_TIER } from '@/domain/tier';
import type {
    DependencyState,
    OverallDependencyInputs,
} from '@/application/overall/types';
import type { OptionsAnalysisResponse } from '@/domain/types';
import type {
    SubmitOptionsAnalysisResult,
    SubmitOptionsAnalysisOptions,
} from '@/application/options/types';

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
        optionsSnapshot,
        options: optionsAxisOptions,
        force: topLevelForce,
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
    // `technicalForce` is the per-axis flag; the resolver OR's it with the
    // top-level `force` so either layer can trigger a refresh on the
    // technical axis. The other three axes (fundamental, news, options)
    // only have the top-level lever since they don't expose a per-axis
    // force option.
    const {
        force: technicalForce = false,
        fmpSymbol: technicalFmpSymbol,
        ...technicalRest
    } = technicalOptions;
    const effectiveTechnicalForce = topLevelForce ?? technicalForce;
    const effectiveAxisForce = topLevelForce ?? false;

    // ── Extract top-level propagation fields ──
    // `tier`, `userApiKey`, and `skipEnqueueIfMiss` live directly on
    // `OverallDependencyInputs` so the resolver can propagate them to each
    // axis without casting.
    const topLevelTier = inputs.tier;
    const topLevelUserApiKey = inputs.userApiKey;
    const topLevelSkipEnqueueIfMiss = inputs.skipEnqueueIfMiss;

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
    const optionsAxisOptionsResolved =
        dropAxisUsage && optionsAxisOptions !== undefined
            ? omitUsage(optionsAxisOptions)
            : optionsAxisOptions;

    // ── Options-axis preflight: pick the nearest expiration ──
    // `pickNearestExpiration` returns null when the snapshot has no usable
    // future chains; we treat that as a graceful skip (same shape as
    // submitOptionsAnalysis's `no_chains_error`) so the prompt builder can
    // proceed with `options: null`.
    const optionsExpirationDate =
        optionsSnapshot !== undefined
            ? pickNearestExpiration(optionsSnapshot, new Date())
            : null;

    // ── Options-axis submit (gracefully short-circuited when no snapshot) ──
    // Forwarded `force` is the top-level flag only — submitOptionsAnalysis
    // does not currently consume `force` at runtime, but we propagate it so
    // the resolver contract stays uniform across all four axes and a future
    // submit-level cache-bust hook can pick it up without API churn.
    const optionsSubmit: Promise<SubmitOptionsAnalysisResult> =
        optionsSnapshot !== undefined && optionsExpirationDate !== null
            ? submitOptionsAnalysis({
                  symbol,
                  companyName,
                  modelId,
                  snapshot: optionsSnapshot,
                  expirationDate: optionsExpirationDate,
                  tier: topLevelTier ?? DEFAULT_TIER,
                  userApiKey: topLevelUserApiKey,
                  ...optionsAxisOptionsResolved,
                  skipEnqueueIfMiss: topLevelSkipEnqueueIfMiss,
                  force: effectiveAxisForce,
              } as SubmitOptionsAnalysisOptions & { force: boolean })
            : Promise.resolve({
                  status: 'no_chains_error' as const,
                  code: 'no_options_chains' as const,
                  error:
                      optionsSnapshot === undefined
                          ? 'No options snapshot provided'
                          : 'No usable future expiration in snapshot',
              });

    // ── Kick off all four axes in parallel ──
    // `skipEnqueueIfMiss` is forced from the top level for every axis when
    // set: bot/crawler gating must apply uniformly to all sub-axis enqueues,
    // not just the overall job, otherwise sub-axis workers would still fire.
    const [technicalResult, fundamentalResult, newsResult, optionsResult] =
        await Promise.all([
            submitAnalysis(
                symbol,
                companyName,
                timeframe,
                effectiveTechnicalForce,
                technicalFmpSymbol,
                {
                    ...technicalAxisOptions,
                    modelId: technicalAxisOptions.modelId ?? modelId,
                    userApiKey:
                        technicalAxisOptions.userApiKey ?? topLevelUserApiKey,
                    tierContext:
                        technicalAxisOptions.tierContext ??
                        (topLevelTier !== undefined
                            ? { userId: null, tier: topLevelTier }
                            : undefined),
                    skipEnqueueIfMiss: topLevelSkipEnqueueIfMiss,
                }
            ),
            submitFundamentalAnalysis({
                symbol,
                modelId,
                dataProvider: fundamentalProvider,
                // Top-level fallbacks: axis-level values win because the spread comes last.
                tier: topLevelTier ?? DEFAULT_TIER,
                userApiKey: topLevelUserApiKey,
                ...fundamentalAxisOptions,
                skipEnqueueIfMiss: topLevelSkipEnqueueIfMiss,
                force: effectiveAxisForce,
            } as Parameters<typeof submitFundamentalAnalysis>[0] & {
                force: boolean;
            }),
            submitNewsAnalysis({
                symbol,
                companyName,
                modelId,
                news: resolvedNewsItems,
                upcomingCalendar,
                // Top-level fallbacks: axis-level values win because the spread comes last.
                tier: topLevelTier ?? DEFAULT_TIER,
                userApiKey: topLevelUserApiKey,
                ...newsAxisOptions,
                skipEnqueueIfMiss: topLevelSkipEnqueueIfMiss,
                force: effectiveAxisForce,
            } as Parameters<typeof submitNewsAnalysis>[0] & {
                force: boolean;
            }),
            optionsSubmit,
        ]);

    // ── Check for axis errors — surface immediately, do not coerce to pending ──
    // Always store the full submit result so consumers can narrow on
    // `error.status` without runtime `typeof` / `'status' in` guards.
    if (
        technicalResult.status === 'error' ||
        technicalResult.status === 'key_error'
    ) {
        return { kind: 'error', axis: 'technical', error: technicalResult };
    }
    if (
        fundamentalResult.status === 'error' ||
        fundamentalResult.status === 'key_error'
    ) {
        return { kind: 'error', axis: 'fundamental', error: fundamentalResult };
    }
    if (newsResult.status === 'error' || newsResult.status === 'key_error') {
        return { kind: 'error', axis: 'news', error: newsResult };
    }
    // Options axis surfaces `limit_error` and `key_error` as resolver errors.
    // `no_chains_error` is intentionally NOT an error — it's a graceful skip
    // (no options listed for this symbol or no usable chain at the picked
    // expiration), handled below by mapping to `options: null` in the cached
    // payload.
    if (
        optionsResult.status === 'limit_error' ||
        optionsResult.status === 'key_error'
    ) {
        return { kind: 'error', axis: 'options', error: optionsResult };
    }

    // ── Any axis cache-missed with skipEnqueueIfMiss → short-circuit ──
    // When bot/crawler gating is on, no axis should have enqueued — any axis
    // returning `miss_no_trigger` means the overall result is unbuildable
    // for this request, so surface that state to the caller without going
    // through the pending/cached paths.
    if (
        technicalResult.status === 'miss_no_trigger' ||
        fundamentalResult.status === 'miss_no_trigger' ||
        newsResult.status === 'miss_no_trigger' ||
        optionsResult.status === 'miss_no_trigger'
    ) {
        return { kind: 'miss_no_trigger' };
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
    const optionsJobId =
        optionsResult.status === 'submitted' ? optionsResult.jobId : undefined;

    // ── Resolve the options-axis payload for the cached branch ──
    // `cached` → embed the analysis; `no_chains_error` → null (graceful skip).
    // Any other status (`submitted`) is handled by the pending branch.
    const optionsPayload: OptionsAnalysisResponse | null =
        optionsResult.status === 'cached'
            ? optionsResult.result
            : optionsResult.status === 'no_chains_error'
              ? null
              : null;

    // ── All four axes terminal (cached or no_chains for options) → cached state ──
    // The options axis is "resolved" when it's either cached or no_chains_error;
    // both produce a non-pending payload that the prompt builder can consume.
    const optionsResolved =
        optionsResult.status === 'cached' ||
        optionsResult.status === 'no_chains_error';

    if (
        technicalResult.status === 'cached' &&
        fundamentalResult.status === 'cached' &&
        newsResult.status === 'cached' &&
        optionsResolved
    ) {
        return {
            kind: 'cached',
            technical: technicalResult.result,
            fundamental: fundamentalResult.result,
            news: newsResult.result,
            options: optionsPayload,
        };
    }

    // ── At least one axis is pending → return pending state ──
    return {
        kind: 'pending',
        pendingJobs: {
            technical: technicalJobId,
            fundamental: fundamentalJobId,
            news: newsJobId,
            options: optionsJobId,
        },
    };
}
