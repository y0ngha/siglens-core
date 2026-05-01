import { cleanupInBackground, fireAndForget } from '@/application/background';
import type { BackgroundTaskOptions } from '@/application/types';
import { enrichAnalysisWithConfidence } from '@/domain/analysis/confidence';
import { postProcessAnalysisWithReconcile } from '@/domain/analysis/ai-levels';
import type {
    PollAnalysisResult,
    RawAnalysisResponse,
    Skill,
} from '@/domain/types';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import {
    buildAnalysisCacheKey,
    computeEffectiveTtl,
} from '@/infrastructure/cache/config';
import {
    getJobError,
    getJobMeta,
    getJobResult,
    getJobStatus,
} from '@/infrastructure/jobs/queue';
import { FileSkillsLoader } from '@/infrastructure/skills/loader';

// Matches DEFAULT_ANALYSIS_MODEL_USED in submitAnalysis.ts; update both if changed
const DEFAULT_ANALYSIS_MODEL_USED = 'analysis-worker';

/**
 * Poll the result of an analysis job submitted via {@link submitAnalysis}.
 *
 * Returns one of three outcomes:
 * - `processing`: the worker has not finished yet. Caller should retry.
 * - `error`: the worker reported a failure, the result was missing, or the
 *   payload was malformed (`summary` / `trend` / `riskLevel` field absent).
 * - `done`: the result is ready. The raw worker response is enriched with
 *   skill-confidence weighting and reconciled against the latest close/ATR,
 *   then cached for the remaining timeframe-aware TTL before being returned.
 *
 * On `error` and `done`, the job's Redis state is cleaned up via `cleanupJob`
 * (best-effort — cleanup failures are logged but do not affect the return
 * value). Skill loading at poll time is best-effort, falling back to an empty
 * skill list if it fails.
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

    // getJobResult는 JSON.parse 결과를 반환하므로 unknown에서 Record<string, unknown>으로의
    // 캐스트는 필드 존재 확인을 위한 안전한 타입 축소이다.
    const candidate = rawResult as Record<string, unknown>;
    if (!candidate.summary || !candidate.trend || !candidate.riskLevel) {
        cleanupInBackground(jobId, '[Poll]', options);
        return { status: 'error', error: 'Invalid response from worker' };
    }
    // summary/trend/riskLevel 필드 확인 통과; submitAnalysis가 JSON.stringify(RawAnalysisResponse)로
    // 저장하고 getJobResult가 JSON.parse 후 반환하므로 구조가 RawAnalysisResponse와 일치한다.
    const parsed = rawResult as RawAnalysisResponse;

    const skillsLoader = new FileSkillsLoader();
    const skills = await skillsLoader.loadSkills().catch(error => {
        console.error(
            '[Poll] Skills loading failed, proceeding without skills:',
            error
        );
        return [] as Skill[];
    });
    const skillsDegraded = meta?.skillsDegraded ?? false;

    const enriched = enrichAnalysisWithConfidence(parsed, skills);

    const reconciled = postProcessAnalysisWithReconcile(
        enriched,
        meta?.lastClose,
        meta?.atr
    );

    const now = new Date();
    const analyzedAt = now.toISOString();
    const result = { ...reconciled, analyzedAt };

    if (meta) {
        const cache = createCacheProvider();
        if (cache !== null) {
            const cacheKey = buildAnalysisCacheKey(
                meta.symbol,
                meta.timeframe,
                meta.modelId ?? DEFAULT_ANALYSIS_MODEL_USED
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

    cleanupInBackground(jobId, '[Poll]', options);

    return { status: 'done', result };
}
