import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { dedupeInFlight } from '@/application/analysis/inFlight';
import { DEEPSEEK_V4_FLASH_MODEL } from '@/application/chat/constants';
import { buildUserApiKeyRequiredError } from '@/application/byok/gate';
import {
    buildUsageLimitError,
    checkAnalysisUsageAllowed,
    recordAnalysisUsageSafely,
} from '@/application/usage';
import type {
    RunFinancialsAnalysisResult,
    SubmitFinancialsAnalysisLimitError,
    SubmitFinancialsAnalysisOptions,
    SubmitFinancialsAnalysisFetchError,
} from '@/application/financials/types';
import { normalizeFinancialsAnalysisResponse } from '@/domain/analysis/normalizeFinancials';
import { normalizeFinancialsSnapshot } from '@/domain/analysis/normalizeFinancialsSnapshot';
import { computeFinancialsScorecard } from '@/domain/analysis/financialsScorecard';
import { buildFinancialsAnalysisPrompt } from '@/domain/analysis/financialsPrompt';
import {
    DEFAULT_ANALYSIS_LOCALE,
    outputLanguageReminder,
} from '@/domain/analysis/outputLocale';
import { FINANCIALS_RESPONSE_SCHEMA } from '@/domain/analysis/responseSchemas';
import { financialsSystemPrompt } from '@/domain/analysis/systemPrompt';
import { MODEL_SPECS } from '@/domain/analysis/modelSpecs';
import { DEFAULT_TIER, requiresByokKey, TIER_CONFIG } from '@/domain/tier';
import {
    buildFinancialsCacheKey,
    FINANCIALS_CACHE_TTL_SECONDS,
} from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { analysisSeed } from '@/infrastructure/hash/analysisInput';
import { loadSkillsCached } from '@/infrastructure/skills/loader';
import {
    createSkillSamplingPlan,
    reasoningSeedPart,
} from '@/infrastructure/skills/sampling';
import type {
    ActiveModelId,
    FinancialsAnalysisResponse,
    FinancialsSnapshot,
    StatementPeriod,
} from '@/domain/types';
import type { FinancialStatementsProvider } from '@/domain/ports/financialStatementsProvider';

/** Default statement period when the caller omits `period`. */
const DEFAULT_PERIOD: StatementPeriod = 'annual';
/** Default number of fiscal periods to fetch per statement. */
const DEFAULT_LIMIT = 5;

type ProviderFetchResult =
    | { status: 'ok'; snapshot: FinancialsSnapshot }
    | SubmitFinancialsAnalysisFetchError;

/**
 * Fetch all six financial-statement sub-calls in parallel and normalise them
 * into a {@link FinancialsSnapshot}. Mirrors the private helper in
 * `submitFinancialsAnalysis.ts` — kept private to this module.
 */
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
        ] = await Promise.all([
            dataProvider.getIncomeStatements(symbol, period, limit),
            dataProvider.getBalanceSheets(symbol, period, limit),
            dataProvider.getCashFlowStatements(symbol, period, limit),
            dataProvider.getIncomeStatementGrowths(symbol, period, limit),
            dataProvider.getFinancialGrowths(symbol, period, limit),
            dataProvider.getCashFlowGrowths(symbol, period, limit),
        ]);

        const snapshot = normalizeFinancialsSnapshot({
            income,
            balance,
            cashFlow,
            incomeGrowth,
            financialGrowth,
            cashFlowGrowth,
        });

        return { status: 'ok', snapshot };
    } catch (error) {
        console.error('[RunFinancials] Provider fetch failed:', error);
        return { status: 'error', code: 'fetch_failed', error: String(error) };
    }
}

/**
 * Run a financials (multi-year statement) analysis end-to-end: tier gate →
 * cache lookup → provider fetch → prompt build → LLM call → normalisation →
 * cache write → return.
 *
 * This is the direct (non-queued) replacement for the
 * `submitFinancialsAnalysis` + `pollFinancialsAnalysis` pair. The caller
 * awaits a single promise; no job IDs, no Redis meta, no polling loop.
 *
 * The financials scorecard (`computeFinancialsScorecard`) is computed
 * synchronously as a local variable immediately after the provider fetch —
 * no Redis round-trip is needed (invariant 1 of the worker-removal design).
 *
 * Concurrent calls for the same `cacheKey` are deduplicated via
 * {@link dedupeInFlight}: only one LLM call fires; all waiting callers
 * receive the same result.
 *
 * Pass `options.signal` (e.g. `request.signal` from the SSE route handler)
 * so a dropped connection aborts the in-flight LLM call.
 *
 * @throws If the provider fetch or normalisation fails. Gate denials (BYOK,
 *   usage limit, fetch error) are returned as discriminated-union variants,
 *   not thrown.
 *
 * @see submitFinancialsAnalysis — the queued predecessor; still exported for
 *   the existing production path until siglens switches to runFinancialsAnalysis.
 */
export async function runFinancialsAnalysis(
    options: SubmitFinancialsAnalysisOptions
): Promise<RunFinancialsAnalysisResult> {
    const { symbol, modelId, dataProvider } = options;
    const usage = options.usage;
    const occurredAt = options.now ?? usage?.occurredAt ?? new Date();
    const period = options.period ?? DEFAULT_PERIOD;
    const limit = options.limit ?? DEFAULT_LIMIT;

    const tier = options.tier ?? DEFAULT_TIER;
    const tierConfig = options.tierConfig ?? TIER_CONFIG;

    // ── 0a. BYOK gate (tier + premium model + no userApiKey) ──
    if (
        requiresByokKey(tier, modelId, tierConfig) &&
        options.userApiKey === undefined
    ) {
        return buildUserApiKeyRequiredError(tier, modelId);
    }

    // ── 0b. Usage limit check ──
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

    // Skills are loaded once; the same load serves both the sampling plan
    // (for cache-key fingerprint + prompt assembly).
    const skillsResult = await loadSkillsCached();
    const skillSampling = createSkillSamplingPlan(skillsResult.skills, tier, [
        'financials',
        symbol,
        modelId,
        period,
        String(limit),
        reasoningSeedPart(options.reasoning),
        tier,
    ]);

    const cacheKey = buildFinancialsCacheKey(
        symbol,
        modelId,
        period,
        `${tier}:${skillSampling.fingerprint}`,
        options.reasoning,
        options.locale
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
            console.error('[RunFinancials] Cache read failed:', error);
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
    const { snapshot } = providerData;

    // scorecard is a local variable — no Redis meta write needed (invariant 1).
    const scorecard = computeFinancialsScorecard(snapshot);
    const locale = options.locale ?? DEFAULT_ANALYSIS_LOCALE;
    const { stable, dynamic } = buildFinancialsAnalysisPrompt(
        symbol,
        snapshot,
        scorecard,
        skillSampling.skills,
        locale
    );
    // Design C: the always-on skill digest (`stable`) folds into SYSTEM so
    // providers with a stable-system cache hit amortise the cost.
    const system = stable
        ? `${financialsSystemPrompt(locale)}\n\n${stable}`
        : financialsSystemPrompt(locale);
    // 출력 언어를 **마지막 지시**로 한 번 더 못 박는다 — 유저 프롬프트의 필드
    // 설명은 언어를 `Korean`으로 적어 둔 곳이 많아 그것만으로는 뒤집히지 않는다.
    // 기본 로케일(ko)에서는 빈 문자열이라 프롬프트 바이트가 예전과 같다.
    const prompt = `${dynamic}${outputLanguageReminder(locale)}`;

    // callModelId resolves the actual ActiveModelId for the AI call.
    // Deprecated model strings live in ModelId but not in MODEL_SPECS.
    const callModelId: ActiveModelId =
        (modelId as string) in MODEL_SPECS
            ? (modelId as ActiveModelId)
            : DEEPSEEK_V4_FLASH_MODEL;

    const raw = await dedupeInFlight(cacheKey, () =>
        callAnalysisAi({
            prompt,
            model: callModelId,
            tier,
            userApiKey: options.userApiKey,
            signal: options.signal,
            system,
            responseSchema: FINANCIALS_RESPONSE_SCHEMA,
            seed: analysisSeed(`${system}\n\n${prompt}`),
            reasoning: options.reasoning,
            correlationId: `${symbol}:financials`,
        })
    );

    // Inline post-processing (formerly in pollFinancialsAnalysis). No job queue involved.
    const rawResult = JSON.parse(raw) as unknown;
    const result = normalizeFinancialsAnalysisResponse(rawResult);

    if (
        result.overallConclusionKo === '' &&
        result.axisAssessments.length === 0
    ) {
        console.warn('[RunFinancials] Empty financials analysis', { symbol });
    }

    // Cache the normalized result. Matches pollFinancialsAnalysis: write even
    // when the result is content-empty (no skip). Fire-and-forget so the cache
    // write does not delay the response.
    if (cache !== null) {
        cache
            .set(cacheKey, result, FINANCIALS_CACHE_TTL_SECONDS)
            .catch(error =>
                console.error('[RunFinancials] Cache write failed:', error)
            );
    }

    // Record usage AFTER the LLM returns so an aborted or failed call does
    // not consume quota (invariant 4 of the worker-removal design).
    await recordAnalysisUsageSafely(usage, modelId, occurredAt);

    return { status: 'done', result };
}
