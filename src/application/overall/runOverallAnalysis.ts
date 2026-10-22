import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { dedupeGeneration } from '@/application/analysis/generationLock';
import { notifyPromptAssembled } from '@/application/analysis/notifyPromptAssembled';
import {
    buildUserApiKeyRequiredError,
    isUserApiKeyGateDenied,
    resolveInFlightKey,
} from '@/application/byok/gate';
import { fetchBarsWithIndicators } from '@/application/market/barsApi';
import { buildTimeframeNotAllowedError } from '@/application/market/types';
import { runAnalysisForOverall } from '@/application/market/runAnalysis';
import { runFundamentalAnalysis } from '@/application/fundamental/runFundamentalAnalysis';
import { runNewsAnalysis } from '@/application/news/runNewsAnalysis';
import { runOptionsAnalysis } from '@/application/options/runOptionsAnalysis';
import type {
    RunOverallAnalysisOptions,
    RunOverallAnalysisResult,
    SubmitOverallAnalysisApiKeyRequiredError,
} from '@/application/overall/types';
import {
    buildUsageLimitError,
    checkAnalysisUsageAllowed,
    recordAnalysisUsageSafely,
} from '@/application/usage';
import { normalizeOverallAnalysisResponse } from '@/domain/analysis/normalizeOverall';
import {
    DEFAULT_ANALYSIS_LOCALE,
    outputLanguageReminder,
} from '@/domain/analysis/outputLocale';
import { buildOverallAnalysisPrompt } from '@/domain/analysis/overallPrompt';
import {
    OVERALL_RESPONSE_SCHEMA,
    OVERALL_WITH_INVESTOR_FLOWS_RESPONSE_SCHEMA,
} from '@/domain/analysis/responseSchemas';
import { overallSystemPrompt } from '@/domain/analysis/systemPrompt';
import {
    computeFearGreedIndex,
    fearGreedInputs,
} from '@/domain/indicators/fearGreed';
import { isByokOnly } from '@/domain/keyRouting';
import { pickNearestExpiration } from '@/domain/options/pickNearestExpiration';
import { DEFAULT_TIER, isTimeframeAllowed, TIER_CONFIG } from '@/domain/tier';
import type {
    ActiveModelId,
    AnalysisResponse,
    AssembledPromptRecord,
    Bar,
    FundamentalAnalysisResponse,
    OptionsAnalysisResponse,
    OverallAnalysisResponse,
} from '@/domain/types';
import { MODEL_SPECS } from '@/domain/analysis/modelSpecs';
import { DEEPSEEK_V4_1_FLASH_MODEL } from '@/application/chat/constants';
import {
    buildOverallCacheKey,
    buildOverallPeekCacheKey,
    narrowPriorAnalysesForCacheKey,
    OVERALL_CACHE_TTL_SECONDS,
} from '@/infrastructure/cache/config';
import { resolveCacheProvider } from '@/application/shared/resolveCacheProvider';
import {
    analysisSeed,
    hashAnalysisInput,
} from '@/infrastructure/hash/analysisInput';

/**
 * Default model for the overall synthesis LLM call when `options.modelId` is
 * absent or not a known `ActiveModelId`. Mirrors `runAnalysis`'s fallback.
 */
const DEFAULT_RUN_OVERALL_MODEL: ActiveModelId = DEEPSEEK_V4_1_FLASH_MODEL;

/**
 * `AssembledPromptRecord.promptVersion` for the OVERALL axis.
 *
 * This is a literal placeholder for the **stored-prompt record only**, not a
 * generation counter.
 *
 * ⚠️ It is NOT the overall cache key's version segment. `OVERALL_PROMPT_TEMPLATE_VERSION`
 * (`infrastructure/cache/config.ts`) is that, and both `buildOverallCacheKey` and
 * `buildOverallPeekCacheKey` embed it — so a prompt-template change must bump
 * **that** constant. An earlier version of this comment claimed the overall axis
 * had no such constant and that the key carried no version segment; both were
 * false, and believing them is exactly what makes a needed bump easy to miss.
 *
 * Wire this field to that constant if/when stored-prompt grouping by generation
 * starts to matter for this axis.
 */
const OVERALL_PROMPT_VERSION_PLACEHOLDER = 'overall-unversioned';

/**
 * Strip volatile, write-time-only fields from a cached technical `AnalysisResponse`
 * so the overall input hash stays stable across runs.
 *
 * `analyzedAt` is rewritten on every run; `skillsDegraded` is a transient
 * loader-health flag; `dataAsOf` is consumer-facing metadata derived from the
 * same bars the technical text already reflects, and entries cached before it
 * existed lack it — keeping it would change the overall key once per symbol
 * for no change in prompt content. None belongs in the hashing surface.
 */
function stripVolatileTechnicalFields(
    technical: AnalysisResponse
): Omit<AnalysisResponse, 'analyzedAt' | 'dataAsOf'> {
    const {
        analyzedAt: _analyzedAt,
        dataAsOf: _dataAsOf,
        skillsDegraded: _skillsDegraded,
        ...rest
    } = technical as AnalysisResponse & { skillsDegraded?: boolean };
    return rest;
}

/**
 * Strip the `analyzedAt` field from an options response so the overall hash
 * stays stable. `null` (graceful skip / crypto) passes through unchanged.
 */
function stripVolatileOptionsFields(
    options: OptionsAnalysisResponse | null | undefined
): Omit<OptionsAnalysisResponse, 'analyzedAt'> | null {
    if (options === null || options === undefined) return null;
    const { analyzedAt: _analyzedAt, ...rest } = options;
    return rest;
}

/**
 * Run an overall (4-axis: technical + fundamental + news + options) analysis
 * end-to-end, server-side.
 *
 * All four dependency axes are awaited server-side via `Promise.all`, so no
 * "pending dependencies" state can occur here.
 *
 * Signal threading: `options.signal` is forwarded to every dependency `run*`
 * call and to the overall `callAnalysisAi` call. When the client disconnects,
 * the entire dependency tree plus the overall LLM call are aborted atomically —
 * no in-flight call leaks after the request ends.
 *
 * Result shape: `cached | done | miss_no_trigger | error | limit_error | key_error`.
 * The `pending_dependencies` and `submitted` variants from `SubmitOverallAnalysisResult`
 * are intentionally absent — they cannot occur in the direct-await world.
 *
 * Usage is recorded AFTER the overall LLM returns so an aborted or failed call
 * does not consume quota. Dependency axes run with `dropAxisUsage: true` (usage
 * is owned at this layer, not per axis) — one overall call = one analysis recorded.
 *
 * @throws If the overall AI provider call fails (network, 5xx, AbortError).
 *   Gate denials are returned as discriminated-union variants, not thrown.
 */
export async function runOverallAnalysis(
    options: RunOverallAnalysisOptions
): Promise<RunOverallAnalysisResult> {
    const { symbol, companyName = symbol, timeframe, modelId } = options;
    const usage = options.usage;
    const occurredAt = options.now ?? usage?.occurredAt ?? new Date();
    const reasoning = options.reasoning;
    const { signal } = options;

    const tier = options.tier ?? DEFAULT_TIER;
    const tierConfig = options.tierConfig ?? TIER_CONFIG;

    // ── 0. Timeframe gate ──
    if (!isTimeframeAllowed(tier, timeframe, tierConfig)) {
        return {
            status: 'error',
            axis: 'technical',
            error: buildTimeframeNotAllowedError(tier, timeframe, tierConfig),
        };
    }

    // ── 1. BYOK gate for overall job's own AI call ──
    // A byok-only cache probe (`skipEnqueueIfMiss`) skips this early gate: every
    // axis and the overall step then end at `miss_no_trigger` on a miss, so no
    // provider call can happen, and a cached overall entry is served keyless —
    // the same contract as the single-axis use-cases. A generating byok-only
    // call still fails fast here, before the axes run.
    if (
        !(
            isByokOnly(options.keyPolicy) && options.skipEnqueueIfMiss === true
        ) &&
        isUserApiKeyGateDenied(
            tier,
            modelId,
            tierConfig,
            options.userApiKey,
            options.keyPolicy
        )
    ) {
        return buildUserApiKeyRequiredError(
            tier,
            modelId
        ) as SubmitOverallAnalysisApiKeyRequiredError;
    }

    // ── 2. Overall-scoped usage limit check ──
    // One overall call = one analysis. The dependency axes run with usage
    // omitted so they do not check or record independently.
    if (options.tier !== undefined && usage !== undefined) {
        const allowed = await checkAnalysisUsageAllowed(
            usage,
            tier,
            occurredAt,
            tierConfig
        );
        if (!allowed) {
            return {
                status: 'limit_error',
                code: 'usage_limit_exceeded',
                error: buildUsageLimitError('analysisPerDay', tier),
            };
        }
    }

    // One cache for the whole run: resolved once here and forwarded to every
    // dependency axis, so an injected cache (or an explicit `null`) is honoured
    // by the axes, the overall read/write, the peek pointer and the in-flight lock.
    const cache = resolveCacheProvider(options.cache);

    // ── 3. Resolve all four dependency axes in parallel ──
    // Signal is threaded through so a client disconnect aborts the whole tree.
    // `usage` is intentionally omitted from every axis call (owned at this layer).
    const {
        technical: technicalOptions,
        fundamentalProvider,
        marketDataProvider,
        newsItems: newsItemsInput,
        news: newsField,
        upcomingCalendar,
        macroCalendar,
        optionsSnapshot,
        options: optionsAxisOptions,
        force: topLevelForce,
        assetClass,
    } = options;

    const isCrypto = assetClass === 'crypto';
    const effectiveAxisForce = topLevelForce ?? false;
    const topLevelTier = options.tier;
    const topLevelUserApiKey = options.userApiKey;
    const topLevelSkipEnqueueIfMiss = options.skipEnqueueIfMiss;

    // Resolve the news items from the two legacy shapes (array or options object)
    const newsFieldIsArray = Array.isArray(newsField);
    const resolvedNewsItems =
        newsItemsInput ?? (newsFieldIsArray ? newsField : undefined);
    if (resolvedNewsItems === undefined) {
        throw new Error(
            "RunOverallAnalysisOptions: missing news items — supply 'newsItems' (preferred) or the legacy 'news' array."
        );
    }

    // Per-axis options (no `usage` — owned at overall layer)
    const {
        force: technicalForce = false,
        fmpSymbol: technicalFmpSymbol,
        ...technicalRest
    } = technicalOptions;
    const effectiveTechnicalForce = topLevelForce ?? technicalForce;

    // Options axis preflight: pick nearest expiration
    const optionsExpirationDate =
        !isCrypto && optionsSnapshot !== undefined
            ? pickNearestExpiration(optionsSnapshot, new Date())
            : null;

    type OptionsRunResult =
        | Awaited<ReturnType<typeof runOptionsAnalysis>>
        | {
              status: 'no_chains_error';
              code: 'no_options_chains';
              error: string;
          };

    type FundamentalRunResult =
        | Awaited<ReturnType<typeof runFundamentalAnalysis>>
        | {
              status: 'no_fundamental_crypto';
              code: 'no_fundamental_crypto';
              error: string;
          };

    // Options axis: skip gracefully when no snapshot or crypto
    const optionsRun: Promise<OptionsRunResult> =
        !isCrypto &&
        optionsSnapshot !== undefined &&
        optionsExpirationDate !== null
            ? runOptionsAnalysis({
                  symbol,
                  companyName,
                  modelId,
                  snapshot: optionsSnapshot,
                  expirationDate: optionsExpirationDate,
                  tier: topLevelTier ?? DEFAULT_TIER,
                  userApiKey: topLevelUserApiKey,
                  reasoning,
                  locale: options.locale,
                  ...optionsAxisOptions,
                  skipEnqueueIfMiss: topLevelSkipEnqueueIfMiss,
                  force: effectiveAxisForce,
                  signal,
                  providerFallback: options.providerFallback,
                  keyPolicy: options.keyPolicy,
                  cache,
              })
            : Promise.resolve({
                  status: 'no_chains_error' as const,
                  code: 'no_options_chains' as const,
                  error: isCrypto
                      ? 'Crypto asset: options axis skipped'
                      : optionsSnapshot === undefined
                        ? 'No options snapshot provided'
                        : 'No usable future expiration in snapshot',
              });

    // Fundamental axis: skip gracefully for crypto
    const fundamentalRun: Promise<FundamentalRunResult> = isCrypto
        ? Promise.resolve({
              status: 'no_fundamental_crypto' as const,
              code: 'no_fundamental_crypto' as const,
              error: 'Crypto asset: fundamental axis skipped',
          })
        : runFundamentalAnalysis({
              symbol,
              modelId,
              dataProvider: fundamentalProvider,
              tier: topLevelTier ?? DEFAULT_TIER,
              userApiKey: topLevelUserApiKey,
              reasoning,
              locale: options.locale,
              currency: options.currency,
              ...options.fundamental,
              skipEnqueueIfMiss: topLevelSkipEnqueueIfMiss,
              force: effectiveAxisForce,
              signal,
              providerFallback: options.providerFallback,
              keyPolicy: options.keyPolicy,
              cache,
          });

    const [technicalResult, fundamentalResult, newsResult, optionsResult] =
        await Promise.all([
            runAnalysisForOverall(
                symbol,
                companyName,
                timeframe,
                effectiveTechnicalForce,
                technicalFmpSymbol,
                {
                    ...technicalRest,
                    marketDataProvider,
                    modelId: technicalRest.modelId ?? modelId,
                    userApiKey: technicalRest.userApiKey ?? topLevelUserApiKey,
                    reasoning: technicalRest.reasoning ?? reasoning,
                    /*
                     * 네 축 모두 최상위 값이 이긴다 — **어느 축의 옵션 타입에도
                     * `locale`이 없기 때문**이다. 바로 위 `reasoning`이 `??`를
                     * 쓰는 것과 규칙이 달라 보이지만, 양보할 축별 값 자체가
                     * 존재하지 않는다. 축별 언어를 주고 싶어지면 그 타입부터
                     * 넓혀야 하고, 그때 네 축을 함께 바꿔야 한다.
                     */
                    locale: options.locale,
                    currency: options.currency,
                    krxTickTable: options.krxTickTable,
                    tierContext:
                        technicalRest.tierContext ??
                        (topLevelTier !== undefined
                            ? { userId: null, tier: topLevelTier }
                            : undefined),
                    skipEnqueueIfMiss: topLevelSkipEnqueueIfMiss,
                    signal,
                    providerFallback: options.providerFallback,
                    keyPolicy: options.keyPolicy,
                    cache,
                }
            ),
            fundamentalRun,
            runNewsAnalysis({
                symbol,
                companyName,
                modelId,
                news: resolvedNewsItems,
                upcomingCalendar,
                macroCalendar,
                tier: topLevelTier ?? DEFAULT_TIER,
                userApiKey: topLevelUserApiKey,
                reasoning,
                locale: options.locale,
                currency: options.currency,
                // Must be forwarded: without it a crypto overall run builds
                // an equity-framed news prompt that, since `assetClass` is
                // not part of the news cache key, could be written under the
                // exact key a standalone crypto `/news` call reads.
                assetClass,
                ...(newsFieldIsArray
                    ? undefined
                    : (newsField as object | undefined)),
                skipEnqueueIfMiss: topLevelSkipEnqueueIfMiss,
                force: effectiveAxisForce,
                signal,
                providerFallback: options.providerFallback,
                keyPolicy: options.keyPolicy,
                cache,
            }),
            optionsRun,
        ]);

    // ── 4. Check for axis errors ──
    if (
        technicalResult.status === 'error' ||
        technicalResult.status === 'key_error'
    ) {
        return {
            status: 'error',
            axis: 'technical',
            error:
                technicalResult.status === 'error'
                    ? technicalResult.error
                    : technicalResult,
        };
    }
    if (
        fundamentalResult.status === 'error' ||
        fundamentalResult.status === 'key_error'
    ) {
        return {
            status: 'error',
            axis: 'fundamental',
            error:
                fundamentalResult.status === 'error'
                    ? (fundamentalResult.error ?? fundamentalResult.code)
                    : fundamentalResult,
        };
    }
    /**
     * 뉴스 축은 **재료가 없으면 빠진다**(abstain) — 실패와 구분한다.
     *
     * `code:'no_news'`의 트리거는 `news.length === 0` 하나뿐이다 — **원인은 core가
     * 모른다.** 조용한 구간, 발행 직전에 돈 적재, 프로바이더 0건 응답에서도 똑같이
     * 나온다. 그래서 프롬프트도 원인을 적지 않고 방향 중립 문구만 렌더한다
     * (`buildOverallAnalysisPrompt`의 `newsBody` 주석).
     *
     * 그럼에도 이걸 error로 올리지 않는 이유는 **관측된 모집단** 때문이다.
     * 레버리지 ETF·뮤추얼펀드·저커버리지 OTC 같은 심볼은 뉴스가 거의 없어, error로
     * 올리면 기술적·펀더멘털 데이터가 멀쩡해도 `overall`·`news` 스냅샷을 끝내
     * 만들지 못한다.
     *
     * `fundamental` 축이 크립토에서 이미 같은 모양으로 빠진다. 점수 쪽은
     * `OverallScoreInput.news`가 이미 nullable이라 abstain(weight 0)으로 처리된다.
     *
     * `RunNewsAnalysisResult`의 나머지 실패 — `code:'usage_limit_exceeded'`와
     * `key_error` — 는 그대로 올린다. 조건이 바뀌면 달라지는 상태이고, 조용히
     * 빈 축으로 접으면 품질 저하가 은폐된다. (LLM 호출 실패는 이 union에 없다 —
     * 예외로 던져진다.)
     */
    const newsAxisAbsent =
        newsResult.status === 'error' && newsResult.code === 'no_news';
    if (
        !newsAxisAbsent &&
        (newsResult.status === 'error' || newsResult.status === 'key_error')
    ) {
        return {
            status: 'error',
            axis: 'news',
            error:
                newsResult.status === 'error' ? newsResult.error : newsResult,
        };
    }
    if (
        optionsResult.status === 'limit_error' ||
        optionsResult.status === 'key_error'
    ) {
        return {
            status: 'error',
            axis: 'options',
            error: optionsResult,
        };
    }

    // ── 5. Any axis returned miss_no_trigger ──
    if (
        technicalResult.status === 'miss_no_trigger' ||
        fundamentalResult.status === 'miss_no_trigger' ||
        newsResult.status === 'miss_no_trigger' ||
        optionsResult.status === 'miss_no_trigger'
    ) {
        return { status: 'miss_no_trigger' };
    }

    // ── 6. Extract axis payloads ──
    // At this point all axes are in { cached | done | no_chains_error | no_fundamental_crypto }
    const technicalData = technicalResult.result as AnalysisResponse;
    const fundamentalData: FundamentalAnalysisResponse | null =
        fundamentalResult.status === 'cached' ||
        fundamentalResult.status === 'done'
            ? fundamentalResult.result
            : null;
    const newsData =
        newsResult.status === 'cached' || newsResult.status === 'done'
            ? newsResult.result
            : null;
    const optionsData: OptionsAnalysisResponse | null =
        optionsResult.status === 'cached' || optionsResult.status === 'done'
            ? optionsResult.result
            : null;

    /**
     * 뉴스 축이 비는 경로는 `no_news` **하나뿐**이어야 한다.
     *
     * 오늘 기준 `RunNewsAnalysisResult`는 `cached | done | miss_no_trigger |
     * no_news | limit_error | key_error`이고, 위 단계들이 `no_news`를 뺀 나머지를
     * 전부 걸러내므로 여기 도달하는 순간 `newsData === null`은 `newsAxisAbsent`와
     * 같은 집합이다.
     *
     * 그래도 가드를 남기는 이유: 그 동치는 **타입이 강제하지 않는다**. union에
     * 새 멤버가 추가되면 `newsData`가 조용히 `null`이 되고, 뉴스 축이 소리 없이
     * 빠진 채 분석이 그대로 캐시에 굳는다 — 컴파일도 테스트도 안 깨진다.
     * `&& !newsAxisAbsent` 형태는 `no_news`를 통과시키면서 그 경로만 막는다.
     */
    if (newsData === null && !newsAxisAbsent) {
        return {
            status: 'error',
            axis: 'news',
            error: 'News analysis returned no result',
        };
    }

    // ── 7. Hash combined inputs and check overall cache ──
    const stableTechnical = stripVolatileTechnicalFields(technicalData);
    const stableOptions = stripVolatileOptionsFields(optionsData);
    // Stage 1 of the two-stage prior-analysis narrowing (see
    // `narrowPriorAnalysesForCacheKey`'s doc). Unlike the technical axis
    // (`runAnalysis.ts`), the overall axis has no dedicated
    // `historyFingerprint` parameter on its cache-key builder —
    // `buildOverallCacheKey` already takes a caller-computed `inputHash`, so
    // the fingerprint folds into the SAME object literal below (`ph` key)
    // instead of a new key-builder parameter. `occurredAt` (this request's
    // resolved reference time — `options.now ?? usage?.occurredAt ?? new
    // Date()`, computed once at the top of this function) is reused here
    // rather than a fresh `new Date()`, and reused again unchanged for the
    // `buildOverallAnalysisPrompt` call in step 9 via `priorAnalysisCandidates`
    // — one `narrowPriorAnalysesForCacheKey` call feeds both the key and the
    // prompt, so they cannot disagree about which entries are "in the window".
    const {
        candidates: priorAnalysisCandidates,
        fingerprint: historyFingerprint,
    } = narrowPriorAnalysesForCacheKey(
        options.priorAnalyses ?? [],
        OVERALL_CACHE_TTL_SECONDS,
        occurredAt,
        // The overall window is a day, so with a session it starts at the last
        // session boundary — the same spec the technical axis expires on.
        technicalOptions.session
    );
    const inputHash = hashAnalysisInput(
        JSON.stringify({
            t: stableTechnical,
            f: fundamentalData,
            n: newsData,
            o: stableOptions,
            fin: options.financialsScorecard,
            investorFlows: options.investorFlowsScorecard,
            ph: historyFingerprint,
        })
    );
    const cacheKey = buildOverallCacheKey(
        symbol,
        timeframe,
        modelId,
        inputHash,
        reasoning,
        options.locale
    );
    if (cache !== null) {
        try {
            const cached = await cache.get<OverallAnalysisResponse>(cacheKey);
            if (cached !== null) {
                const result = normalizeOverallAnalysisResponse(cached, {
                    optionsOiStale: options.optionsOiStale,
                });
                await recordAnalysisUsageSafely(usage, modelId, occurredAt);
                return { status: 'cached', result };
            }
        } catch (error) {
            console.error('[RunOverallAnalysis] Cache read failed:', error);
        }
    }

    if (options.skipEnqueueIfMiss) {
        return { status: 'miss_no_trigger' };
    }

    // ── 8. Fetch daily fear/greed snapshot for the overall prompt ──
    if (marketDataProvider == null) {
        throw new Error(
            'runOverallAnalysis: options.marketDataProvider is required to fetch the daily fear/greed snapshot'
        );
    }

    const fmpSymbol = technicalOptions.fmpSymbol;

    // 8b. Bars for the prior-analysis section (`buildOverallAnalysisPrompt`'s
    // `bars` param). This function does not otherwise hold the subject
    // symbol's bars at the OVERALL timeframe.
    //
    // Gated on there being candidates to render. `fetchBarsWithIndicators` is
    // a pass-through to `provider.getBars()` with NO caching inside core —
    // whether it is a cheap repeat call is a property of the injected
    // `MarketDataProvider`, which core cannot assume. Without this gate every
    // overall cache miss would pay a bar fetch plus a full
    // `calculateIndicators` pass whose indicators are then discarded, even
    // though no consumer supplies `priorAnalyses` yet.
    //
    // The Fear & Greed snapshot always needs the DAILY series, whatever the
    // overall request's own timeframe is. Held as one promise so the
    // prior-analysis path can share it: on a '1Day' overall request the two
    // fetches would otherwise carry byte-identical arguments and, since
    // `fetchBarsWithIndicators` does not cache, pay for the same upstream call
    // and the same `calculateIndicators` pass twice.
    //
    // Failure is logged HERE, once, rather than in each derived promise's own
    // catch. When the two share this promise a single upstream failure would
    // otherwise print two console lines for one cause, which reads like two
    // independent incidents. Both derived paths still degrade independently
    // below — Fear & Greed to `null`, prior-analysis bars to `undefined` —
    // so neither can fail the overall analysis.
    const dailyBarsPromise = fetchBarsWithIndicators(
        marketDataProvider,
        symbol,
        '1Day',
        fmpSymbol
    ).catch(error => {
        console.error(
            '[RunOverallAnalysis] Daily bars fetch failed; proceeding without sentiment, and without prior-analysis context when the request timeframe is 1Day:',
            error
        );
        return null;
    });

    const fearGreedPromise = dailyBarsPromise
        .then(d => {
            if (d === null) return null;
            const input = fearGreedInputs(d);
            return computeFearGreedIndex(input.bars, input.buySellVolume);
        })
        // Guards the COMPUTE step, not the fetch — that already logged above.
        // Before the two paths shared one promise, fetch and compute sat in a
        // single chain under one `catch`; splitting them left the compute step
        // unprotected, so a throw inside `computeFearGreedIndex` would reject
        // `Promise.all` and fail the whole overall analysis. Nothing in that
        // call throws today, but the comment above promises Fear & Greed
        // degrades to `null` no matter what, and the code has to actually
        // honour that rather than rely on a callee never changing.
        .catch(error => {
            console.error(
                '[RunOverallAnalysis] FearGreed computation failed; proceeding without sentiment:',
                error
            );
            return null;
        });

    const priorAnalysisBarsPromise: Promise<Bar[] | undefined> =
        priorAnalysisCandidates.length === 0
            ? Promise.resolve(undefined)
            : timeframe === '1Day'
              ? dailyBarsPromise.then(d => d?.bars)
              : fetchBarsWithIndicators(
                    marketDataProvider,
                    symbol,
                    timeframe,
                    fmpSymbol
                )
                    .then(d => d.bars)
                    .catch(error => {
                        console.error(
                            '[RunOverallAnalysis] Prior-analysis bars fetch failed; proceeding without prior-analysis context:',
                            error
                        );
                        return undefined;
                    });

    const [fearGreed, priorAnalysisBars] = await Promise.all([
        fearGreedPromise,
        priorAnalysisBarsPromise,
    ]);

    // ── 9. Build overall prompt ──
    const optionsOiStale = options.optionsOiStale ?? false;
    const locale = options.locale ?? DEFAULT_ANALYSIS_LOCALE;
    const { stable, dynamic } = buildOverallAnalysisPrompt(
        symbol,
        companyName,
        technicalData,
        fundamentalData,
        newsData,
        timeframe,
        fearGreed ?? undefined,
        optionsData,
        optionsOiStale,
        options.financialsScorecard,
        options.assetClass ?? 'equity',
        locale,
        priorAnalysisBars,
        priorAnalysisCandidates,
        options.currency,
        options.investorFlowsScorecard,
        options.krxTickTable
    );
    // Design C: `stable` is always '' for the overall builder (no skills catalog),
    // so system stays the base persona unchanged.
    const system = stable
        ? `${overallSystemPrompt(locale)}\n\n${stable}`
        : overallSystemPrompt(locale);
    // 출력 언어를 **마지막 지시**로 한 번 더 못 박는다 — 유저 프롬프트의 필드
    // 설명은 언어를 `Korean`으로 적어 둔 곳이 많아 그것만으로는 뒤집히지 않는다.
    // 기본 로케일(ko)에서는 빈 문자열이라 프롬프트 바이트가 예전과 같다.
    const prompt = `${dynamic}${outputLanguageReminder(locale)}`;

    // Resolve the callable model (overall uses the same sentinel logic as runAnalysis)
    const callModelId: ActiveModelId =
        (modelId as string) in MODEL_SPECS
            ? (modelId as ActiveModelId)
            : DEFAULT_RUN_OVERALL_MODEL;

    // ── 10. LLM call (with in-flight deduplication) ──
    const raw = await dedupeGeneration(
        cache,
        cacheKey,
        () => {
            // Fired INSIDE the dedup factory — see the same comment in
            // `runAnalysis.ts`. Every concurrent caller missing this cache key
            // builds its own prompt, but only the first one's factory runs; the
            // rest receive that winner's result. Firing outside would call back
            // once per caller for one real generation and hand the losers a
            // prompt that was never sent.
            notifyPromptAssembled(
                options.onPromptAssembled,
                {
                    system,
                    stable,
                    dynamic: prompt,
                    promptVersion: OVERALL_PROMPT_VERSION_PLACEHOLDER,
                } satisfies AssembledPromptRecord,
                '[RunOverallAnalysis]'
            );

            return callAnalysisAi({
                prompt,
                model: callModelId,
                tier,
                userApiKey: options.userApiKey,
                keyPolicy: options.keyPolicy,
                signal,
                fallbackOnProviderFailure: options.providerFallback,
                system,
                responseSchema:
                    options.investorFlowsScorecard === undefined
                        ? OVERALL_RESPONSE_SCHEMA
                        : OVERALL_WITH_INVESTOR_FLOWS_RESPONSE_SCHEMA,
                seed: analysisSeed(`${system}\n\n${prompt}`),
                reasoning,
                correlationId: `${symbol}:overall`,
            });
        },
        {
            signal: signal,
            inFlightKey: resolveInFlightKey(
                cacheKey,
                options.keyPolicy,
                options.userApiKey
            ),
        }
    );

    // ── 11. Normalize and cache ──
    const normalized = normalizeOverallAnalysisResponse(
        JSON.parse(raw) as unknown,
        {
            optionsOiStale,
        }
    );
    // `analyzedAt` marks when THIS result was produced, so a peek/cache hit
    // can report its age — mirrors
    // `runAnalysis.ts`'s `analyzedAt` on the technical axis. A fresh clock
    // read here (not the request-start `occurredAt`) because the LLM call
    // above can take up to the poll timeout.
    const result: OverallAnalysisResponse = {
        ...normalized,
        analyzedAt: new Date().toISOString(),
    };

    if (result.headlineKo === '' && result.scenarios.length === 0) {
        console.warn('[RunOverallAnalysis] Empty overall analysis', { symbol });
    }

    if (cache !== null) {
        // Canonical key (exact-input hit for future runOverallAnalysis calls)
        cache
            .set(cacheKey, result, OVERALL_CACHE_TTL_SECONDS)
            .catch(error =>
                console.error('[RunOverallAnalysis] Cache write failed:', error)
            );
        // Content-free "peek" key (for SSR zero-cost surfacing via peekOverallAnalysisCache)
        const peekKey = buildOverallPeekCacheKey(
            symbol,
            timeframe,
            modelId,
            reasoning,
            options.locale
        );
        cache
            .set(peekKey, result, OVERALL_CACHE_TTL_SECONDS)
            .catch(error =>
                console.error(
                    '[RunOverallAnalysis] Peek cache write failed:',
                    error
                )
            );
    }

    // Record usage AFTER the LLM returns so an aborted call does not consume quota.
    await recordAnalysisUsageSafely(usage, modelId, occurredAt);

    return { status: 'done', result };
}
