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
import type { AnalysisResponse, Skill, Tier, Timeframe } from '@/domain/types';
import { buildAnalysisCacheKey } from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { hashUsageIp } from '@/infrastructure/db';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { readWorkerConfig } from '@/infrastructure/market/config';
import { FileSkillsLoader } from '@/infrastructure/skills/loader';

const SUBMIT_ANALYSIS_TIMEOUT_MS = 5 * MS_PER_MINUTE;
const DEFAULT_ANALYSIS_MODEL_USED = 'analysis-worker';

function toSubmitAnalysisLimitError(
    tier: Tier
): Extract<SubmitAnalysisGatedResult, { status: 'error' }> {
    return {
        status: 'error',
        error: buildUsageLimitError('analysisPerDay', tier),
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
 * - `cached`: a recent analysis is reused.
 * - `submitted`: market data was fetched and a worker job was queued.
 * - `error`: a tier gate or daily analysis usage limit rejected the request.
 */
export async function submitAnalysis(
    symbol: string,
    timeframe: Timeframe,
    force: boolean = false,
    fmpSymbol?: string,
    options: SubmitAnalysisOptions = {}
): Promise<SubmitAnalysisGatedResult> {
    const tier =
        options.tierContext?.tier ?? options.usage?.tier ?? DEFAULT_TIER;
    const tierConfig =
        options.tierConfig ?? options.usage?.tierConfig ?? TIER_CONFIG;

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
