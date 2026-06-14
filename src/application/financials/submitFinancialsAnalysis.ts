import { fireAndForget } from '@/application/background';
import { buildUserApiKeyRequiredError } from '@/application/byok/gate';
import {
    buildUsageLimitError,
    checkAnalysisUsageAllowed,
    recordAnalysisUsageSafely,
} from '@/application/usage';
import type {
    SubmitFinancialsAnalysisOptions,
    SubmitFinancialsAnalysisResult,
    SubmitFinancialsAnalysisLimitError,
    SubmitFinancialsAnalysisFetchError,
} from '@/application/financials/types';
import { normalizeFinancialsAnalysisResponse } from '@/domain/analysis/normalizeFinancials';
import { normalizeFinancialsSnapshot } from '@/domain/analysis/normalizeFinancialsSnapshot';
import { computeFinancialsScorecard } from '@/domain/analysis/financialsScorecard';
import { buildFinancialsAnalysisPrompt } from '@/domain/analysis/financialsPrompt';
import { FINANCIALS_RESPONSE_SCHEMA } from '@/domain/analysis/responseSchemas';
import { FINANCIALS_SYSTEM_PROMPT } from '@/domain/analysis/systemPrompt';
import { DEFAULT_TIER, requiresByokKey, TIER_CONFIG } from '@/domain/tier';
import { MS_PER_MINUTE } from '@/domain/constants/time';
import { buildFinancialsCacheKey } from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import {
    analysisSeed,
    hashSkillCatalog,
} from '@/infrastructure/hash/analysisInput';
import type { FinancialStatementsProvider } from '@/domain/ports/financialStatementsProvider';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { readWorkerConfig } from '@/infrastructure/market/config';
import { loadSkillsCached } from '@/infrastructure/skills/loader';
import type {
    AnalysisType,
    FinancialsAnalysisResponse,
    FinancialsSnapshot,
    Skill,
    StatementPeriod,
} from '@/domain/types';

/** Maximum time to wait for the worker to accept the financials analysis job. */
const SUBMIT_FINANCIALS_ANALYSIS_TIMEOUT_MS = 5 * MS_PER_MINUTE;

/** Default statement period when the caller omits `period`. */
const DEFAULT_PERIOD: StatementPeriod = 'annual';
/** Default number of fiscal periods to fetch per statement. */
const DEFAULT_LIMIT = 5;

type ProviderFetchResult =
    | {
          status: 'ok';
          snapshot: FinancialsSnapshot;
          skills: readonly Skill[];
          skillsDegraded: true | undefined;
      }
    | SubmitFinancialsAnalysisFetchError;

async function fetchProviderData(
    dataProvider: FinancialStatementsProvider,
    symbol: string,
    period: StatementPeriod,
    limit: number
): Promise<ProviderFetchResult> {
    try {
        const [
            income,
            balance,
            cashFlow,
            incomeGrowth,
            financialGrowth,
            cashFlowGrowth,
            skillsResult,
        ] = await Promise.all([
            dataProvider.getIncomeStatements(symbol, period, limit),
            dataProvider.getBalanceSheets(symbol, period, limit),
            dataProvider.getCashFlowStatements(symbol, period, limit),
            dataProvider.getIncomeStatementGrowths(symbol, period, limit),
            dataProvider.getFinancialGrowths(symbol, period, limit),
            dataProvider.getCashFlowGrowths(symbol, period, limit),
            loadSkillsCached(),
        ]);

        const snapshot = normalizeFinancialsSnapshot({
            income,
            balance,
            cashFlow,
            incomeGrowth,
            financialGrowth,
            cashFlowGrowth,
        });

        return {
            status: 'ok',
            snapshot,
            skills: skillsResult.skills,
            skillsDegraded: skillsResult.skillsDegraded ? true : undefined,
        };
    } catch (error) {
        console.error(
            '[submitFinancialsAnalysis] Provider or skills fetch failed:',
            error
        );
        return { status: 'error', code: 'fetch_failed', error: String(error) };
    }
}

/**
 * Submit a financials (multi-year statement) analysis job for the given symbol.
 *
 * Mirrors {@link submitFundamentalAnalysis} exactly. Resolves to one of:
 * - `cached`: a recent analysis is reused (keyed by `symbol` + `modelId` +
 *   skill fingerprint). The Redis check happens before any provider fetch.
 * - `submitted`: all six statement sub-fetches completed (in parallel with
 *   skills loading), the prompt was built from the normalized snapshot and a
 *   synchronously-computed scorecard, a `jobId` was registered, and a
 *   fire-and-forget HTTP POST was sent to the configured worker.
 * - `miss_no_trigger`: the cache missed but no job was enqueued because
 *   `options.skipEnqueueIfMiss` was set. Provider data is not fetched.
 * - `error`: the daily analysis limit was exceeded, or the data provider threw.
 * - `key_error`: a BYOK key is required for the requested premium model+tier.
 *
 * Tier and usage checks are skipped entirely when `options.usage` or
 * `options.tier` is not provided.
 *
 * The job meta carries only the AI text identity (`symbol`/`modelId`/`cacheKey`);
 * the scorecard is computed synchronously by the consumer (siglens) and is not
 * round-tripped through the worker.
 *
 * @param options - Symbol, model, provider, and optional tier/usage/period config.
 * @returns The submission outcome.
 */
export async function submitFinancialsAnalysis(
    options: SubmitFinancialsAnalysisOptions
): Promise<SubmitFinancialsAnalysisResult> {
    const { symbol, modelId, dataProvider } = options;
    const usage = options.usage;
    const occurredAt = options.now ?? usage?.occurredAt ?? new Date();
    const period = options.period ?? DEFAULT_PERIOD;
    const limit = options.limit ?? DEFAULT_LIMIT;

    // ── 0a. BYOK gate (tier + premium model + no userApiKey) ──
    const tier = options.tier ?? DEFAULT_TIER;
    const tierConfig = options.tierConfig ?? TIER_CONFIG;

    if (
        requiresByokKey(tier, modelId, tierConfig) &&
        options.userApiKey === undefined
    ) {
        return buildUserApiKeyRequiredError(tier, modelId);
    }

    if (options.tier !== undefined && usage !== undefined) {
        const allowed = await checkAnalysisUsageAllowed(
            usage,
            tier,
            occurredAt,
            tierConfig
        );
        if (!allowed) {
            const limitError: SubmitFinancialsAnalysisLimitError = {
                status: 'error',
                code: 'usage_limit_exceeded',
                error: buildUsageLimitError('analysisPerDay', tier),
            };
            return limitError;
        }
    }

    // Fold the skill-catalog fingerprint into the key so a gating/frontmatter
    // change busts the cache. loadSkillsCached is memoized, so the catalog
    // fetchProviderData loads on a miss is the same one hashed here.
    const { skills: fingerprintSkills } = await loadSkillsCached();
    const cacheKey = buildFinancialsCacheKey(
        symbol,
        modelId,
        period,
        hashSkillCatalog(fingerprintSkills)
    );
    const cache = createCacheProvider();

    if (!options.force && cache !== null) {
        try {
            const cached =
                await cache.get<FinancialsAnalysisResponse>(cacheKey);
            if (cached !== null) {
                const result = normalizeFinancialsAnalysisResponse(cached);
                // Treat an empty conclusion as a cache miss — a blank result is
                // worse than re-running the analysis and should not be billed.
                if (result.overallConclusionKo) {
                    await recordAnalysisUsageSafely(usage, modelId, occurredAt);
                    return { status: 'cached', result };
                }
            }
        } catch (error) {
            console.error(
                '[submitFinancialsAnalysis] Cache read failed:',
                error
            );
        }
    }

    if (options.skipEnqueueIfMiss) {
        return { status: 'miss_no_trigger' };
    }

    const providerData = await fetchProviderData(
        dataProvider,
        symbol,
        period,
        limit
    );
    if (providerData.status === 'error') return providerData;
    const { snapshot, skills, skillsDegraded } = providerData;

    const { workerUrl, workerSecret } = readWorkerConfig();
    const scorecard = computeFinancialsScorecard(snapshot);
    const prompt = buildFinancialsAnalysisPrompt(
        symbol,
        snapshot,
        scorecard,
        skills
    );
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
        body: JSON.stringify({
            jobId,
            prompt,
            seed: analysisSeed(prompt),
            model: modelId,
            tier,
            analysisType: 'financials' satisfies AnalysisType,
            system: FINANCIALS_SYSTEM_PROMPT,
            responseSchema: FINANCIALS_RESPONSE_SCHEMA,
        }),
        signal: AbortSignal.timeout(SUBMIT_FINANCIALS_ANALYSIS_TIMEOUT_MS),
    }).catch(error => {
        console.error(
            '[submitFinancialsAnalysis] Worker request failed:',
            error
        );
    });
    fireAndForget(dispatch, options);

    await recordAnalysisUsageSafely(usage, modelId, occurredAt);

    return { status: 'submitted', jobId };
}
