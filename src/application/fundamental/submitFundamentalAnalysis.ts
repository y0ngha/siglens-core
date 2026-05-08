import { fireAndForget } from '@/application/background';
import { USER_API_KEY_REQUIRED_MESSAGE } from '@/application/byok/messages';
import {
    buildUsageLimitError,
    checkAnalysisUsageAllowed,
    recordAnalysisUsageSafely,
} from '@/application/usage';
import type {
    SubmitFundamentalAnalysisOptions,
    SubmitFundamentalAnalysisResult,
    SubmitFundamentalAnalysisLimitError,
    SubmitFundamentalAnalysisFetchError,
    SubmitFundamentalAnalysisApiKeyRequiredError,
} from '@/application/fundamental/types';
import { normalizeFundamentalAnalysisResponse } from '@/domain/analysis/normalizeFundamental';
import { normalizeFundamentalSnapshot } from '@/domain/analysis/normalizeFundamentalSnapshot';
import { buildFundamentalAnalysisPrompt } from '@/domain/analysis/fundamentalPrompt';
import { DEFAULT_TIER, requiresByokKey, TIER_CONFIG } from '@/domain/tier';
import { MS_PER_MINUTE } from '@/domain/constants/time';
import { buildFundamentalCacheKey } from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import type { FundamentalDataProvider } from '@/infrastructure/fundamental/types';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { readWorkerConfig } from '@/infrastructure/market/config';
import { loadSkillsCached } from '@/infrastructure/skills/loader';
import type {
    FundamentalAnalysisResponse,
    FundamentalSnapshot,
    Skill,
} from '@/domain/types';

/** Maximum time to wait for the worker to accept the fundamental analysis job. */
const SUBMIT_FUNDAMENTAL_ANALYSIS_TIMEOUT_MS = 5 * MS_PER_MINUTE;

type ProviderFetchResult =
    | {
          status: 'ok';
          snapshot: FundamentalSnapshot;
          skills: readonly Skill[];
          skillsDegraded: true | undefined;
      }
    | SubmitFundamentalAnalysisFetchError;

async function fetchProviderData(
    dataProvider: FundamentalDataProvider,
    symbol: string,
    occurredAt: Date
): Promise<ProviderFetchResult> {
    try {
        const [
            profile,
            keyMetricsTtm,
            ratiosTtm,
            cashFlow,
            incomeGrowth,
            financialScores,
            peers,
            analystEstimate,
            gradesConsensus,
            priceTargetConsensus,
            priceTargetSummary,
            earningsReport,
            sectorSnapshot,
            skillsResult,
        ] = await Promise.all([
            dataProvider.getProfile(symbol),
            dataProvider.getKeyMetricsTtm(symbol),
            dataProvider.getRatiosTtm(symbol),
            dataProvider.getCashFlowStatement(symbol),
            dataProvider.getIncomeStatementGrowth(symbol),
            dataProvider.getFinancialScores(symbol),
            dataProvider.getStockPeers(symbol),
            dataProvider.getAnalystEstimates(symbol),
            dataProvider.getGradesConsensus(symbol),
            dataProvider.getPriceTargetConsensus(symbol),
            dataProvider.getPriceTargetSummary(symbol),
            dataProvider.getEarningsReport(symbol),
            dataProvider.getSectorPerformanceSnapshot(
                occurredAt.toISOString().slice(0, 10)
            ),
            loadSkillsCached(),
        ]);

        if (profile === null) {
            return {
                status: 'error',
                code: 'fetch_failed',
                error: `Profile not found for symbol: ${symbol}`,
            };
        }

        const sectorName = profile.sector;
        const sectorHistorical = sectorName
            ? await dataProvider.getHistoricalSectorPerformance(sectorName)
            : [];

        const sectorToday =
            sectorSnapshot.find(s => s.sector === sectorName)
                ?.changesPercentage ?? null;

        const snapshot = normalizeFundamentalSnapshot({
            profile,
            keyMetricsTtm,
            ratiosTtm,
            cashFlow,
            incomeGrowth,
            financialScores,
            peers,
            analystEstimate,
            gradesConsensus,
            priceTargetConsensus,
            priceTargetSummary,
            nextEarningsAt: earningsReport?.earningsDate ?? null,
            sectorTodayChangePct: sectorToday,
            sectorHistorical: sectorHistorical.map(h => ({
                date: h.date,
                changePct: h.changesPercentage,
            })),
        });

        return {
            status: 'ok',
            snapshot,
            skills: skillsResult.skills,
            skillsDegraded: skillsResult.skillsDegraded ? true : undefined,
        };
    } catch (error) {
        console.error(
            '[submitFundamentalAnalysis] Provider or skills fetch failed:',
            error
        );
        return { status: 'error', code: 'fetch_failed', error: String(error) };
    }
}

/**
 * Submit a fundamental analysis job for the given symbol.
 *
 * Resolves to one of three outcomes:
 * - `cached`: a recent analysis is reused (keyed by `symbol` + `modelId`).
 *   The Redis check happens before any FMP data fetch, so cache hits avoid
 *   all 13 parallel provider calls.
 * - `submitted`: all provider sub-fetches completed (in parallel with skills
 *   loading), the prompt was built, a `jobId` was registered, and a
 *   fire-and-forget HTTP POST was sent to the configured worker. Poll the
 *   result with {@link pollFundamentalAnalysis}.
 * - `error`: the daily analysis limit was exceeded (when `tier` + `usage` are
 *   both provided), or the data provider threw during the parallel fetch.
 *
 * Tier and usage checks are skipped entirely when `options.usage` or
 * `options.tier` is not provided — this is the intended pre-Phase 4 behavior.
 *
 * @param options - Symbol, model, provider, and optional tier/usage/timing config.
 * @returns The submission outcome.
 *
 * @example
 * ```ts
 * const res = await submitFundamentalAnalysis({ symbol: 'AAPL', modelId: 'gemini-2.5-flash', dataProvider });
 * if (res.status === 'cached') return res.result;
 * if (res.status === 'error')  return res.error;
 * const polled = await pollFundamentalAnalysis(res.jobId);
 * ```
 *
 * @see pollFundamentalAnalysis
 * @see cancelFundamentalAnalysisJob
 */
export async function submitFundamentalAnalysis(
    options: SubmitFundamentalAnalysisOptions
): Promise<SubmitFundamentalAnalysisResult> {
    const { symbol, modelId, dataProvider } = options;
    const usage = options.usage;
    const occurredAt = options.now ?? usage?.occurredAt ?? new Date();

    // ── 0a. BYOK gate (tier + premium model + no userApiKey) ──
    const tier = options.tier ?? DEFAULT_TIER;
    const tierConfig = options.tierConfig ?? TIER_CONFIG;

    if (requiresByokKey(tier, modelId, tierConfig) && options.userApiKey === undefined) {
        const apiKeyRequiredError: SubmitFundamentalAnalysisApiKeyRequiredError =
            {
                status: 'key_error',
                code: 'user_api_key_required',
                error: USER_API_KEY_REQUIRED_MESSAGE,
                modelId,
                tier,
            };
        return apiKeyRequiredError;
    }

    if (options.tier !== undefined && usage !== undefined) {
        const allowed = await checkAnalysisUsageAllowed(
            usage,
            tier,
            occurredAt,
            tierConfig
        );
        if (!allowed) {
            const limitError: SubmitFundamentalAnalysisLimitError = {
                status: 'error',
                code: 'usage_limit_exceeded',
                error: buildUsageLimitError('analysisPerDay', tier),
            };
            return limitError;
        }
    }

    const cacheKey = buildFundamentalCacheKey(symbol, modelId);
    const cache = createCacheProvider();

    if (cache !== null) {
        try {
            const cached =
                await cache.get<FundamentalAnalysisResponse>(cacheKey);
            if (cached !== null) {
                const result = normalizeFundamentalAnalysisResponse(cached);
                // Treat an empty conclusion as a cache miss — a blank result is
                // worse than re-running the analysis and should not be billed.
                if (result.overallConclusionKo) {
                    await recordAnalysisUsageSafely(usage, modelId, occurredAt);
                    return { status: 'cached', result };
                }
            }
        } catch (error) {
            console.error(
                '[submitFundamentalAnalysis] Cache read failed:',
                error
            );
        }
    }

    const providerData = await fetchProviderData(
        dataProvider,
        symbol,
        occurredAt
    );
    if (providerData.status === 'error') return providerData;
    const { snapshot, skills, skillsDegraded } = providerData;

    const { workerUrl, workerSecret } = readWorkerConfig();
    const prompt = buildFundamentalAnalysisPrompt(symbol, snapshot, skills);
    const jobId = crypto.randomUUID();

    await setJobMeta(jobId, {
        symbol,
        modelId,
        cacheKey,
        ...(skillsDegraded && { skillsDegraded }),
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
        signal: AbortSignal.timeout(SUBMIT_FUNDAMENTAL_ANALYSIS_TIMEOUT_MS),
    }).catch(error => {
        console.error(
            '[submitFundamentalAnalysis] Worker request failed:',
            error
        );
    });
    fireAndForget(dispatch, options);

    await recordAnalysisUsageSafely(usage, modelId, occurredAt);

    return { status: 'submitted', jobId };
}
