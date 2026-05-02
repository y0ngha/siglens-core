import { fireAndForget } from '@/application/background';
import { checkAnalysisLimit, buildUsageLimitError } from '@/application/usage';
import { hashAnalysisInput } from '@/infrastructure/hash/analysisInput';
import type {
    SubmitFundamentalAnalysisOptions,
    SubmitFundamentalAnalysisResult,
    SubmitFundamentalAnalysisLimitError,
    SubmitFundamentalAnalysisFetchError,
} from '@/application/fundamental/types';
import { normalizeFundamentalSnapshot } from '@/domain/analysis/normalizeFundamentalSnapshot';
import { buildFundamentalAnalysisPrompt } from '@/domain/analysis/fundamentalPrompt';
import { TIER_CONFIG } from '@/domain/tier';
import { MS_PER_MINUTE } from '@/domain/constants/time';
import { buildFundamentalCacheKey } from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { hashUsageIp } from '@/infrastructure/usage/hash';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { readWorkerConfig } from '@/infrastructure/market/config';
import { loadSkillsCached } from '@/infrastructure/skills/loader';
import type {
    FundamentalAnalysisResponse,
    FundamentalSnapshot,
} from '@/domain/types';

/** Maximum time to wait for the worker to accept the fundamental analysis job. */
const SUBMIT_FUNDAMENTAL_ANALYSIS_TIMEOUT_MS = 5 * MS_PER_MINUTE;

/**
 * Derive a short deterministic hash of the normalized snapshot.
 *
 * Delegates to {@link hashAnalysisInput} with the JSON-serialized snapshot.
 *
 * @param snapshot - Normalized fundamental snapshot.
 * @returns 16-character lowercase hex string.
 * @internal
 */
function hashSnapshot(snapshot: object): string {
    return hashAnalysisInput(JSON.stringify(snapshot));
}

/**
 * Submit a fundamental analysis job for the given symbol.
 *
 * Resolves to one of three outcomes:
 * - `cached`: a recent analysis is reused (keyed by `symbol` + `modelId` +
 *   an input hash of the normalized snapshot).
 * - `submitted`: all 13 provider sub-fetches completed, the prompt was built,
 *   a `jobId` was registered, and a fire-and-forget HTTP POST was sent to the
 *   configured worker. Poll the result with {@link pollFundamentalAnalysis}.
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
    const occurredAt = options.now ?? new Date();

    // ── 1. Usage limit check (only when both tier and usage are provided) ──
    if (options.tier !== undefined && options.usage !== undefined) {
        const tier = options.tier;
        const tierConfig = options.tierConfig ?? TIER_CONFIG;
        const ipHash = hashUsageIp(options.usage.clientIp, occurredAt);
        const allowed = await checkAnalysisLimit(
            { ipHash, tier, now: occurredAt, config: tierConfig },
            { usage: options.usage.usageRepository }
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

    // ── 2. Fetch all provider sub-fetches in parallel (13 total) ──
    let snapshot: FundamentalSnapshot;
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
        ]);

        if (profile === null) {
            const fetchError: SubmitFundamentalAnalysisFetchError = {
                status: 'error',
                code: 'fetch_failed',
                error: `Profile not found for symbol: ${symbol}`,
            };
            return fetchError;
        }

        const sectorName = profile.sector;
        const sectorHistorical = sectorName
            ? await dataProvider.getHistoricalSectorPerformance(sectorName)
            : [];

        const sectorToday =
            sectorSnapshot.find(s => s.sector === sectorName)
                ?.changesPercentage ?? null;

        snapshot = normalizeFundamentalSnapshot({
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
    } catch (error) {
        console.error(
            '[submitFundamentalAnalysis] Provider fetch failed:',
            error
        );
        const fetchError: SubmitFundamentalAnalysisFetchError = {
            status: 'error',
            code: 'fetch_failed',
            error: String(error),
        };
        return fetchError;
    }

    // ── 3. Hash snapshot → build cache key → check cache ──
    const inputHash = hashSnapshot(snapshot);
    const cacheKey = buildFundamentalCacheKey(symbol, modelId, inputHash);
    const cache = createCacheProvider();

    if (cache !== null) {
        try {
            const cached =
                await cache.get<FundamentalAnalysisResponse>(cacheKey);
            if (cached !== null) {
                return { status: 'cached', result: cached };
            }
        } catch (error) {
            console.error(
                '[submitFundamentalAnalysis] Cache read failed:',
                error
            );
        }
    }

    // ── 4. Build prompt, enqueue job, fire-and-forget worker POST ──
    const { workerUrl, workerSecret } = readWorkerConfig();
    const { skills, skillsDegraded } = await loadSkillsCached();
    const prompt = buildFundamentalAnalysisPrompt(symbol, snapshot, skills);
    const jobId = crypto.randomUUID();

    await setJobMeta(jobId, {
        symbol,
        modelId,
        cacheKey,
        ...(skillsDegraded && { skillsDegraded }),
    });

    const dispatch = fetch(`${workerUrl}/analyze`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Worker-Secret': workerSecret,
        },
        body: JSON.stringify({ jobId, prompt, model: modelId }),
        signal: AbortSignal.timeout(SUBMIT_FUNDAMENTAL_ANALYSIS_TIMEOUT_MS),
    }).catch(error => {
        console.error(
            '[submitFundamentalAnalysis] Worker request failed:',
            error
        );
    });
    fireAndForget(dispatch, options);

    return { status: 'submitted', jobId };
}
