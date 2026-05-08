import { fireAndForget } from '@/application/background';
import { fetchBarsWithIndicators } from '@/application/market/barsApi';
import { buildUserApiKeyRequiredError } from '@/application/byok/gate';
import { hashAnalysisInput } from '@/infrastructure/hash/analysisInput';
import { resolveOverallDependencies } from '@/application/overall/dependencyResolver';
import type {
    SubmitOverallAnalysisApiKeyRequiredError,
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
import { DEFAULT_TIER, requiresByokKey, TIER_CONFIG } from '@/domain/tier';
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
/**
 * Unwrap an axis-error result into its user-facing payload.
 *
 * Every non-BYOK variant in `DependencyStateError['error']` carries either an
 * `error` field (string or structured limit error) or a `code` field (e.g.
 * `SubmitFundamentalAnalysisFetchError` with `code: 'fetch_failed'`). If the
 * union grows to include a variant lacking both fields, the exhaustiveness
 * assignment below turns it into a compile error rather than a silent runtime
 * fallback.
 */
function unwrapAxisError(
    err: { error: unknown } | { code: unknown }
): unknown {
    if ('error' in err) return err.error;
    if ('code' in err) return String(err.code);
    // Unreachable for the current union — adding a variant without `error` or
    // `code` will cause a type error on the line below.
    const _exhaustive: never = err;
    return _exhaustive;
}

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

    const tier = options.tier ?? DEFAULT_TIER;
    const tierConfig = options.tierConfig ?? TIER_CONFIG;

    // ── 0. BYOK gate for overall job's own AI call ──
    // Sync, cheap check — fires first so we avoid an async DB call when the
    // request is blocked at the key level. Consistent with the other 3 submit
    // functions (market, fundamental, news) which also run BYOK before usage.
    if (
        requiresByokKey(tier, modelId, tierConfig) &&
        options.userApiKey === undefined
    ) {
        return buildUserApiKeyRequiredError(tier, modelId);
    }

    // ── 0a. Overall-scoped usage limit check ──
    // Owned at this layer (not per axis) so one overall request counts as
    // exactly one analysis. The dependency resolver drops `usage` from each
    // axis's forwarded options (see dropAxisUsage below) to prevent
    // triple-counting.
    if (options.tier !== undefined && usage !== undefined) {
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
        // If an axis returned a BYOK error, re-surface it at the overall level
        // so consumers get a uniform `key_error` shape regardless of which axis
        // (or top-level model) triggered the BYOK requirement.
        // `deps.error` is now a typed union — narrow directly on the discriminant.
        if (deps.error.status === 'key_error') {
            // (a) TS cannot fully narrow through the nested SubmitAnalysisErrorResult union
            // after the status === 'key_error' check — the discriminant lives one level
            // inside the union-of-unions, which TS cannot resolve to a single leaf type.
            // (b) Runtime safety: all BYOK error variants (SubmitAnalysis/Fundamental/News
            // ApiKeyRequiredError) are type aliases for UserApiKeyRequiredError — identical
            // shape at runtime.
            return deps.error as SubmitOverallAnalysisApiKeyRequiredError;
        }
        // For non-BYOK errors (status === 'error' on each axis), unwrap the inner
        // `.error` field for backward-compatible SubmitOverallAnalysisError shape.
        return {
            status: 'error',
            axis: deps.axis,
            error: unwrapAxisError(deps.error),
        };
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

    // Daily fearGreed snapshot — injected as the sentiment context for the overall prompt.
    // Computed directly from daily raw data rather than reusing the technical-axis
    // result, so the daily-only assumption holds regardless of timeframe.
    // On compute failure, log and fall back to fearGreed=null so the overall analysis proceeds.
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

    const userApiKeyHeader: Record<string, string> =
        options.userApiKey !== undefined
            ? { 'X-AI-API-KEY': options.userApiKey }
            : {};

    const dispatch = fetch(`${workerUrl}/analyze`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Worker-Secret': workerSecret,
            ...userApiKeyHeader,
        },
        body: JSON.stringify({ jobId, prompt, model: modelId, tier }),
        signal: AbortSignal.timeout(SUBMIT_OVERALL_ANALYSIS_TIMEOUT_MS),
    }).catch(error => {
        console.error('[submitOverallAnalysis] Worker request failed:', error);
    });
    fireAndForget(dispatch, options);

    await recordAnalysisUsageSafely(usage, modelId, occurredAt);

    return { status: 'submitted', jobId };
}
