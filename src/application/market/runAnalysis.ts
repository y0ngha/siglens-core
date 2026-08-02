import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { dedupeInFlight } from '@/application/analysis/inFlight';
import { DEEPSEEK_V4_FLASH_MODEL } from '@/application/chat/constants';
import { fetchBarsWithIndicators } from '@/application/market/barsApi';
import { buildUserApiKeyRequiredError } from '@/application/byok/gate';
import {
    buildTimeframeNotAllowedError,
    type RunAnalysisResult,
    type SubmitAnalysisOptions,
} from '@/application/market/types';
import {
    buildUsageLimitError,
    checkAnalysisUsageAllowed,
    recordAnalysisUsageSafely,
} from '@/application/usage';
import { postProcessAnalysisWithReconcile } from '@/domain/analysis/ai-levels';
import {
    enrichAnalysisWithConfidence,
    isFallbackAnalysis,
    normalizeCachedAnalysisResponse,
} from '@/domain/analysis/confidence';
import { filterAnalysisResult } from '@/domain/analysis/filterAnalysisResult';
import { MODEL_SPECS } from '@/domain/analysis/modelSpecs';
import { buildAnalysisPrompt } from '@/domain/analysis/prompt';
import { TECHNICAL_RESPONSE_SCHEMA } from '@/domain/analysis/responseSchemas';
import { AI_SYSTEM_PROMPT } from '@/domain/analysis/systemPrompt';
import { computeFearGreedIndex } from '@/domain/indicators/fearGreed';
import { lastNonNull } from '@/domain/indicators/utils';
import {
    DEFAULT_TIER,
    TIER_CONFIG,
    isTimeframeAllowed,
    requiresByokKey,
} from '@/domain/tier';
import type {
    ActiveModelId,
    AnalysisResponse,
    FearGreedSnapshot,
    Timeframe,
} from '@/domain/types';
import {
    buildAnalysisCacheKey,
    computeEffectiveTtl,
    DEFAULT_ANALYSIS_MODEL_ID,
} from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { analysisSeed } from '@/infrastructure/hash/analysisInput';
import { loadSkillsCached } from '@/infrastructure/skills/loader';
import {
    createSkillSamplingPlan,
    reasoningSeedPart,
} from '@/infrastructure/skills/sampling';

/**
 * `options.modelId`가 없을 때 실제로 호출할 모델.
 *
 * `DEFAULT_ANALYSIS_MODEL_ID`('analysis-worker')는 **캐시 키 센티널이지 호출 가능한
 * 모델이 아니다** — `TIER_CONFIG.models` 어디에도 등록돼 있지 않다. 구 worker는
 * `isSupportedModel` 가드에서 이 토큰을 400으로 거부했으므로, "modelId 없이 dispatch"
 * 경로는 사실상 도달 불가능했다(차트 탭은 `useSelectedModel`이 항상 실제 모델을 넘기고,
 * 봇/SSR 경로는 `skipEnqueueIfMiss`로 dispatch 전에 빠진다).
 *
 * 그래서 여기엔 "구 동작 보존"이라는 기준이 없다 — 보존할 동작이 400뿐이다. 대신 UI가
 * 실제로 쓰는 기본값(`useSelectedModel`의 `DEFAULT_MODEL`)과 일치시켜, modelId를 생략한
 * 호출이 사용자가 UI에서 받았을 결과와 같은 모델로 수행되게 한다.
 *
 * 캐시 키는 계속 `DEFAULT_ANALYSIS_MODEL_ID`를 쓴다(기존 캐시 호환).
 */
const DEFAULT_RUN_ANALYSIS_MODEL: ActiveModelId = DEEPSEEK_V4_FLASH_MODEL;

/**
 * Run a technical analysis end-to-end: tier gate → cache lookup → LLM call
 * → post-processing → cache write → tier-filtered return.
 *
 * This is the direct (non-queued) replacement for the `submitAnalysis` +
 * `pollAnalysis` pair. The caller awaits a single promise; no job IDs, no
 * Redis meta, no polling loop.
 *
 * Concurrent calls for the same `cacheKey` are deduplicated via
 * {@link dedupeInFlight}: only one LLM call fires; all waiting callers
 * receive the same result.
 *
 * Pass `options.signal` (e.g. `request.signal` from the SSE route handler)
 * so a dropped connection aborts the in-flight LLM call.
 *
 * @throws If `options.marketDataProvider` is absent on a cache miss, or if
 *   the AI provider call fails (network, 5xx, abort). Gate denials are
 *   returned as `{status:'error'}`, not thrown.
 *
 * @see submitAnalysis — the queued predecessor; still exported for the
 *   existing production path until siglens switches to runAnalysis.
 */
export async function runAnalysis(
    symbol: string,
    companyName: string,
    timeframe: Timeframe,
    force?: boolean,
    fmpSymbol?: string,
    options: SubmitAnalysisOptions = {}
): Promise<RunAnalysisResult> {
    const tier = options.tierContext?.tier ?? DEFAULT_TIER;
    const tierConfig = options.tierConfig ?? TIER_CONFIG;

    if (!isTimeframeAllowed(tier, timeframe, tierConfig)) {
        return {
            status: 'error',
            error: buildTimeframeNotAllowedError(tier, timeframe, tierConfig),
        };
    }

    // effectiveModelId is used for cache-key construction and usage recording.
    // It may be 'analysis-worker' (the legacy routing sentinel) when no modelId
    // is supplied — that string is intentionally stable for cache compatibility.
    const effectiveModelId = options.modelId ?? DEFAULT_ANALYSIS_MODEL_ID;

    // callAnalysisAi requires a real ActiveModelId present in MODEL_SPECS.
    // 'analysis-worker' is not a model — it only lives in cache keys. When no
    // specific model was requested, resolve to the free-tier default.
    const callModelId: ActiveModelId =
        options.modelId !== undefined &&
        (options.modelId as string) in MODEL_SPECS
            ? (options.modelId as ActiveModelId)
            : DEFAULT_RUN_ANALYSIS_MODEL;

    if (
        options.modelId !== undefined &&
        requiresByokKey(tier, options.modelId, tierConfig) &&
        options.userApiKey === undefined
    ) {
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

    // Skills are loaded once; the same load serves both the sampling plan
    // (for cache-key + prompt assembly) and confidence enrichment (post-LLM).
    // `skillsDegraded` reflects THIS load — the label written to the cache
    // entry always matches the data actually used.
    const { skills, skillsDegraded } = await loadSkillsCached();
    const skillSampling = createSkillSamplingPlan(skills, tier, [
        'technical',
        symbol,
        timeframe,
        effectiveModelId,
        reasoningSeedPart(options.reasoning),
        tier,
    ]);

    const cache = createCacheProvider();
    const cacheKey = buildAnalysisCacheKey(
        symbol,
        timeframe,
        effectiveModelId,
        `${tier}:${skillSampling.fingerprint}`,
        options.reasoning,
        options.positionBucket
    );

    if (!force && cache !== null) {
        try {
            const cached = await cache.get<AnalysisResponse>(cacheKey);
            if (cached !== null) {
                const normalized = normalizeCachedAnalysisResponse(cached);
                const filtered = filterAnalysisResult(
                    normalized,
                    tier,
                    tierConfig
                );
                await recordAnalysisUsageSafely(
                    usage,
                    effectiveModelId,
                    usageOccurredAt
                );
                return { status: 'cached', ...filtered };
            }
        } catch (error) {
            console.error('[RunAnalysis] Cache read failed:', error);
        }
    }

    if (options.skipEnqueueIfMiss) {
        return { status: 'miss_no_trigger' };
    }

    const { marketDataProvider } = options;
    if (marketDataProvider == null) {
        throw new Error(
            'runAnalysis: options.marketDataProvider is required to fetch bars on a cache miss'
        );
    }

    const { bars, indicators } = await fetchBarsWithIndicators(
        marketDataProvider,
        symbol,
        timeframe,
        fmpSymbol
    );

    // lastClose and atr are local variables — no Redis meta write needed.
    const lastClose = bars[bars.length - 1]?.close;
    const atr = lastNonNull(indicators.atr) ?? undefined;

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
                '[RunAnalysis] FearGreed daily fetch/compute failed; proceeding without sentiment:',
                error
            );
            return null;
        });

    const { stable, dynamic } = buildAnalysisPrompt(
        symbol,
        companyName,
        bars,
        indicators,
        skillSampling.skills,
        timeframe,
        fearGreed ?? undefined,
        options.assetClass ?? 'equity',
        options.positionBucket
    );

    // Design C: the always-on skill digest (`stable`) folds into SYSTEM so
    // providers with a stable-system cache hit amortise the cost.
    const system = stable
        ? `${AI_SYSTEM_PROMPT}\n\n${stable}`
        : AI_SYSTEM_PROMPT;
    const prompt = dynamic;

    const raw = await dedupeInFlight(cacheKey, () =>
        callAnalysisAi({
            prompt,
            model: callModelId,
            tier,
            userApiKey: options.userApiKey,
            signal: options.signal,
            system,
            responseSchema: TECHNICAL_RESPONSE_SCHEMA,
            seed: analysisSeed(`${system}\n\n${prompt}`),
            reasoning: options.reasoning,
            correlationId: `${symbol}:${timeframe}`,
        })
    );

    // Inline post-processing (formerly in pollAnalysis). No job queue involved.
    const rawResult = JSON.parse(raw) as unknown;
    const enriched = enrichAnalysisWithConfidence(rawResult, skills);
    const reconciled = postProcessAnalysisWithReconcile(
        enriched,
        lastClose,
        atr
    );

    const now = new Date();
    const analyzedAt = now.toISOString();
    const result = { ...reconciled, analyzedAt };

    if (isFallbackAnalysis(reconciled)) {
        console.warn(
            '[RunAnalysis] LLM returned empty analysis; skipping cache write',
            { symbol }
        );
    } else if (cache !== null) {
        const ttl = computeEffectiveTtl(timeframe, now);
        // Fire-and-forget: cache write must not delay the SSE response.
        cache
            .set(cacheKey, { ...result, skillsDegraded }, ttl)
            .catch(error =>
                console.error('[RunAnalysis] Cache write failed:', error)
            );
    }

    await recordAnalysisUsageSafely(usage, effectiveModelId, usageOccurredAt);

    const filtered = filterAnalysisResult(result, tier, tierConfig);
    return { status: 'done', ...filtered };
}
