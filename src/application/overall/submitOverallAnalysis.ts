import { fireAndForget } from '@/application/background';
import { fetchBarsWithIndicators } from '@/application/market/barsApi';
import { hashAnalysisInput } from '@/infrastructure/hash/analysisInput';
import { resolveOverallDependencies } from '@/application/overall/dependencyResolver';
import type {
    SubmitOverallAnalysisOptions,
    SubmitOverallAnalysisResult,
} from '@/application/overall/types';
import {
    buildUsageLimitError,
    checkAnalysisUsageAllowed,
    recordAnalysisUsageSafely,
} from '@/application/usage';
import { normalizeOverallAnalysisResponse } from '@/domain/analysis/normalizeOverall';
import { buildOverallAnalysisPrompt } from '@/domain/analysis/overallPrompt';
import { MS_PER_MINUTE } from '@/domain/constants/time';
import { computeFearGreedIndex } from '@/domain/indicators/fearGreed';
import { TIER_CONFIG } from '@/domain/tier';
import { buildOverallCacheKey } from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { readWorkerConfig } from '@/infrastructure/market/config';
import type {
    AnalysisResponse,
    FearGreedSnapshot,
    OverallAnalysisResponse,
} from '@/domain/types';

/** Maximum time to wait for the worker to accept the overall analysis job. */
const SUBMIT_OVERALL_ANALYSIS_TIMEOUT_MS = 5 * MS_PER_MINUTE;

/**
 * Strip volatile, write-time-only fields from a cached technical
 * `AnalysisResponse` so the overall input hash stays stable across polls.
 *
 * `analyzedAt` is rewritten on every `pollAnalysis` call; `skillsDegraded`
 * is a transient loader-health flag that is sometimes attached to the
 * cached body. Neither belongs in the hashing surface.
 */
function stripVolatileTechnicalFields(
    technical: AnalysisResponse
): Omit<AnalysisResponse, 'analyzedAt'> {
    // Cast widens the static AnalysisResponse type to include the runtime-only
    // `skillsDegraded` field that pollAnalysis attaches before caching
    // (see pollAnalysis.ts:134). Both volatile fields are then stripped via
    // destructuring to avoid imperative mutation (no `delete`).
    const {
        analyzedAt: _analyzedAt,
        skillsDegraded: _skillsDegraded,
        ...rest
    } = technical as AnalysisResponse & { skillsDegraded?: boolean };
    return rest;
}

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
    const { symbol, companyName = symbol, timeframe, modelId } = options;
    const usage = options.usage;
    const occurredAt = options.now ?? usage?.occurredAt ?? new Date();

    // ── 0. Overall-scoped usage limit check ──
    // Owned at this layer (not per axis) so one overall request counts as
    // exactly one analysis. The dependency resolver drops `usage` from each
    // axis's forwarded options (see dropAxisUsage below) to prevent
    // triple-counting.
    if (options.tier !== undefined && usage !== undefined) {
        const tier = options.tier;
        const tierConfig = options.tierConfig ?? TIER_CONFIG;
        const allowed = await checkAnalysisUsageAllowed(
            usage,
            tier,
            occurredAt,
            tierConfig
        );
        if (!allowed) {
            return {
                status: 'limit_error',
                code: 'usage_limit_exceeded',
                error: buildUsageLimitError('analysisPerDay', tier),
            };
        }
    }

    // ── 1. Resolve all three dependency axes in parallel ──
    // `dropAxisUsage: true` ensures axis submits never check or record usage
    // when invoked from overall — one overall call = one analysis recorded.
    const deps = await resolveOverallDependencies(options, {
        dropAxisUsage: true,
    });

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
    // Strip volatile fields from each axis result before hashing so that
    // re-polling a stable analysis produces the same overall cache key.
    // - `analyzedAt` is set per poll on the technical axis (see pollAnalysis)
    //   and would otherwise invalidate the overall cache on every poll.
    // - `skillsDegraded` is a transient flag attached to the cached technical
    //   result; it reflects loader health at write time, not analysis content.
    const stableTechnical = stripVolatileTechnicalFields(deps.technical);
    const inputHash = hashAnalysisInput(
        JSON.stringify({
            t: stableTechnical,
            f: deps.fundamental,
            n: deps.news,
        })
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
            // Lightweight structural validation — schema drift from a prior
            // release should fall through as a cache miss rather than poison
            // the response. The schema-version prefix on the cache key is the
            // primary invalidation lever (see CACHE_KEY_SCHEMA_VERSION); this
            // check is a belt-and-braces fallback.
            if (cached !== null) {
                const result = normalizeOverallAnalysisResponse(cached);
                await recordAnalysisUsageSafely(usage, modelId, occurredAt);
                return { status: 'cached', result };
            }
        } catch (error) {
            console.error('[submitOverallAnalysis] Cache read failed:', error);
        }
    }

    // ── 3. Build prompt, enqueue job, fire-and-forget worker POST ──
    const { workerUrl, workerSecret } = readWorkerConfig();

    // 일봉 fearGreed snapshot — overall 프롬프트의 sentiment 컨텍스트로 주입.
    // technical 축의 결과를 그대로 사용하지 않고 일봉 raw 데이터로부터 직접
    // 산출해 daily-only 가정을 유지한다 (timeframe과 무관). 산출 실패 시
    // fearGreed=null 로 fallback해 overall 분석 자체는 진행한다.
    const fmpSymbol = options.technical.fmpSymbol;
    const fearGreed: FearGreedSnapshot | null = await fetchBarsWithIndicators(
        symbol,
        '1Day',
        fmpSymbol
    )
        .then(d => computeFearGreedIndex(d.bars, d.indicators.buySellVolume))
        .catch(error => {
            console.error(
                '[submitOverallAnalysis] FearGreed daily fetch/compute failed; proceeding without sentiment:',
                error
            );
            return null;
        });

    const prompt = buildOverallAnalysisPrompt(
        symbol,
        companyName,
        deps.technical,
        deps.fundamental,
        deps.news,
        timeframe,
        fearGreed ?? undefined
    );
    const jobId = crypto.randomUUID();

    await setJobMeta(jobId, {
        symbol,
        timeframe,
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

    await recordAnalysisUsageSafely(usage, modelId, occurredAt);

    return { status: 'submitted', jobId };
}
