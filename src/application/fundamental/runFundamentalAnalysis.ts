import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { dedupeGeneration } from '@/application/analysis/generationLock';
import { DEEPSEEK_V4_1_FLASH_MODEL } from '@/application/chat/constants';
import { buildUserApiKeyRequiredError } from '@/application/byok/gate';
import {
    buildUsageLimitError,
    checkAnalysisUsageAllowed,
    recordAnalysisUsageSafely,
} from '@/application/usage';
import type {
    RunFundamentalAnalysisResult,
    SubmitFundamentalAnalysisLimitError,
    SubmitFundamentalAnalysisOptions,
    SubmitFundamentalAnalysisFetchError,
} from '@/application/fundamental/types';
import { normalizeFundamentalAnalysisResponse } from '@/domain/analysis/normalizeFundamental';
import { normalizeFundamentalSnapshot } from '@/domain/analysis/normalizeFundamentalSnapshot';
import { buildFundamentalAnalysisPrompt } from '@/domain/analysis/fundamentalPrompt';
import {
    DEFAULT_ANALYSIS_LOCALE,
    outputLanguageReminder,
} from '@/domain/analysis/outputLocale';
import { FUNDAMENTAL_RESPONSE_SCHEMA } from '@/domain/analysis/responseSchemas';
import { fundamentalSystemPrompt } from '@/domain/analysis/systemPrompt';
import { MODEL_SPECS } from '@/domain/analysis/modelSpecs';
import { DEFAULT_TIER, requiresByokKey, TIER_CONFIG } from '@/domain/tier';
import { ISO_DATE_PREFIX_LENGTH } from '@/domain/constants/format';
import {
    buildFundamentalCacheKey,
    FUNDAMENTAL_CACHE_TTL_SECONDS,
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
    FundamentalAnalysisResponse,
    FundamentalSnapshot,
} from '@/domain/types';
import type { FundamentalDataProvider } from '@/domain/ports/fundamentalDataProvider';

type ProviderFetchResult =
    | { status: 'ok'; snapshot: FundamentalSnapshot }
    | SubmitFundamentalAnalysisFetchError;

/**
 * Fetch all 13 FMP sub-calls in parallel and normalise them into a
 * {@link FundamentalSnapshot}. Mirrors the private helper in
 * `submitFundamentalAnalysis.ts` — kept private to this module because the
 * provider contract stays stable across submit and run paths.
 */
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
                occurredAt.toISOString().slice(0, ISO_DATE_PREFIX_LENGTH)
            ),
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

        return { status: 'ok', snapshot };
    } catch (error) {
        console.error('[RunFundamental] Provider fetch failed:', error);
        return { status: 'error', code: 'fetch_failed', error: String(error) };
    }
}

/**
 * Resolves the optional `currentPrice` enrichment. A lazy getter that rejects
 * (quote provider outage) degrades to "no price" — the price only feeds the
 * target-upside line, so it must never fail an analysis whose provider data
 * was already fetched.
 */
async function resolveCurrentPriceOption(
    currentPrice: SubmitFundamentalAnalysisOptions['currentPrice']
): Promise<number | null | undefined> {
    if (typeof currentPrice !== 'function') return currentPrice;
    try {
        return await currentPrice();
    } catch (error) {
        console.error(
            '[RunFundamental] currentPrice getter failed; continuing without it:',
            error
        );
        return undefined;
    }
}

/**
 * Run a fundamental analysis end-to-end: tier gate → cache lookup → provider
 * fetch → LLM call → normalisation → cache write → return.
 *
 * This is the direct (non-queued) replacement for the
 * `submitFundamentalAnalysis` + `pollFundamentalAnalysis` pair. The caller
 * awaits a single promise; no job IDs, no Redis meta, no polling loop.
 *
 * Concurrent calls for the same `cacheKey` are deduplicated via
 * `dedupeGeneration` (in-process and cross-instance): only one LLM call fires; all waiting callers
 * receive the same result.
 *
 * Pass `options.signal` (e.g. `request.signal` from the SSE route handler)
 * so a dropped connection aborts the in-flight LLM call.
 *
 * @throws If the provider fetch or normalisation fails (network, 5xx, abort).
 *   Gate denials (BYOK, usage limit, fetch error) are returned as
 *   discriminated-union variants, not thrown.
 *
 * @see submitFundamentalAnalysis — the queued predecessor; still exported for
 *   the existing production path until siglens switches to runFundamentalAnalysis.
 */
export async function runFundamentalAnalysis(
    options: SubmitFundamentalAnalysisOptions
): Promise<RunFundamentalAnalysisResult> {
    const { symbol, modelId, dataProvider } = options;
    const usage = options.usage;
    const occurredAt = options.now ?? usage?.occurredAt ?? new Date();

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
    // Only when both tier and usage are provided — matches submitFundamentalAnalysis.
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

    // Skills are loaded once; the same load serves both the sampling plan
    // (for cache-key + prompt assembly). `skillsDegraded` reflects THIS load.
    const skillsResult = await loadSkillsCached();
    const skillSampling = createSkillSamplingPlan(skillsResult.skills, tier, [
        'fundamental',
        symbol,
        modelId,
        reasoningSeedPart(options.reasoning),
        tier,
    ]);

    const cacheKey = buildFundamentalCacheKey(
        symbol,
        modelId,
        `${tier}:${skillSampling.fingerprint}`,
        options.reasoning,
        options.locale
    );
    const cache = createCacheProvider();

    if (!options.force && cache !== null) {
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
            console.error('[RunFundamental] Cache read failed:', error);
        }
    }

    if (options.skipEnqueueIfMiss) {
        return { status: 'miss_no_trigger' };
    }

    const providerData = await fetchProviderData(
        dataProvider,
        symbol,
        occurredAt
    );
    if (providerData.status === 'error') return providerData;
    // `currentPrice` may be a lazy getter (spec 2026-09-18) — resolved here,
    // only after the cache-hit early return above, so a
    // cache HIT never pays for the caller's quote fetch. Invalid (non-finite
    // / <= 0 — a quote failure renders `0` in this codebase, never a real
    // price) is treated as absent so `## Derived Metrics`'s price-relative
    // lines fall back to `N/A` rather than computing against a bad number.
    const resolvedCurrentPrice = await resolveCurrentPriceOption(
        options.currentPrice
    );
    const currentPrice =
        typeof resolvedCurrentPrice === 'number' &&
        Number.isFinite(resolvedCurrentPrice) &&
        resolvedCurrentPrice > 0
            ? resolvedCurrentPrice
            : undefined;
    const snapshot =
        currentPrice === undefined
            ? providerData.snapshot
            : { ...providerData.snapshot, currentPrice };

    const locale = options.locale ?? DEFAULT_ANALYSIS_LOCALE;
    const { stable, dynamic } = buildFundamentalAnalysisPrompt(
        symbol,
        snapshot,
        skillSampling.skills,
        locale,
        options.currency,
        occurredAt
    );
    // Design C: the always-on skill digest (`stable`) folds into SYSTEM so
    // providers with a stable-system cache hit amortise the cost.
    const system = stable
        ? `${fundamentalSystemPrompt(locale)}\n\n${stable}`
        : fundamentalSystemPrompt(locale);
    // 출력 언어를 **마지막 지시**로 한 번 더 못 박는다 — 유저 프롬프트의 필드
    // 설명은 언어를 `Korean`으로 적어 둔 곳이 많아 그것만으로는 뒤집히지 않는다.
    // 기본 로케일(ko)에서는 빈 문자열이라 프롬프트 바이트가 예전과 같다.
    const prompt = `${dynamic}${outputLanguageReminder(locale)}`;

    // callModelId resolves the actual ActiveModelId for the AI call.
    // Deprecated model strings live in ModelId but not in MODEL_SPECS; guard
    // them out so callAnalysisAi receives only a valid, dispatchable model.
    const callModelId: ActiveModelId =
        (modelId as string) in MODEL_SPECS
            ? (modelId as ActiveModelId)
            : DEEPSEEK_V4_1_FLASH_MODEL;

    const raw = await dedupeGeneration(
        cache,
        cacheKey,
        () =>
            callAnalysisAi({
                prompt,
                model: callModelId,
                tier,
                userApiKey: options.userApiKey,
                signal: options.signal,
                fallbackOnProviderFailure: options.providerFallback,
                system,
                responseSchema: FUNDAMENTAL_RESPONSE_SCHEMA,
                seed: analysisSeed(`${system}\n\n${prompt}`),
                reasoning: options.reasoning,
                correlationId: `${symbol}:fundamental`,
            }),
        { signal: options.signal }
    );

    // Inline post-processing (formerly in pollFundamentalAnalysis). No job queue involved.
    const rawResult = JSON.parse(raw) as unknown;
    const result = normalizeFundamentalAnalysisResponse(rawResult);

    if (
        result.overallConclusionKo === '' &&
        result.categoryAssessments.length === 0
    ) {
        console.warn('[RunFundamental] Empty fundamental analysis', { symbol });
    }

    // Cache the normalized result. Matches pollFundamentalAnalysis: write even
    // when the result is content-empty (no skip — see the poll function's
    // empty-response handling comment for the rationale). Fire-and-forget so
    // the cache write does not delay the response.
    if (cache !== null) {
        cache
            .set(cacheKey, result, FUNDAMENTAL_CACHE_TTL_SECONDS)
            .catch(error =>
                console.error('[RunFundamental] Cache write failed:', error)
            );
    }

    // Record usage AFTER the LLM returns so an aborted or failed call does
    // not consume quota (invariant 4 of the worker-removal design).
    await recordAnalysisUsageSafely(usage, modelId, occurredAt);

    return { status: 'done', result };
}
