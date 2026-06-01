import { fireAndForget } from '@/application/background';
import { fetchBarsWithIndicators } from '@/application/market/barsApi';
import { buildUserApiKeyRequiredError } from '@/application/byok/gate';
import type {
    SubmitAnalysisGatedResult,
    SubmitAnalysisOptions,
} from '@/application/market/types';
import {
    buildUsageLimitError,
    checkAnalysisUsageAllowed,
    recordAnalysisUsageSafely,
} from '@/application/usage';
import { normalizeCachedAnalysisResponse } from '@/domain/analysis/confidence';
import { AI_SYSTEM_PROMPT } from '@/domain/analysis/systemPrompt';
import { buildAnalysisPrompt } from '@/domain/analysis/prompt';
import { TECHNICAL_RESPONSE_SCHEMA } from '@/domain/analysis/responseSchemas';
import { MS_PER_MINUTE } from '@/domain/constants/time';
import { computeFearGreedIndex } from '@/domain/indicators/fearGreed';
import { lastNonNull } from '@/domain/indicators/utils';
import {
    DEFAULT_TIER,
    TIER_CONFIG,
    getAllowedTimeframes,
    isTimeframeAllowed,
    requiresByokKey,
} from '@/domain/tier';
import type {
    AnalysisResponse,
    AnalysisType,
    FearGreedSnapshot,
    Timeframe,
} from '@/domain/types';
import {
    buildAnalysisCacheKey,
    DEFAULT_ANALYSIS_MODEL_ID,
} from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import {
    analysisSeed,
    hashSkillCatalog,
} from '@/infrastructure/hash/analysisInput';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { readWorkerConfig } from '@/infrastructure/market/config';
import { loadSkillsCached } from '@/infrastructure/skills/loader';

const SUBMIT_ANALYSIS_TIMEOUT_MS = 5 * MS_PER_MINUTE;
const TIMEFRAMES: readonly Timeframe[] = [
    '5Min',
    '15Min',
    '30Min',
    '1Hour',
    '4Hour',
    '1Day',
];

function isTimeframe(value: unknown): value is Timeframe {
    return (
        typeof value === 'string' &&
        (TIMEFRAMES as readonly string[]).includes(value)
    );
}

interface ResolvedSubmitAnalysisArgs {
    companyName: string;
    timeframe: Timeframe;
    force: boolean;
    fmpSymbol: string | undefined;
    options: SubmitAnalysisOptions;
}

function resolveSubmitAnalysisArgs(
    symbol: string,
    companyNameOrTimeframe: string,
    timeframeOrForce?: Timeframe | boolean,
    forceOrFmpSymbol?: boolean | string,
    fmpSymbolOrOptions?: string | SubmitAnalysisOptions,
    maybeOptions?: SubmitAnalysisOptions
): ResolvedSubmitAnalysisArgs {
    if (isTimeframe(companyNameOrTimeframe)) {
        return {
            companyName: symbol,
            timeframe: companyNameOrTimeframe,
            force:
                typeof timeframeOrForce === 'boolean'
                    ? timeframeOrForce
                    : false,
            fmpSymbol:
                typeof forceOrFmpSymbol === 'string'
                    ? forceOrFmpSymbol
                    : undefined,
            options:
                typeof fmpSymbolOrOptions === 'object' &&
                fmpSymbolOrOptions !== null
                    ? fmpSymbolOrOptions
                    : {},
        };
    }

    return {
        companyName: companyNameOrTimeframe,
        timeframe: timeframeOrForce as Timeframe,
        force: typeof forceOrFmpSymbol === 'boolean' ? forceOrFmpSymbol : false,
        fmpSymbol:
            typeof fmpSymbolOrOptions === 'string'
                ? fmpSymbolOrOptions
                : undefined,
        options:
            maybeOptions ??
            (typeof fmpSymbolOrOptions === 'object' &&
            fmpSymbolOrOptions !== null
                ? fmpSymbolOrOptions
                : {}),
    };
}

/**
 * Submit an analysis job for a given symbol/timeframe.
 *
 * Resolves to one of four outcomes:
 * - `cached`: a recent analysis is reused (within `ANALYSIS_CACHE_TTL`, keyed
 *   by `symbol` + `timeframe` + `modelId`).
 * - `submitted`: the bars + indicators were fetched, the prompt was built, a
 *   `jobId` was registered with the job queue, and a fire-and-forget HTTP
 *   POST was sent to the configured worker. Poll the result with
 *   {@link pollAnalysis}.
 * - `miss_no_trigger`: the cache missed but no job was enqueued because
 *   `options.skipEnqueueIfMiss` was set. The consumer should render a
 *   fallback in this case (typically used for bot/crawler gating).
 * - `error`: application tier gates blocked access to the requested timeframe,
 *   or the daily analysis usage limit was exceeded.
 *
 * Skill loading is best-effort — if it fails, the analysis proceeds with
 * `skillsDegraded: true` recorded on the job meta so consumers can warn the
 * user. The worker call uses a 5-minute `AbortSignal.timeout`; failures are
 * logged but do not propagate to the caller (the job stays in `processing`
 * until it times out naturally).
 *
 * @param symbol - U.S. equity ticker (e.g. `"AAPL"`).
 * @param timeframe - Bar resolution literal (`"5Min" | "15Min" | ... | "1Day"`).
 * @param force - When `true`, bypass the cache and always submit a new job.
 *   Defaults to `false`.
 * @param fmpSymbol - Optional override symbol forwarded to the market data
 *   provider when FMP uses a different identifier.
 * @param options - Optional tier gating, usage limit tracking, and background-task
 *   hooks. Pass Vercel's `waitUntil` so the worker dispatch can continue after
 *   the response. Pass `usage` to enable daily usage limit checking and recording.
 *   Pass `modelId` to scope the cache to a specific AI model identifier.
 *   Pass `marketDataProvider` when a cache miss is possible — it is required at
 *   the fetch site and omitting it on a cache miss will throw a clear runtime error.
 * @returns Either a cached analysis or a freshly submitted job descriptor —
 *   see {@link SubmitAnalysisGatedResult}.
 *
 * @throws {Error} If `options.marketDataProvider` is absent on a cache miss,
 *   if the market data provider rejects (`fetchBarsWithIndicators` throws),
 *   or if `WORKER_URL` / `WORKER_SECRET` are missing in env.
 *
 * @example
 * ```ts
 * // `marketDataProvider` is injected by the consumer (e.g. the siglens app):
 * const submission = await submitAnalysis('AAPL', '1Day', false, undefined, {
 *     marketDataProvider,
 * });
 * if (submission.status === 'cached') return submission.result;
 * if (submission.status === 'miss_no_trigger') return null;
 * if (submission.status === 'error') return submission.error;
 * const polled = await pollAnalysis(submission.jobId);
 * ```
 *
 * @see pollAnalysis
 * @see cancelAnalysisJob
 */
export async function submitAnalysis(
    symbol: string,
    timeframe: Timeframe,
    force?: boolean,
    fmpSymbol?: string,
    options?: SubmitAnalysisOptions
): Promise<SubmitAnalysisGatedResult>;
export async function submitAnalysis(
    symbol: string,
    companyName: string,
    timeframe: Timeframe,
    force?: boolean,
    fmpSymbol?: string,
    options?: SubmitAnalysisOptions
): Promise<SubmitAnalysisGatedResult>;
export async function submitAnalysis(
    symbol: string,
    companyNameOrTimeframe: string,
    timeframeOrForce?: Timeframe | boolean,
    forceOrFmpSymbol?: boolean | string,
    fmpSymbolOrOptions?: string | SubmitAnalysisOptions,
    maybeOptions?: SubmitAnalysisOptions
): Promise<SubmitAnalysisGatedResult> {
    const { companyName, timeframe, force, fmpSymbol, options } =
        resolveSubmitAnalysisArgs(
            symbol,
            companyNameOrTimeframe,
            timeframeOrForce,
            forceOrFmpSymbol,
            fmpSymbolOrOptions,
            maybeOptions
        );

    const tier = options.tierContext?.tier ?? DEFAULT_TIER;
    const tierConfig = options.tierConfig ?? TIER_CONFIG;

    if (!isTimeframeAllowed(tier, timeframe, tierConfig)) {
        return {
            status: 'error',
            error: {
                code: 'timeframe_not_allowed',
                message: `Timeframe ${timeframe} is not available for ${tier} tier.`,
                tier,
                timeframe,
                allowedTimeframes: getAllowedTimeframes(tier, tierConfig),
            },
        };
    }

    const effectiveModelId = options.modelId ?? DEFAULT_ANALYSIS_MODEL_ID;
    // `options.modelId` is a TierModel; the default 'analysis-worker' is a
    // platform routing token, not a user-selectable model, so it is never premium.
    // requiresByokKey is only called when options.modelId is set — DEFAULT_ANALYSIS_MODEL_ID
    // is not a TierModel and not in any config.models.* list, so requiresByokKey
    // would erroneously return true for it.
    if (
        options.modelId !== undefined &&
        requiresByokKey(tier, options.modelId, tierConfig) &&
        options.userApiKey === undefined
    ) {
        // Safe: the outer `options.modelId !== undefined` guard narrows the type.
        return buildUserApiKeyRequiredError(tier, options.modelId);
    }

    const usage = options.usage;
    const usageOccurredAt = usage?.occurredAt ?? new Date();

    if (usage !== undefined) {
        const allowed = await checkAnalysisUsageAllowed(
            usage,
            tier,
            usageOccurredAt,
            tierConfig
        );
        if (!allowed) {
            return {
                status: 'error',
                error: buildUsageLimitError('analysisPerDay', tier),
            };
        }
    }

    // Load the skill catalog up front: `skills` feeds the prompt builder and
    // `skillsDegraded` is recorded on the job meta. The cache-key fingerprint is
    // hashed directly from the `skills` already in hand (same hashSkillCatalog the
    // shared helper uses), so the write key here matches what the poll/peek read
    // paths reproduce without re-invoking the loader.
    const { skills, skillsDegraded } = await loadSkillsCached();
    const skillFingerprint = hashSkillCatalog(skills);

    const cache = createCacheProvider();
    const cacheKey = buildAnalysisCacheKey(
        symbol,
        timeframe,
        effectiveModelId,
        skillFingerprint
    );

    if (!force && cache !== null) {
        try {
            const cached = await cache.get<AnalysisResponse>(cacheKey);
            if (cached !== null) {
                const result = normalizeCachedAnalysisResponse(cached);
                await recordAnalysisUsageSafely(
                    usage,
                    effectiveModelId,
                    usageOccurredAt
                );
                return { status: 'cached', result };
            }
        } catch (error) {
            console.error('[Submit] Cache read failed:', error);
        }
    }

    if (options.skipEnqueueIfMiss) {
        return { status: 'miss_no_trigger' };
    }

    const { marketDataProvider } = options;
    if (marketDataProvider == null) {
        throw new Error(
            'submitAnalysis: options.marketDataProvider is required to fetch bars on a cache miss'
        );
    }

    const { workerUrl, workerSecret } = readWorkerConfig();

    const { bars, indicators } = await fetchBarsWithIndicators(
        marketDataProvider,
        symbol,
        timeframe,
        fmpSymbol
    );

    // Daily fearGreed snapshot — injected as the sentiment context for the analysis prompt.
    // When timeframe is '1Day', reuse the already-fetched bars; otherwise fetch daily separately.
    // On daily-fetch failure, log and fall back to fearGreed=null so the analysis itself proceeds.
    const dailyDataPromise =
        timeframe === '1Day'
            ? Promise.resolve({ bars, indicators })
            : fetchBarsWithIndicators(
                  marketDataProvider,
                  symbol,
                  '1Day',
                  fmpSymbol
              );

    const fearGreed: FearGreedSnapshot | null = await dailyDataPromise
        .then(d => computeFearGreedIndex(d.bars, d.indicators.buySellVolume))
        .catch(error => {
            console.error(
                '[Submit] FearGreed daily fetch/compute failed; proceeding without sentiment:',
                error
            );
            return null;
        });

    const prompt = buildAnalysisPrompt(
        symbol,
        companyName,
        bars,
        indicators,
        skills,
        timeframe,
        fearGreed ?? undefined
    );

    const jobId = crypto.randomUUID();
    const lastClose = bars[bars.length - 1]?.close;
    const atr = lastNonNull(indicators.atr) ?? undefined;
    await setJobMeta(jobId, {
        symbol,
        timeframe,
        skillsDegraded,
        lastClose,
        atr,
        modelId: effectiveModelId,
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
        body: JSON.stringify({
            jobId,
            prompt,
            seed: analysisSeed(prompt),
            model: effectiveModelId,
            tier,
            analysisType: 'technical' satisfies AnalysisType,
            system: AI_SYSTEM_PROMPT,
            responseSchema: TECHNICAL_RESPONSE_SCHEMA,
        }),
        signal: AbortSignal.timeout(SUBMIT_ANALYSIS_TIMEOUT_MS),
    }).catch(error => {
        console.error('[Submit] Worker request failed:', error);
    });
    fireAndForget(dispatch, options);

    await recordAnalysisUsageSafely(usage, effectiveModelId, usageOccurredAt);

    return { status: 'submitted', jobId };
}
