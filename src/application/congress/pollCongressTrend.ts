import { cleanupInBackground, fireAndForget } from '@/application/background';
import type { BackgroundTaskOptions } from '@/application/types';
import type { PollCongressTrendResult } from '@/application/congress/types';
import { normalizeCongressTrendResponse } from '@/domain/analysis/normalizeCongressTrend';
import type { CongressTrendResponse } from '@/domain/types';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { CONGRESS_CACHE_TTL_SECONDS } from '@/infrastructure/cache/config';
import {
    getJobError,
    getJobMeta,
    getJobResult,
    getJobStatus,
} from '@/infrastructure/jobs/queue';

type NormalizeResult =
    | { ok: true; value: CongressTrendResponse }
    | { ok: false };

/**
 * Normalize the raw worker result, returning a tagged result object so the
 * success value can bind to a `const` (no `let` reassignment across the
 * try/catch). The congress normalizer defends every field but the JSON parse
 * inside it can throw on a non-JSON string — that case routes to `{ ok: false }`.
 */
function tryNormalizeCongressTrendResult(raw: unknown): NormalizeResult {
    try {
        return { ok: true, value: normalizeCongressTrendResponse(raw) };
    } catch (error) {
        console.error('[PollCongress] Normalization failed:', error);
        return { ok: false };
    }
}

/**
 * Poll the result of a congress trend analysis job submitted via
 * {@link submitCongressTrend}.
 *
 * Mirrors {@link pollFinancialsAnalysis}. Returns one of three outcomes:
 * - `processing`: the worker has not finished yet. Caller should retry.
 * - `error`: the worker reported a failure, the result was missing, or the
 *   payload could not be normalized.
 * - `done`: the result is ready. The raw worker response is normalized via
 *   {@link normalizeCongressTrendResponse} and cached under the pre-computed
 *   `cacheKey` from job metadata (TTL {@link CONGRESS_CACHE_TTL_SECONDS}) before
 *   being returned.
 *
 * On `error` and `done`, the job's Redis state is cleaned up via
 * `cleanupInBackground` (best-effort — failures are logged, not surfaced).
 *
 * **Empty-response handling:** a structurally malformed payload (the normalizer
 * never throws — it defends every field — but the JSON parse inside it can throw
 * on a non-JSON string) routes to `error` before any cache write. A
 * content-empty payload (valid JSON normalizing to empty strings/arrays) emits a
 * `console.warn` and is still cached + returned as `done` so the caller can
 * surface it.
 *
 * @param jobId - The `jobId` returned by {@link submitCongressTrend}.
 * @param options - Optional background-task hooks. Pass Vercel's `waitUntil` so
 *   Redis cleanup and cache writes can continue after the response.
 * @returns The current poll outcome — see {@link PollCongressTrendResult}.
 *
 * @see submitCongressTrend
 * @see cancelCongressTrendJob
 */
export async function pollCongressTrend(
    jobId: string,
    options?: BackgroundTaskOptions
): Promise<PollCongressTrendResult> {
    const status = await getJobStatus(jobId);

    if (status === null || status === 'processing') {
        return { status: 'processing' };
    }

    if (status === 'error') {
        const error = await getJobError(jobId);
        cleanupInBackground(jobId, '[PollCongress]', options);
        return { status: 'error', error: error ?? 'Unknown error' };
    }

    // status === 'done'
    const [rawResult, meta] = await Promise.all([
        getJobResult(jobId),
        getJobMeta(jobId),
    ]);

    if (!rawResult) {
        console.error('[PollCongress] Result not found', {
            jobId,
            hasMeta: meta !== null,
            symbol: meta?.symbol,
        });
        cleanupInBackground(jobId, '[PollCongress]', options);
        return { status: 'error', error: 'Result not found' };
    }

    // The worker stores the raw LLM response as a JSON string or object.
    // Normalize it through the congress response normalizer via the module-level
    // tagged-result helper so the success value can bind to a `const`.
    const normalizeResult = tryNormalizeCongressTrendResult(rawResult);

    if (!normalizeResult.ok) {
        cleanupInBackground(jobId, '[PollCongress]', options);
        return { status: 'error', error: 'Invalid response from worker' };
    }

    const result: CongressTrendResponse = normalizeResult.value;

    if (result.summaryKo === '' && result.notableMembersKo.length === 0) {
        console.warn('[PollCongress] Empty congress trend analysis', { jobId });
    }

    // Cache the normalized result if a pre-computed cache key is available.
    if (meta?.cacheKey) {
        const cache = createCacheProvider();
        if (cache !== null) {
            fireAndForget(
                cache
                    .set(meta.cacheKey, result, CONGRESS_CACHE_TTL_SECONDS)
                    .catch(error =>
                        console.error(
                            '[PollCongress] Cache write failed:',
                            error
                        )
                    ),
                options
            );
        }
    }

    cleanupInBackground(jobId, '[PollCongress]', options);

    return { status: 'done', result };
}
