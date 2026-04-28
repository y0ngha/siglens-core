import { fireAndForget } from '@/application/background';
import type {
    AnalysisUsageOptions,
    SubmitAnalysisOptions,
} from '@/application/types';
import { buildUsageLimitError, checkAnalysisLimit } from '@/application/usage';
import { fetchBarsWithIndicators } from '@/application/market/barsApi';
import { buildAnalysisPrompt } from '@/domain/analysis/prompt';
import { MS_PER_MINUTE } from '@/domain/constants/time';
import { lastNonNull } from '@/domain/indicators/utils';
import type {
    AnalysisResponse,
    Skill,
    SubmitAnalysisResult,
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

function toSubmitAnalysisLimitError(
    tier: AnalysisUsageOptions['tier']
): SubmitAnalysisResult {
    const error = buildUsageLimitError('analysisPerDay', tier);

    return {
        status: 'error',
        error,
    };
}

async function checkAnalysisUsageAllowed(
    usage: AnalysisUsageOptions,
    occurredAt: Date
): Promise<boolean> {
    const ipHash = hashUsageIp(usage.clientIp, occurredAt);

    return checkAnalysisLimit(
        {
            ipHash,
            tier: usage.tier,
            now: occurredAt,
            config: usage.tierConfig,
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
    } catch {
        return;
    }
}

/**
 * Submit an analysis job for a given symbol/timeframe.
 *
 * Resolves to one of two outcomes:
 * - `cached`: a recent analysis is reused (within `ANALYSIS_CACHE_TTL`, keyed
 *   by `symbol` + `timeframe`).
 * - `submitted`: the bars + indicators were fetched, the prompt was built, a
 *   `jobId` was registered with the job queue, and a fire-and-forget HTTP
 *   POST was sent to the configured worker. Poll the result with
 *   {@link pollAnalysis}.
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
 * @param options - Optional background-task hooks. Pass Vercel's `waitUntil`
 *   so the worker dispatch can continue after the response.
 * @returns Either a cached analysis or a freshly submitted job descriptor —
 *   see {@link SubmitAnalysisResult}.
 *
 * @throws {Error} If the market data provider rejects (`fetchBarsWithIndicators`
 *   throws), or if `WORKER_URL` / `WORKER_SECRET` are missing in env.
 *
 * @example
 * ```ts
 * const submission = await submitAnalysis('AAPL', '1Day');
 * if (submission.status === 'cached') return submission.result;
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
    options?: SubmitAnalysisOptions
): Promise<SubmitAnalysisResult> {
    const usage = options?.usage;
    const usageOccurredAt =
        usage === undefined ? undefined : (usage.occurredAt ?? new Date());
    if (usage !== undefined) {
        const occurredAt = usageOccurredAt!;
        const allowed = await checkAnalysisUsageAllowed(usage, occurredAt);
        if (!allowed) {
            return toSubmitAnalysisLimitError(usage.tier);
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

    // fire-and-forget: caller에게 jobId만 반환하고 worker dispatch는 백그라운드 처리.
    // serverless 환경(Vercel)에서는 options.waitUntil이 응답 후 promise 종료를 보장한다.
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
