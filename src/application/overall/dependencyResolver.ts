import { submitAnalysis } from '@/application/market/submitAnalysis';
import { submitFundamentalAnalysis } from '@/application/fundamental/submitFundamentalAnalysis';
import { submitNewsAnalysis } from '@/application/news/submitNewsAnalysis';
import { submitOptionsAnalysis } from '@/application/options/submitOptionsAnalysis';
import { pickNearestExpiration } from '@/domain/options/pickNearestExpiration';
import { DEFAULT_TIER } from '@/domain/tier';
import type {
    DependencyState,
    FundamentalCryptoSkip,
    OverallDependencyInputs,
} from '@/application/overall/types';
import type {
    FundamentalAnalysisResponse,
    OptionsAnalysisResponse,
} from '@/domain/types';
import type { SubmitFundamentalAnalysisResult } from '@/application/fundamental/types';
import type { SubmitOptionsAnalysisResult } from '@/application/options/types';

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
 * Resolve the four dependency axes (technical, fundamental, news, options) for an
 * overall analysis submission.
 *
 * Four Promises are resolved in parallel via `Promise.all`. For equity, all four submit functions are invoked; for `assetClass: 'crypto'`, only the technical and news axes call their submit functions — fundamental and options resolve via in-memory sentinels.
 * If **all** resolve to `status: 'cached'`, the function returns
 * `{ kind: 'cached', ... }` with the four embedded results so the caller
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
 * For `assetClass: 'crypto'`, the fundamental and options axes are gracefully
 * skipped: `submitFundamentalAnalysis` is never called (a `'no_fundamental_crypto'`
 * sentinel is used instead) and the options axis short-circuits to
 * `'no_chains_error'`. The returned `DependencyStateCached` then carries
 * `fundamental: null` and `options: null`.
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
 * // All four axes resolved. For crypto, state.fundamental and state.options are null.
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
        marketDataProvider,
        newsItems: newsItemsInput,
        upcomingCalendar,
        technical: technicalOptions,
        fundamental: fundamentalOptions,
        news: newsField,
        optionsSnapshot,
        options: optionsAxisOptions,
        force: topLevelForce,
        assetClass,
    } = inputs;

    // ── Asset-class gating ──
    // Crypto instruments have no FMP company profile, so submitting the
    // fundamental or options axes would always fail with a provider error.
    // Skip both axes entirely and treat them as intentionally absent
    // (same `no_chains_error` graceful-skip pattern used by the options axis
    // when no snapshot is provided).
    const isCrypto = assetClass === 'crypto';
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
    // Per-request deep-thinking toggle (member-reasoning-toggle spec, Part A).
    // Propagated to every axis the same way `modelId`/`userApiKey` are —
    // axis-level `reasoning` (if set on the per-axis options) wins.
    const topLevelReasoning = inputs.reasoning;

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
    // Crypto instruments also skip the options axis entirely — no listed
    // derivatives exist for them in the FMP dataset.
    const optionsExpirationDate =
        !isCrypto && optionsSnapshot !== undefined
            ? pickNearestExpiration(optionsSnapshot, new Date())
            : null;

    // ── Options-axis submit (gracefully short-circuited when no snapshot or crypto) ──
    // The four axes all consume `force` through their option types now, so
    // we can drop the explicit `as SubmitOptionsAnalysisOptions & { force }`
    // cast and rely on the structural type check.
    const optionsSubmit: Promise<SubmitOptionsAnalysisResult> =
        !isCrypto &&
        optionsSnapshot !== undefined &&
        optionsExpirationDate !== null
            ? submitOptionsAnalysis({
                  symbol,
                  companyName,
                  modelId,
                  snapshot: optionsSnapshot,
                  expirationDate: optionsExpirationDate,
                  tier: topLevelTier ?? DEFAULT_TIER,
                  userApiKey: topLevelUserApiKey,
                  reasoning: topLevelReasoning,
                  ...optionsAxisOptionsResolved,
                  skipEnqueueIfMiss: topLevelSkipEnqueueIfMiss,
                  force: effectiveAxisForce,
              })
            : Promise.resolve({
                  status: 'no_chains_error' as const,
                  code: 'no_options_chains' as const,
                  error: isCrypto
                      ? 'Crypto asset: options axis skipped'
                      : optionsSnapshot === undefined
                        ? 'No options snapshot provided'
                        : 'No usable future expiration in snapshot',
              });

    // ── Kick off all four axes in parallel ──
    // `skipEnqueueIfMiss` is forced from the top level for every axis when
    // set: bot/crawler gating must apply uniformly to all sub-axis enqueues,
    // not just the overall job, otherwise sub-axis workers would still fire.
    //
    // For crypto instruments the fundamental axis is gracefully skipped via a
    // sentinel `no_fundamental_crypto` status (mirrors the options-axis
    // `no_chains_error` skip pattern) so `submitFundamentalAnalysis` is never
    // called and cannot surface a "Profile not found" fetch error.
    const fundamentalSubmit: Promise<
        SubmitFundamentalAnalysisResult | FundamentalCryptoSkip
    > = isCrypto
        ? Promise.resolve({
              status: 'no_fundamental_crypto' as const,
              code: 'no_fundamental_crypto' as const,
              error: 'Crypto asset: fundamental axis skipped',
          })
        : submitFundamentalAnalysis({
              symbol,
              modelId,
              dataProvider: fundamentalProvider,
              // Top-level fallbacks: axis-level values win because the spread comes last.
              tier: topLevelTier ?? DEFAULT_TIER,
              userApiKey: topLevelUserApiKey,
              reasoning: topLevelReasoning,
              ...fundamentalAxisOptions,
              skipEnqueueIfMiss: topLevelSkipEnqueueIfMiss,
              force: effectiveAxisForce,
          });

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
                    marketDataProvider,
                    modelId: technicalAxisOptions.modelId ?? modelId,
                    userApiKey:
                        technicalAxisOptions.userApiKey ?? topLevelUserApiKey,
                    reasoning:
                        technicalAxisOptions.reasoning ?? topLevelReasoning,
                    tierContext:
                        technicalAxisOptions.tierContext ??
                        (topLevelTier !== undefined
                            ? { userId: null, tier: topLevelTier }
                            : undefined),
                    skipEnqueueIfMiss: topLevelSkipEnqueueIfMiss,
                }
            ),
            fundamentalSubmit,
            submitNewsAnalysis({
                symbol,
                companyName,
                modelId,
                news: resolvedNewsItems,
                upcomingCalendar,
                // Top-level fallbacks: axis-level values win because the spread comes last.
                tier: topLevelTier ?? DEFAULT_TIER,
                userApiKey: topLevelUserApiKey,
                reasoning: topLevelReasoning,
                ...newsAxisOptions,
                skipEnqueueIfMiss: topLevelSkipEnqueueIfMiss,
                force: effectiveAxisForce,
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
    // Other statuses (`submitted`) are handled by the pending branch below, so
    // the payload is only consumed when status ∈ {cached, no_chains_error}.
    const optionsPayload: OptionsAnalysisResponse | null =
        optionsResult.status === 'cached' ? optionsResult.result : null;

    // ── Resolve the fundamental-axis payload for the cached branch ──
    // `cached` → embed the analysis; `no_fundamental_crypto` → null (graceful
    // skip for crypto instruments — mirrors options `no_chains_error` pattern).
    // The prompt builder receives `null` and uses the crypto-specific label
    // ("no fundamentals for crypto") rather than treating it as missing data.
    const fundamentalPayload: FundamentalAnalysisResponse | null =
        fundamentalResult.status === 'cached' ? fundamentalResult.result : null;

    // ── All four axes terminal → cached state ──
    // The options axis is "resolved" when it's either cached or no_chains_error.
    // The fundamental axis is "resolved" when it's either cached or
    // no_fundamental_crypto (crypto graceful skip).
    // Both produce a non-pending payload that the prompt builder can consume.
    const optionsResolved =
        optionsResult.status === 'cached' ||
        optionsResult.status === 'no_chains_error';
    const fundamentalResolved =
        fundamentalResult.status === 'cached' ||
        fundamentalResult.status === 'no_fundamental_crypto';

    if (
        technicalResult.status === 'cached' &&
        fundamentalResolved &&
        newsResult.status === 'cached' &&
        optionsResolved
    ) {
        return {
            kind: 'cached',
            technical: technicalResult.result,
            fundamental: fundamentalPayload,
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
