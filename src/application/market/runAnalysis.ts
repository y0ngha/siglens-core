import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { dedupeInFlight } from '@/application/analysis/inFlight';
import { notifyPromptAssembled } from '@/application/analysis/notifyPromptAssembled';
import { DEEPSEEK_V4_1_FLASH_MODEL } from '@/application/chat/constants';
import { fetchBarsWithIndicators } from '@/application/market/barsApi';
import { buildUserApiKeyRequiredError } from '@/application/byok/gate';
import {
    buildTimeframeNotAllowedError,
    type RunAnalysisResult,
    type SubmitAnalysisOptions,
    type SubmitAnalysisErrorResult,
    type SubmitAnalysisMissNoTrigger,
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
import { normalizeIdList } from '@/domain/analysis/normalize';
import { asObject } from '@/domain/analysis/normalizePrimitives';
import {
    DEFAULT_ANALYSIS_LOCALE,
    outputLanguageReminder,
} from '@/domain/analysis/outputLocale';
import { buildAnalysisPrompt } from '@/domain/analysis/prompt';
import { TECHNICAL_RESPONSE_SCHEMA } from '@/domain/analysis/responseSchemas';
import { aiSystemPrompt } from '@/domain/analysis/systemPrompt';
import { computeFearGreedIndex } from '@/domain/indicators/fearGreed';
import { lastNonNull } from '@/domain/indicators/utils';
import { resolveChartOverlays } from '@/domain/overlays';
import {
    DEFAULT_TIER,
    TIER_CONFIG,
    isTimeframeAllowed,
    requiresByokKey,
} from '@/domain/tier';
import type {
    ActiveModelId,
    AnalysisResponse,
    AssembledPromptRecord,
    FearGreedSnapshot,
    Timeframe,
} from '@/domain/types';
import {
    ANALYSIS_CACHE_TTL,
    buildAnalysisCacheKey,
    buildAnalysisPeekCacheKey,
    computeEffectiveTtl,
    DEFAULT_ANALYSIS_MODEL_ID,
    narrowMarketEventsForCacheKey,
    narrowPriorAnalysesForCacheKey,
    PROMPT_TEMPLATE_VERSION,
} from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { analysisSeed } from '@/infrastructure/hash/analysisInput';
import { loadSkillsCached } from '@/infrastructure/skills/loader';
import {
    createSkillSamplingPlan,
    reasoningSeedPart,
} from '@/infrastructure/skills/sampling';

/**
 * Result of `runAnalysisForOverall` — the internal (non-filtered) sibling of
 * `runAnalysis` used by `runOverallAnalysis` to feed the full `AnalysisResponse`
 * into the overall prompt builder.
 *
 * Unlike `RunAnalysisResult`, the `result` field is always the unfiltered
 * `AnalysisResponse` — `filterAnalysisResult` is NOT called. This mirrors the
 * `submitAnalysisForOverall` → `submitAnalysisWithVisibility('internal')` pattern
 * from the queued path: the overall prompt builder accesses `tech.keyLevels.*`
 * and similar fields directly, which would crash if those fields were null
 * (as they are in `FilteredAnalysisResponse` for lower tiers).
 *
 * Tier-level access control for the overall analysis is therefore enforced at
 * the overall layer (timeframe gate, usage gate, BYOK gate) rather than at the
 * per-field filtering level — consistent with the queued predecessor.
 */
export type RunAnalysisForOverallResult =
    | { status: 'cached'; result: AnalysisResponse }
    | { status: 'done'; result: AnalysisResponse }
    | SubmitAnalysisMissNoTrigger
    | SubmitAnalysisErrorResult;

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
const DEFAULT_RUN_ANALYSIS_MODEL: ActiveModelId = DEEPSEEK_V4_1_FLASH_MODEL;

/**
 * Shared implementation for `runAnalysis` (public, filtered) and
 * `runAnalysisForOverall` (internal, unfiltered).
 *
 * `skipFilter = false` → applies `filterAnalysisResult` before returning
 * (public API: caller receives the tier-appropriate field set).
 * `skipFilter = true`  → returns the raw `AnalysisResponse` without filtering
 * (internal API: `runOverallAnalysis` needs the full payload for its prompt builder).
 */
async function runAnalysisImpl(
    skipFilter: boolean,
    symbol: string,
    companyName: string,
    timeframe: Timeframe,
    force?: boolean,
    fmpSymbol?: string,
    options: SubmitAnalysisOptions = {}
): Promise<RunAnalysisResult | RunAnalysisForOverallResult> {
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

    // `narrowPriorAnalysesForCacheKey` is called exactly ONCE, from a single
    // `Date`, and its `candidates` output is reused for BOTH the cache-key
    // fingerprint below AND the `buildAnalysisPrompt` call further down —
    // never re-derived from a second `new Date()`. Two independent calls
    // could straddle the cache-window boundary and make the key and the
    // prompt disagree about which prior analyses are "in the window" — see
    // `narrowPriorAnalysesForCacheKey`'s doc. (Named `priorAnalysisNow`,
    // distinct from the write-time `now` created later in this function for
    // `analyzedAt`/TTL — an unrelated timestamp.)
    const priorAnalysisNow = new Date();
    const {
        candidates: priorAnalysisCandidates,
        fingerprint: historyFingerprint,
    } = narrowPriorAnalysesForCacheKey(
        options.priorAnalyses ?? [],
        ANALYSIS_CACHE_TTL[timeframe],
        priorAnalysisNow
    );

    // 이벤트는 봉 없이 좁힌다 — 캐시 키가 봉 fetch보다 먼저 만들어져야 하기
    // 때문이다(이력과 같은 순서 제약). 봉 기준 절단은 프롬프트 렌더 단계의
    // `selectMarketEvents`가 맡는다.
    const {
        candidates: marketEventCandidates,
        fingerprint: eventsFingerprint,
    } = narrowMarketEventsForCacheKey(options.marketEvents ?? []);

    const cache = createCacheProvider();
    const cacheKey = buildAnalysisCacheKey(
        symbol,
        timeframe,
        effectiveModelId,
        `${tier}:${skillSampling.fingerprint}`,
        options.reasoning,
        options.positionBucket,
        options.locale,
        historyFingerprint,
        eventsFingerprint
    );

    if (!force && cache !== null) {
        try {
            const cached = await cache.get<AnalysisResponse>(cacheKey);
            if (cached !== null) {
                const normalized = normalizeCachedAnalysisResponse(cached);
                await recordAnalysisUsageSafely(
                    usage,
                    effectiveModelId,
                    usageOccurredAt
                );
                if (skipFilter) {
                    return { status: 'cached', result: normalized };
                }
                const filtered = filterAnalysisResult(
                    normalized,
                    tier,
                    tierConfig
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

    const locale = options.locale ?? DEFAULT_ANALYSIS_LOCALE;
    const { stable, dynamic, overlayCandidates, overlayBuildFailures } =
        buildAnalysisPrompt(
            symbol,
            companyName,
            bars,
            indicators,
            skillSampling.skills,
            timeframe,
            fearGreed ?? undefined,
            options.assetClass ?? 'equity',
            options.positionBucket,
            locale,
            priorAnalysisCandidates,
            marketEventCandidates,
            options.currency
        );

    // Design C: the always-on skill digest (`stable`) folds into SYSTEM so
    // providers with a stable-system cache hit amortise the cost.
    const system = stable
        ? `${aiSystemPrompt(locale)}\n\n${stable}`
        : aiSystemPrompt(locale);
    // 출력 언어를 **마지막 지시**로 한 번 더 못 박는다 — 유저 프롬프트의 필드
    // 설명은 언어를 `Korean`으로 적어 둔 곳이 많아 그것만으로는 뒤집히지 않는다.
    // 기본 로케일(ko)에서는 빈 문자열이라 프롬프트 바이트가 예전과 같다.
    const prompt = `${dynamic}${outputLanguageReminder(locale)}`;

    const raw = await dedupeInFlight(cacheKey, () => {
        // Fired INSIDE the dedup factory, not before it. Every concurrent
        // caller that misses the same cache key builds its own prompt, but
        // `dedupeInFlight` runs only the first one's factory and hands the
        // rest that winner's result. Firing outside would call back once per
        // caller for a single real generation, and — worse — hand every
        // losing caller a prompt that was never sent, while the result they
        // receive came from the winner's. A consumer persisting "the prompt
        // that produced this row" would store duplicates and misattribute
        // the text.
        notifyPromptAssembled(
            options.onPromptAssembled,
            {
                system,
                stable,
                dynamic: prompt,
                promptVersion: PROMPT_TEMPLATE_VERSION,
            } satisfies AssembledPromptRecord,
            '[RunAnalysis]'
        );

        return callAnalysisAi({
            prompt,
            model: callModelId,
            tier,
            userApiKey: options.userApiKey,
            signal: options.signal,
            fallbackOnProviderFailure: options.providerFallback,
            system,
            responseSchema: TECHNICAL_RESPONSE_SCHEMA,
            seed: analysisSeed(`${system}\n\n${prompt}`),
            reasoning: options.reasoning,
            correlationId: `${symbol}:${timeframe}`,
        });
    });

    // Inline post-processing (formerly in pollAnalysis). No job queue involved.
    const rawResult = JSON.parse(raw) as unknown;
    const enriched = enrichAnalysisWithConfidence(rawResult, skills);
    const reconciled = postProcessAnalysisWithReconcile(
        enriched,
        lastClose,
        atr,
        options.currency,
        locale
    );

    const resolvedOverlays = resolveChartOverlays(
        overlayCandidates,
        reconciled,
        normalizeIdList(asObject(rawResult)?.trendlineIds),
        skills
    );
    if (overlayBuildFailures.length > 0) {
        console.warn('[ChartOverlays] candidate builder failed', {
            symbol,
            timeframe,
            kinds: overlayBuildFailures,
        });
    }
    if (resolvedOverlays.unknownIds.length > 0) {
        console.warn('[ChartOverlays] unknown candidate id', {
            symbol,
            timeframe,
            unknownIds: resolvedOverlays.unknownIds,
        });
    }
    // Referral-rate signal (spec 2026-09-28 §7): candidates were offered but
    // the model cited none. Logged only on that anomaly — this layer has no
    // info-level logging convention to hang a per-call ratio on.
    if (
        overlayCandidates.length > 0 &&
        resolvedOverlays.chartOverlays.length === 0
    ) {
        console.warn('[ChartOverlays] no candidate referenced', {
            symbol,
            timeframe,
            offered: overlayCandidates.length,
        });
    }

    const now = new Date();
    const analyzedAt = now.toISOString();
    const result = {
        ...reconciled,
        trendlines: resolvedOverlays.trendlines,
        chartOverlays: resolvedOverlays.chartOverlays,
        analyzedAt,
    };

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
        // Peek pointer — the key a read-only caller (SSR seed, chat tool) can
        // rebuild without this request's history/events reads. Same TTL, so
        // it never outlives the exact entry it mirrors. Written on fresh
        // generations only, not on cache hits: an exact entry that predates
        // the pointer self-heals within one TTL (and the anchored history
        // window already changes every key once on deploy, so there are no
        // pre-pointer entries worth backfilling).
        cache
            .set(
                buildAnalysisPeekCacheKey(
                    symbol,
                    timeframe,
                    effectiveModelId,
                    tier,
                    options.reasoning,
                    options.positionBucket,
                    options.locale
                ),
                { ...result, skillsDegraded },
                ttl
            )
            .catch(error =>
                console.error('[RunAnalysis] Peek cache write failed:', error)
            );
    }

    await recordAnalysisUsageSafely(usage, effectiveModelId, usageOccurredAt);

    if (skipFilter) {
        return { status: 'done', result };
    }
    const filtered = filterAnalysisResult(result, tier, tierConfig);
    // `result`(필터 전)를 함께 돌려준다 — 렌더는 `filtered`, 이력 저장은
    // `unfilteredResult`가 맞다. 근거는 `RunAnalysisResult` JSDoc 참고.
    return { status: 'done', ...filtered, unfilteredResult: result };
}

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
    return runAnalysisImpl(
        false,
        symbol,
        companyName,
        timeframe,
        force,
        fmpSymbol,
        options
    ) as Promise<RunAnalysisResult>;
}

/**
 * Internal variant of {@link runAnalysis} for use by {@link runOverallAnalysis}.
 *
 * Identical to `runAnalysis` except that `filterAnalysisResult` is NOT applied —
 * the caller always receives the full, unfiltered `AnalysisResponse`. This is
 * required because `buildOverallAnalysisPrompt` accesses `tech.keyLevels.*`,
 * `tech.indicatorResults`, and other fields that `FilteredAnalysisResponse` can
 * set to `null` for lower tiers, causing a runtime crash.
 *
 * Mirrors the `submitAnalysisForOverall` → `submitAnalysisWithVisibility('internal')`
 * pattern from the queued path.
 *
 * @see runAnalysis for the public (tier-filtered) variant.
 * @see runOverallAnalysis for the only intended caller.
 */
export async function runAnalysisForOverall(
    symbol: string,
    companyName: string,
    timeframe: Timeframe,
    force?: boolean,
    fmpSymbol?: string,
    options: SubmitAnalysisOptions = {}
): Promise<RunAnalysisForOverallResult> {
    return runAnalysisImpl(
        true,
        symbol,
        companyName,
        timeframe,
        force,
        fmpSymbol,
        options
    ) as Promise<RunAnalysisForOverallResult>;
}
