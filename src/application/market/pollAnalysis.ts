import { cleanupInBackground, fireAndForget } from '@/application/background';
import {
    timeframeNotAllowedMessage,
    type PollAnalysisOptions,
} from '@/application/market/types';
import { postProcessAnalysisWithReconcile } from '@/domain/analysis/ai-levels';
import {
    enrichAnalysisWithConfidence,
    isFallbackAnalysis,
} from '@/domain/analysis/confidence';
import { filterAnalysisResult } from '@/domain/analysis/filterAnalysisResult';
import { DEFAULT_TIER, TIER_CONFIG, isTimeframeAllowed } from '@/domain/tier';
import type { PollAnalysisResult, Skill } from '@/domain/types';
import { computeEffectiveTtl } from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import {
    getJobError,
    getJobMeta,
    getJobResult,
    getJobStatus,
} from '@/infrastructure/jobs/queue';
import { createSkillsProvider } from '@/infrastructure/skills/loader';

/**
 * Poll the result of an analysis job submitted via {@link submitAnalysis}.
 *
 * Returns one of three outcomes:
 * - `processing`: the worker has not finished yet. Caller should retry.
 * - `error`: the worker reported a failure, the result was missing, or the
 *   caller tier is not allowed to access the job's timeframe (see the
 *   caller-tier timeframe gate below).
 * - `done`: the result is ready. The raw worker response is enriched with
 *   skill-confidence weighting and reconciled against the latest close/ATR,
 *   then cached for the remaining timeframe-aware TTL before being returned.
 *   The result is tier-filtered via {@link filterAnalysisResult}; fields the
 *   caller's tier cannot see are stripped and their keys are surfaced on
 *   `lockedInfoDepth` so the UI can render an upsell placeholder instead.
 *
 * When the worker returns an empty/malformed payload, the result is filled
 * with safe defaults and a Korean fallback summary, and the cache write is
 * skipped so a retry can succeed. The `done` status is still returned so
 * the caller can surface the placeholder to the user.
 *
 * On `error` and `done`, the job's Redis state is cleaned up via `cleanupJob`
 * (best-effort — cleanup failures are logged but do not affect the return
 * value). Skill loading at poll time is best-effort, falling back to an empty
 * skill list if it fails.
 *
 * **Caller-tier timeframe gate:** the `done` path re-checks the *resolved
 * caller tier* (from `options.tier`, defaulting to `DEFAULT_TIER`) against
 * `meta.timeframe` via {@link isTimeframeAllowed}, independent of the tier
 * that submitted the job. A tier change or downgrade between submit and poll
 * must never leak an intraday result the current caller is not entitled to.
 *
 * **Pending-dependency polling:** when a consumer polls this job as a pending
 * dependency (e.g. `resolveOverallDependencies` returns `{ kind: 'pending',
 * pendingJobs }` and the caller then calls `pollAnalysis(pendingJobs.technical)`
 * directly), it MUST pass the same resolved `tier` used for the original
 * submission. Otherwise the caller-tier timeframe gate above defaults to
 * `DEFAULT_TIER` (free) and may return `{ status: 'error' }` for a
 * legitimately-allowed intraday job. The cache write happens before this
 * gate runs, so no data is lost, but the reported status would be misleading.
 *
 * Cancel-after-poll: a successful {@link cancelAnalysisJob} call does NOT
 * immediately flip the job status. This function will keep returning
 * `processing` until the worker observes the cancel signal on its next
 * `isJobCancelled` check and self-transitions. Bound your retry loop with
 * a caller-side timeout to avoid polling indefinitely against a dead worker.
 *
 * @param jobId - The `jobId` returned by {@link submitAnalysis}.
 * @param options - Optional background-task hooks. Pass Vercel's `waitUntil`
 *   so Redis cleanup and cache writes can continue after the response. Pass
 *   `tier`/`tierConfig` to enforce the caller-tier timeframe gate described above.
 * @returns The current poll outcome — see {@link PollAnalysisResult}.
 *
 * @example
 * ```ts
 * const result = await pollAnalysis(jobId);
 * if (result.status === 'processing') scheduleRetry();
 * else if (result.status === 'error') showError(result.error);
 * else renderAnalysis(result.result);
 * ```
 *
 * @see submitAnalysis
 * @see cancelAnalysisJob
 */
export async function pollAnalysis(
    jobId: string,
    options?: PollAnalysisOptions
): Promise<PollAnalysisResult> {
    const status = await getJobStatus(jobId);

    if (status === null || status === 'processing') {
        return { status: 'processing' };
    }

    if (status === 'error') {
        const error = await getJobError(jobId);
        cleanupInBackground(jobId, '[Poll]', options);
        return { status: 'error', error: error ?? 'Unknown error' };
    }

    // status === 'done'
    const [rawResult, meta] = await Promise.all([
        getJobResult(jobId),
        getJobMeta(jobId),
    ]);

    if (!rawResult) {
        console.error('[Poll] Result not found', {
            jobId,
            rawResultType: typeof rawResult,
            rawResultValue: rawResult,
            hasMeta: meta !== null,
            symbol: meta?.symbol,
            timeframe: meta?.timeframe,
        });
        cleanupInBackground(jobId, '[Poll]', options);
        return { status: 'error', error: 'Result not found' };
    }

    const skillsLoader = createSkillsProvider();
    // `skillsDegraded` reflects the poll-time skill-load state (the load that
    // produced the `skills` used by `enrichAnalysisWithConfidence` immediately
    // below), so the cached label always matches the data actually used.
    const { skills, skillsDegraded } = await skillsLoader
        .loadSkills()
        .then(loaded => ({ skills: loaded, skillsDegraded: false }))
        .catch((error: unknown) => {
            console.error(
                '[Poll] Skills loading failed, proceeding without skills:',
                error
            );
            return { skills: [] as Skill[], skillsDegraded: true };
        });

    const enriched = enrichAnalysisWithConfidence(rawResult, skills);

    const reconciled = postProcessAnalysisWithReconcile(
        enriched,
        meta?.lastClose,
        meta?.atr
    );

    const now = new Date();
    const analyzedAt = now.toISOString();
    const result = { ...reconciled, analyzedAt };

    if (
        meta?.cacheKey !== undefined &&
        meta.symbol !== undefined &&
        meta.timeframe !== undefined
    ) {
        if (isFallbackAnalysis(reconciled)) {
            console.warn(
                '[Poll] Worker returned empty analysis; skipping cache write',
                { jobId, symbol: meta.symbol }
            );
        } else {
            const cache = createCacheProvider();
            if (cache !== null) {
                const ttl = computeEffectiveTtl(meta.timeframe, now);
                fireAndForget(
                    cache
                        .set(meta.cacheKey, { ...result, skillsDegraded }, ttl)
                        .catch(error =>
                            console.error('[Poll] Cache write failed:', error)
                        ),
                    options
                );
            }
        }
    }

    cleanupInBackground(jobId, '[Poll]', options);

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

    // Filtering by the CALLER tier is safe now that `skill_detection` exposes
    // patternSummaries/strategyResults to free. The security boundary is that
    // jobs are tier-bound: a submission's cache key is `${tier}:${fingerprint}`
    // and its jobId is a random UUID handed back only to that submitter, so a
    // genuine free user can never obtain a higher tier's job and thus never its
    // uncapped skill set. The `callerTier` filter is a display-entitlement pass
    // layered on top, not the boundary; even on the documented tier-passthrough
    // footgun (a caller omitting `tier` defaults to free) the mismatch only
    // filters a job's OWN result strictly more restrictively, so it cannot
    // surface skills the caller was not already entitled to.
    const filtered = filterAnalysisResult(result, callerTier, callerTierConfig);

    return { status: 'done', ...filtered };
}
