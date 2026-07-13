import { cleanupInBackground, fireAndForget } from '@/application/background';
import { timeframeNotAllowedMessage } from '@/application/market/types';
import type {
    PollOverallAnalysisOptions,
    PollOverallAnalysisResult,
} from '@/application/overall/types';
import { normalizeOverallAnalysisResponse } from '@/domain/analysis/normalizeOverall';
import { DEFAULT_TIER, TIER_CONFIG, isTimeframeAllowed } from '@/domain/tier';
import type { OverallAnalysisResponse } from '@/domain/types';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import {
    buildOverallPeekCacheKey,
    OVERALL_CACHE_TTL_SECONDS,
} from '@/infrastructure/cache/config';
import {
    getJobError,
    getJobMeta,
    getJobResult,
    getJobStatus,
} from '@/infrastructure/jobs/queue';

/**
 * Poll the result of an overall analysis job submitted via
 * {@link submitOverallAnalysis}.
 *
 * Returns one of three outcomes:
 * - `processing`: the worker has not finished yet. Caller should retry.
 * - `error`: the worker reported a failure, the result was missing, the
 *   payload could not be normalized, or the caller tier is not allowed to
 *   access the job's timeframe (see the caller-tier timeframe gate below).
 * - `done`: the result is ready. The raw worker response is normalized via
 *   {@link normalizeOverallAnalysisResponse} and cached under two keys: the
 *   pre-computed `cacheKey` (exact-input canonical key) and the content-free
 *   peek key ({@link buildOverallPeekCacheKey}) for zero-cost SSR surfacing via
 *   {@link peekOverallAnalysisCache}. The peek key is written only when `meta`
 *   carries all of `symbol`, `timeframe`, and `modelId`.
 *
 * **Caller-tier timeframe gate:** mirrors {@link pollAnalysis}'s invariant 5,
 * but ONLY that timeframe gate, not `pollAnalysis`'s info-depth field
 * filtering. The `done` path re-checks the *resolved caller tier* (from
 * `options.tier`, defaulting to `DEFAULT_TIER`) against `meta.timeframe` via
 * {@link isTimeframeAllowed}, independent of the tier that submitted the job.
 * A tier change or downgrade between submit and poll must never leak an
 * intraday result the current caller is not entitled to. `filterAnalysisResult`
 * (per-field info-depth masking of `keyLevels` / `indicatorResults` / etc.) is
 * intentionally NOT applied here: `OverallAnalysisResponse` is a synthesized
 * headline/bullet narrative with no per-field gated detail to mask, so there
 * is nothing for that filter to act on.
 *
 * **Pending-dependency polling:** the same caveat applies when a consumer
 * polls a pending dependency job directly (e.g. `resolveOverallDependencies`
 * returns `{ kind: 'pending', pendingJobs }` and the caller polls
 * `pollAnalysis(pendingJobs.technical)` for the technical axis). The caller
 * MUST pass the same resolved `tier` used for the original submission to
 * whichever poll function it calls; otherwise that poll's caller-tier
 * timeframe gate defaults to `DEFAULT_TIER` (free) and may return
 * `{ status: 'error' }` for a legitimately-allowed intraday job. The cache
 * write happens before the gate runs, so no data is lost, but the reported
 * status would be misleading.
 *
 * On `error` and `done`, the job's Redis state is cleaned up via `cleanupJob`
 * (best-effort — cleanup failures are logged but do not affect the return value).
 *
 * **Empty-response handling:** this function does not skip the cache write when
 * the worker returns a sparse result. Overall analysis lacks a canonical
 * fallback sentinel shape, so a reliable empty-detection predicate cannot be
 * defined without risking false positives on legitimately sparse responses.
 * Malformed payloads are handled upstream:
 * {@link normalizeOverallAnalysisResponse} throws, transitioning the job to
 * the `error` path before any cache write occurs. A `console.warn` is emitted
 * when heuristic empty-field checks fire.
 *
 * Cancel-after-poll: a successful {@link cancelOverallAnalysisJob} call
 * does NOT immediately flip the job status. This function will keep
 * returning `processing` until the worker observes the cancel signal on
 * its next `isJobCancelled` check and self-transitions. Bound your retry
 * loop with a caller-side timeout to avoid polling indefinitely against a
 * dead worker. Note that this only applies to the overall job itself; for
 * `pending_dependencies` cases, see {@link cancelOverallAnalysisJob}.
 *
 * @param jobId - The `jobId` returned by {@link submitOverallAnalysis}.
 * @param options - Optional background-task hooks. Pass Vercel's `waitUntil`
 *   so Redis cleanup and cache writes can continue after the response.
 * @returns The current poll outcome — see {@link PollOverallAnalysisResult}.
 *
 * @example
 * ```ts
 * const result = await pollOverallAnalysis(jobId);
 * if (result.status === 'processing') scheduleRetry();
 * else if (result.status === 'error') showError(result.error);
 * else renderOverall(result.result);
 * ```
 *
 * @see submitOverallAnalysis
 * @see cancelOverallAnalysisJob
 */
export async function pollOverallAnalysis(
    jobId: string,
    options?: PollOverallAnalysisOptions
): Promise<PollOverallAnalysisResult> {
    const status = await getJobStatus(jobId);

    if (status === null || status === 'processing') {
        return { status: 'processing' };
    }

    if (status === 'error') {
        const error = await getJobError(jobId);
        cleanupInBackground(jobId, '[PollOverall]', options);
        return { status: 'error', error: error ?? 'Unknown error' };
    }

    // status === 'done'
    const [rawResult, meta] = await Promise.all([
        getJobResult(jobId),
        getJobMeta(jobId),
    ]);

    if (!rawResult) {
        console.error('[PollOverall] Result not found', {
            jobId,
            hasMeta: meta !== null,
            symbol: meta?.symbol,
        });
        cleanupInBackground(jobId, '[PollOverall]', options);
        return { status: 'error', error: 'Result not found' };
    }

    // Normalize the raw LLM response through the overall response normalizer.
    // The `optionsOiStale` flag was captured at submit time and stored in the
    // job meta — forwarding it here lets the normalizer attach it to the
    // response without the worker having to round-trip the value.
    let result: OverallAnalysisResponse;
    try {
        result = normalizeOverallAnalysisResponse(rawResult, {
            optionsOiStale: meta?.optionsOiStale,
        });
    } catch (error) {
        console.error('[PollOverall] Normalization failed:', error);
        cleanupInBackground(jobId, '[PollOverall]', options);
        return { status: 'error', error: 'Invalid response from worker' };
    }

    if (result.headlineKo === '' && result.scenarios.length === 0) {
        console.warn('[PollOverall] Empty overall analysis', { jobId });
    }

    // Cache the normalized result if a pre-computed cache key is available.
    //
    // Two keys are written:
    //  1. `meta.cacheKey` — the canonical hashed key the submit path looks up
    //     for an exact-input cache hit (see submitOverallAnalysis).
    //  2. the content-free "peek" key (overwrite-latest) — derived from
    //     symbol/timeframe/modelId so `peekOverallAnalysisCache` can read the
    //     most recent overall analysis without reconstructing the input hash
    //     (a content-free RSC read cannot derive the hash). Only written when
    //     all three meta fields are present.
    if (meta?.cacheKey) {
        const cache = createCacheProvider();
        if (cache !== null) {
            fireAndForget(
                cache
                    .set(meta.cacheKey, result, OVERALL_CACHE_TTL_SECONDS)
                    .catch(error =>
                        console.error(
                            '[PollOverall] Cache write failed:',
                            error
                        )
                    ),
                options
            );

            if (meta.symbol && meta.timeframe && meta.modelId) {
                // Fold `meta.reasoning` (member-reasoning-toggle spec, Part A) —
                // stored at submit time — so the "latest" peek pointer stays
                // scoped per reasoning ON/OFF, matching the canonical write above.
                const peekKey = buildOverallPeekCacheKey(
                    meta.symbol,
                    meta.timeframe,
                    meta.modelId,
                    meta.reasoning
                );
                fireAndForget(
                    cache
                        .set(peekKey, result, OVERALL_CACHE_TTL_SECONDS)
                        .catch(error =>
                            console.error(
                                '[PollOverall] Peek cache write failed:',
                                error
                            )
                        ),
                    options
                );
            }
        }
    }

    cleanupInBackground(jobId, '[PollOverall]', options);

    const callerTier = options?.tier ?? DEFAULT_TIER;
    const callerTierConfig = options?.tierConfig ?? TIER_CONFIG;
    if (
        meta?.timeframe !== undefined &&
        !isTimeframeAllowed(callerTier, meta.timeframe, callerTierConfig)
    ) {
        return {
            status: 'error',
            error: timeframeNotAllowedMessage(callerTier, meta.timeframe),
        };
    }

    return { status: 'done', result };
}
