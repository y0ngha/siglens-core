import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { dedupeInFlight } from '@/application/analysis/inFlight';
import { buildUserApiKeyRequiredError } from '@/application/byok/gate';
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
import { OVERALL_RESPONSE_SCHEMA } from '@/domain/analysis/responseSchemas';
import { overallSystemPrompt } from '@/domain/analysis/systemPrompt';
import { computeFearGreedIndex } from '@/domain/indicators/fearGreed';
import { pickNearestExpiration } from '@/domain/options/pickNearestExpiration';
import {
    DEFAULT_TIER,
    isTimeframeAllowed,
    requiresByokKey,
    TIER_CONFIG,
} from '@/domain/tier';
import type {
    ActiveModelId,
    AnalysisResponse,
    FearGreedSnapshot,
    FundamentalAnalysisResponse,
    OptionsAnalysisResponse,
    OverallAnalysisResponse,
} from '@/domain/types';
import { MODEL_SPECS } from '@/domain/analysis/modelSpecs';
import { DEEPSEEK_V4_FLASH_MODEL } from '@/application/chat/constants';
import {
    buildOverallCacheKey,
    buildOverallPeekCacheKey,
    OVERALL_CACHE_TTL_SECONDS,
} from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import {
    analysisSeed,
    hashAnalysisInput,
} from '@/infrastructure/hash/analysisInput';

/**
 * Default model for the overall synthesis LLM call when `options.modelId` is
 * absent or not a known `ActiveModelId`. Mirrors `runAnalysis`'s fallback.
 */
const DEFAULT_RUN_OVERALL_MODEL: ActiveModelId = DEEPSEEK_V4_FLASH_MODEL;

/**
 * Strip volatile, write-time-only fields from a cached technical `AnalysisResponse`
 * so the overall input hash stays stable across runs.
 *
 * `analyzedAt` is rewritten on every run; `skillsDegraded` is a transient
 * loader-health flag. Neither belongs in the hashing surface.
 * Mirrors the private helper in `submitOverallAnalysis.ts`.
 */
function stripVolatileTechnicalFields(
    technical: AnalysisResponse
): Omit<AnalysisResponse, 'analyzedAt'> {
    const {
        analyzedAt: _analyzedAt,
        skillsDegraded: _skillsDegraded,
        ...rest
    } = technical as AnalysisResponse & { skillsDegraded?: boolean };
    return rest;
}

/**
 * Strip the `analyzedAt` field from an options response so the overall hash
 * stays stable. `null` (graceful skip / crypto) passes through unchanged.
 * Mirrors the private helper in `submitOverallAnalysis.ts`.
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
 * This is the direct (non-queued) replacement for the `submitOverallAnalysis` +
 * `pollOverallAnalysis` pair. All four dependency axes are awaited server-side
 * via `Promise.all`, so the `pending_dependencies` state from the submit path
 * can never occur here.
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
 *
 * @see submitOverallAnalysis — the queued predecessor; still exported for the
 *   existing production path until siglens switches to runOverallAnalysis.
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
    if (
        requiresByokKey(tier, modelId, tierConfig) &&
        options.userApiKey === undefined
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
              ...options.fundamental,
              skipEnqueueIfMiss: topLevelSkipEnqueueIfMiss,
              force: effectiveAxisForce,
              signal,
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
                     * 여기만 최상위 값이 무조건 이긴다 — 바로 위 `reasoning`과
                     * 규칙이 다른 이유는 **technical 축 옵션 타입에 `locale`이
                     * 없기 때문**이다(`RunAnalysisOptions`의 부분집합). 양보할
                     * 축별 값이 존재하지 않으므로 `??`를 쓸 자리가 아니다.
                     * 축별 언어를 따로 주고 싶어지면 그 타입부터 넓혀야 한다.
                     */
                    locale: options.locale,
                    tierContext:
                        technicalRest.tierContext ??
                        (topLevelTier !== undefined
                            ? { userId: null, tier: topLevelTier }
                            : undefined),
                    skipEnqueueIfMiss: topLevelSkipEnqueueIfMiss,
                    signal,
                }
            ),
            fundamentalRun,
            runNewsAnalysis({
                symbol,
                companyName,
                modelId,
                news: resolvedNewsItems,
                upcomingCalendar,
                tier: topLevelTier ?? DEFAULT_TIER,
                userApiKey: topLevelUserApiKey,
                reasoning,
                locale: options.locale,
                ...(newsFieldIsArray
                    ? undefined
                    : (newsField as object | undefined)),
                skipEnqueueIfMiss: topLevelSkipEnqueueIfMiss,
                force: effectiveAxisForce,
                signal,
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
    if (newsResult.status === 'error' || newsResult.status === 'key_error') {
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

    // news is required for the overall prompt
    if (newsData === null) {
        return {
            status: 'error',
            axis: 'news',
            error: 'News analysis returned no result',
        };
    }

    // ── 7. Hash combined inputs and check overall cache ──
    const stableTechnical = stripVolatileTechnicalFields(technicalData);
    const stableOptions = stripVolatileOptionsFields(optionsData);
    const inputHash = hashAnalysisInput(
        JSON.stringify({
            t: stableTechnical,
            f: fundamentalData,
            n: newsData,
            o: stableOptions,
            fin: options.financialsScorecard,
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
    const cache = createCacheProvider();

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
    const fearGreed: FearGreedSnapshot | null = await fetchBarsWithIndicators(
        marketDataProvider,
        symbol,
        '1Day',
        fmpSymbol
    )
        .then(d => computeFearGreedIndex(d.bars, d.indicators.buySellVolume))
        .catch(error => {
            console.error(
                '[RunOverallAnalysis] FearGreed daily fetch/compute failed; proceeding without sentiment:',
                error
            );
            return null;
        });

    // ── 9. Build overall prompt ──
    const optionsOiStale = options.optionsOiStale ?? false;
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
        options.assetClass ?? 'equity'
    );
    // Design C: `stable` is always '' for the overall builder (no skills catalog),
    // so system stays the base persona unchanged.
    const locale = options.locale ?? DEFAULT_ANALYSIS_LOCALE;
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
    const raw = await dedupeInFlight(cacheKey, () =>
        callAnalysisAi({
            prompt,
            model: callModelId,
            tier,
            userApiKey: options.userApiKey,
            signal,
            system,
            responseSchema: OVERALL_RESPONSE_SCHEMA,
            seed: analysisSeed(`${system}\n\n${prompt}`),
            reasoning,
            correlationId: `${symbol}:overall`,
        })
    );

    // ── 11. Normalize and cache ──
    const result = normalizeOverallAnalysisResponse(
        JSON.parse(raw) as unknown,
        {
            optionsOiStale,
        }
    );

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
