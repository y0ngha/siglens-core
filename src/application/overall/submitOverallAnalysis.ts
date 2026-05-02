import { fireAndForget } from '@/application/background';
import { hashAnalysisInput } from '@/application/analysisInputHash';
import { resolveOverallDependencies } from '@/application/overall/dependencyResolver';
import type {
    SubmitOverallAnalysisOptions,
    SubmitOverallAnalysisResult,
} from '@/application/overall/types';
import { buildOverallAnalysisPrompt } from '@/domain/analysis/overallPrompt';
import { MS_PER_MINUTE } from '@/domain/constants/time';
import { buildOverallCacheKey } from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { readWorkerConfig } from '@/infrastructure/market/config';
import type { OverallAnalysisResponse } from '@/domain/types';

/** Maximum time to wait for the worker to accept the overall analysis job. */
const SUBMIT_OVERALL_ANALYSIS_TIMEOUT_MS = 5 * MS_PER_MINUTE;

/**
 * Submit an overall (3-axis: technical + fundamental + news) analysis job.
 *
 * Resolves to one of three outcomes:
 * - `cached`: a recent overall analysis is reused (keyed by `symbol` +
 *   `timeframe` + `modelId` + an input hash of the three dependency results).
 * - `submitted`: all dependencies were resolved from cache, the prompt was
 *   built, a `jobId` was registered, and a fire-and-forget HTTP POST was sent
 *   to the configured worker. Poll with {@link pollOverallAnalysis}.
 * - `pending_dependencies`: one or more dependency axes (technical,
 *   fundamental, or news) are still processing. The caller should poll each
 *   `pendingJobs` entry by its `jobId`, then retry this function once all
 *   three have resolved. No cache lookup or job submission is performed until
 *   all dependencies are available.
 *
 * @param options - Dependency inputs (symbol, timeframe, model, providers,
 *   news, calendar) and optional background-task hooks.
 * @returns The submission outcome — see {@link SubmitOverallAnalysisResult}.
 *
 * @example
 * ```ts
 * const res = await submitOverallAnalysis({ symbol: 'AAPL', timeframe: '1Day', modelId: '...', ... });
 * if (res.status === 'cached') return res.result;
 * if (res.status === 'pending_dependencies') return { retry: res.pendingJobs };
 * const polled = await pollOverallAnalysis(res.jobId);
 * ```
 *
 * @see pollOverallAnalysis
 * @see cancelOverallAnalysisJob
 */
export async function submitOverallAnalysis(
    options: SubmitOverallAnalysisOptions
): Promise<SubmitOverallAnalysisResult> {
    const { symbol, timeframe, modelId } = options;

    // ── 1. Resolve all three dependency axes in parallel ──
    const deps = await resolveOverallDependencies(options);

    if (deps.kind === 'error') {
        // One axis failed — return immediately without cache lookup or job submission.
        return { status: 'error', axis: deps.axis, error: deps.error };
    }

    if (deps.kind === 'pending') {
        // One or more axes are still processing — surface pending state to caller.
        return {
            status: 'pending_dependencies',
            pendingJobs: {
                technical: deps.pendingJobs.technical,
                fundamental: deps.pendingJobs.fundamental,
                news: deps.pendingJobs.news,
            },
        };
    }

    // ── 2. All three cached — hash combined inputs and check overall cache ──
    const inputHash = hashAnalysisInput(
        JSON.stringify({ t: deps.technical, f: deps.fundamental, n: deps.news })
    );
    const cacheKey = buildOverallCacheKey(
        symbol,
        timeframe,
        modelId,
        inputHash
    );
    const cache = createCacheProvider();

    if (cache !== null) {
        try {
            const cached = await cache.get<OverallAnalysisResponse>(cacheKey);
            if (cached !== null) {
                return { status: 'cached', result: cached };
            }
        } catch (error) {
            console.error('[submitOverallAnalysis] Cache read failed:', error);
        }
    }

    // ── 3. Build prompt, enqueue job, fire-and-forget worker POST ──
    const { workerUrl, workerSecret } = readWorkerConfig();
    const prompt = buildOverallAnalysisPrompt(
        symbol,
        deps.technical,
        deps.fundamental,
        deps.news,
        timeframe
    );
    const jobId = crypto.randomUUID();

    await setJobMeta(jobId, {
        symbol,
        modelId,
        cacheKey,
    });

    const dispatch = fetch(`${workerUrl}/analyze`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Worker-Secret': workerSecret,
        },
        body: JSON.stringify({ jobId, prompt, model: modelId }),
        signal: AbortSignal.timeout(SUBMIT_OVERALL_ANALYSIS_TIMEOUT_MS),
    }).catch(error => {
        console.error('[submitOverallAnalysis] Worker request failed:', error);
    });
    fireAndForget(dispatch, options);

    return { status: 'submitted', jobId };
}
