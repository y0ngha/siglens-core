import { cleanupInBackground, fireAndForget } from '@/application/background';
import type { BackgroundTaskOptions } from '@/application/types';
import { postProcessAnalysisWithReconcile } from '@/domain/analysis/ai-levels';
import {
    enrichAnalysisWithConfidence,
    isFallbackAnalysis,
} from '@/domain/analysis/confidence';
import type { PollAnalysisResult, Skill } from '@/domain/types';
import {
    buildAnalysisCacheKey,
    computeEffectiveTtl,
} from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { hashSkillCatalog } from '@/infrastructure/hash/analysisInput';
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
 * - `error`: the worker reported a failure or the result was missing.
 * - `done`: the result is ready. The raw worker response is enriched with
 *   skill-confidence weighting and reconciled against the latest close/ATR,
 *   then cached for the remaining timeframe-aware TTL before being returned.
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
 * Cancel-after-poll: a successful {@link cancelAnalysisJob} call does NOT
 * immediately flip the job status. This function will keep returning
 * `processing` until the worker observes the cancel signal on its next
 * `isJobCancelled` check and self-transitions. Bound your retry loop with
 * a caller-side timeout to avoid polling indefinitely against a dead worker.
 *
 * @param jobId - The `jobId` returned by {@link submitAnalysis}.
 * @param options - Optional background-task hooks. Pass Vercel's `waitUntil`
 *   so Redis cleanup and cache writes can continue after the response.
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
    options?: BackgroundTaskOptions
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

    if (meta && meta.symbol !== undefined && meta.timeframe !== undefined) {
        if (isFallbackAnalysis(reconciled)) {
            console.warn(
                '[Poll] Worker returned empty analysis; skipping cache write',
                { jobId, symbol: meta.symbol }
            );
        } else {
            const cache = createCacheProvider();
            if (cache !== null) {
                // Fold the same skill-catalog fingerprint the submit path used
                // so this write lands under the exact key that path will read.
                // Intentionally fingerprints this path's own provider-loaded
                // `skills` (the load that fed enrichAnalysisWithConfidence above)
                // rather than calling the shared getSkillCatalogFingerprint
                // helper, so the cached fingerprint always matches the catalog
                // actually used to produce this result.
                const cacheKey = buildAnalysisCacheKey(
                    meta.symbol,
                    meta.timeframe,
                    meta.modelId,
                    hashSkillCatalog(skills)
                );
                const ttl = computeEffectiveTtl(meta.timeframe, now);
                fireAndForget(
                    cache
                        .set(cacheKey, { ...result, skillsDegraded }, ttl)
                        .catch(error =>
                            console.error('[Poll] Cache write failed:', error)
                        ),
                    options
                );
            }
        }
    }

    cleanupInBackground(jobId, '[Poll]', options);

    return { status: 'done', result };
}
