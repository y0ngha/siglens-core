import { fireAndForget } from '@/application/background';
import { fetchBarsWithIndicators } from '@/application/market/barsApi';
import type {
    AnalysisUsageOptions,
    SubmitAnalysisGatedResult,
    SubmitAnalysisOptions,
} from '@/application/market/types';
import { buildUsageLimitError, checkAnalysisLimit } from '@/application/usage';
import { buildAnalysisPrompt } from '@/domain/analysis/prompt';
import { MS_PER_MINUTE } from '@/domain/constants/time';
import { lastNonNull } from '@/domain/indicators/utils';
import {
    DEFAULT_TIER,
    TIER_CONFIG,
    getAllowedTimeframes,
    isTimeframeAllowed,
} from '@/domain/tier';
import type {
    AnalysisResponse,
    Skill,
    Tier,
    TierConfig,
    Timeframe,
} from '@/domain/types';
import { buildAnalysisCacheKey } from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { hashUsageIp } from '@/infrastructure/db';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { readWorkerConfig } from '@/infrastructure/market/config';
import { FileSkillsLoader } from '@/infrastructure/skills/loader';

const SUBMIT_ANALYSIS_TIMEOUT_MS = 5 * MS_PER_MINUTE;
const DEFAULT_ANALYSIS_MODEL_USED = 'analysis-worker';

async function checkAnalysisUsageAllowed(
    usage: AnalysisUsageOptions,
    tier: Tier,
    occurredAt: Date,
    tierConfig: TierConfig
): Promise<boolean> {
    const ipHash = hashUsageIp(usage.clientIp, occurredAt);
    return checkAnalysisLimit(
        {
            ipHash,
            tier,
            now: occurredAt,
            config: tierConfig,
        },
        { usage: usage.usageRepository }
    );
}

async function recordAnalysisUsage(
    usage: SubmitAnalysisOptions['usage'],
    occurredAt?: Date
): Promise<void> {
    if (usage === undefined) return;

    await usage.usageRepository.recordUsage({
        userId: usage.userId ?? null,
        ipAddress: usage.clientIp,
        actionType: 'analysis',
        modelUsed: usage.modelUsed ?? DEFAULT_ANALYSIS_MODEL_USED,
        occurredAt,
    });
}

async function recordAnalysisUsageSafely(
    usage: SubmitAnalysisOptions['usage'],
    occurredAt?: Date
): Promise<void> {
    try {
        await recordAnalysisUsage(usage, occurredAt);
    } catch (error) {
        console.warn(
            '[recordAnalysisUsageSafely] Failed to record analysis usage:',
            error
        );
    }
}

/**
 * Submit an analysis job for a given symbol/timeframe.
 *
 * Resolves to one of three outcomes:
 * - `cached`: a recent analysis is reused (within `ANALYSIS_CACHE_TTL`, keyed
 *   by `symbol` + `timeframe`).
 * - `submitted`: the bars + indicators were fetched, the prompt was built, a
 *   `jobId` was registered with the job queue, and a fire-and-forget HTTP
 *   POST was sent to the configured worker. Poll the result with
 *   {@link pollAnalysis}.
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
 * @returns Either a cached analysis or a freshly submitted job descriptor —
 *   see {@link SubmitAnalysisGatedResult}.
 *
 * @throws {Error} If the market data provider rejects (`fetchBarsWithIndicators`
 *   throws), or if `WORKER_URL` / `WORKER_SECRET` are missing in env.
 *
 * @example
 * ```ts
 * const submission = await submitAnalysis('AAPL', '1Day');
 * if (submission.status === 'cached') return submission.result;
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
    force: boolean = false,
    fmpSymbol?: string,
    options: SubmitAnalysisOptions = {}
): Promise<SubmitAnalysisGatedResult> {
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

    const cache = createCacheProvider();
    const cacheKey = buildAnalysisCacheKey(symbol, timeframe);

    if (!force && cache !== null) {
        try {
            const cached = await cache.get<AnalysisResponse>(cacheKey);
            if (cached !== null) {
                await recordAnalysisUsageSafely(usage, usageOccurredAt);
                return { status: 'cached', result: cached };
            }
        } catch (error) {
            console.error('[Submit] Cache read failed:', error);
        }
    }

    const { workerUrl, workerSecret } = readWorkerConfig();

    const { bars, indicators } = await fetchBarsWithIndicators(
        symbol,
        timeframe,
        fmpSymbol
    );

    const skillsLoader = new FileSkillsLoader();
    const [skills, skillsDegraded] = await skillsLoader
        .loadSkills()
        .then(s => [s, false] as const)
        .catch(error => {
            console.error(
                '[Submit] Skills loading failed, proceeding without skills:',
                error
            );
            return [[] as Skill[], true] as const;
        });

    const prompt = buildAnalysisPrompt(
        symbol,
        bars,
        indicators,
        skills,
        timeframe
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
    });

    const dispatch = fetch(`${workerUrl}/analyze`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Worker-Secret': workerSecret,
        },
        body: JSON.stringify({ jobId, prompt }),
        signal: AbortSignal.timeout(SUBMIT_ANALYSIS_TIMEOUT_MS),
    }).catch(error => {
        console.error('[Submit] Worker request failed:', error);
    });
    fireAndForget(dispatch, options);

    await recordAnalysisUsageSafely(usage, usageOccurredAt);

    return { status: 'submitted', jobId };
}
