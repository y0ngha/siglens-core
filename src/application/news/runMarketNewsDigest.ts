import {
    assertByokOnlyKeyPresent,
    resolveInFlightKey,
} from '@/application/byok/gate';
import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { dedupeGeneration } from '@/application/analysis/generationLock';
import { DEEPSEEK_V4_1_FLASH_MODEL } from '@/application/chat/constants';
import { resolveMarketNewsDigestCacheKey } from '@/application/news/marketNewsDigestCacheKey';
import type {
    RunMarketNewsDigestResult,
    SubmitMarketNewsDigestOptions,
} from '@/application/news/marketNewsDigestTypes';
import { normalizeNewsAnalysisResponse } from '@/domain/analysis/normalizeNews';
import { buildMarketNewsDigestPrompt } from '@/domain/analysis/marketNewsDigestPrompt';
import {
    DEFAULT_ANALYSIS_LOCALE,
    outputLanguageReminder,
} from '@/domain/analysis/outputLocale';
import { NEWS_RESPONSE_SCHEMA } from '@/domain/analysis/responseSchemas';
import { newsSystemPrompt } from '@/domain/analysis/systemPrompt';
import { MODEL_SPECS } from '@/domain/analysis/modelSpecs';
import { DEFAULT_TIER } from '@/domain/tier';
import type { ActiveModelId, NewsAnalysisResponse } from '@/domain/types';
import { NEWS_CACHE_TTL_SECONDS } from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { analysisSeed } from '@/infrastructure/hash/analysisInput';

const LOG_TAG = '[RunMarketNewsDigest]' as const;

/**
 * Run a market-news category digest end-to-end: empty-news guard → cache
 * lookup → LLM call → normalize → cache write → return.
 *
 * This is the direct (non-queued) replacement for `submitMarketNewsDigest` +
 * `pollMarketNewsDigest`. The caller awaits a single promise; no job IDs, no
 * Redis meta, no polling loop.
 *
 * Unlike per-symbol news analysis, this variant has no tier gate, usage
 * limit, or BYOK check — category digests are public data-pipeline calls.
 * Skills are accepted as an option (`options.skills`) rather than loaded
 * internally, matching the submit/poll pair's contract.
 *
 * Concurrent calls sharing the same in-flight key are deduplicated via
 * `dedupeGeneration` (in-process and cross-instance): only one LLM call fires; all waiting callers
 * with that key receive the same result.
 * "Same in-flight key" means the same `cacheKey` for `keyPolicy: 'tier'` (the
 * default), and the same `cacheKey` plus the same `userApiKey` (scoped by a hash,
 * never the raw key) for `'byok-only'` — callers on other keys or policies
 * neither join this run nor receive its result or failure.
 *
 * Pass `options.signal` so a dropped connection aborts the in-flight LLM call.
 *
 * @throws If the AI provider call fails (network, 5xx, abort).
 * @throws {UserApiKeyMissingError} When `options.keyPolicy` is `'byok-only'`
 *   (or any non-`'tier'` value) and `options.userApiKey` is missing or empty.
 *   Thrown after the cache read — a cached result is still returned keyless —
 *   and before any data fetch, Redis lock or provider call.
 *
 * @see submitMarketNewsDigest — the queued predecessor; still exported for
 *   the existing production path until siglens switches to runMarketNewsDigest.
 */
export async function runMarketNewsDigest(
    options: SubmitMarketNewsDigestOptions
): Promise<RunMarketNewsDigestResult> {
    const { category, categoryLabel, modelId, news } = options;
    const tier = options.tier ?? DEFAULT_TIER;

    // ── 1. Empty news guard ──
    if (news.length === 0) {
        return { status: 'no_news' };
    }

    // ── 2. Hash (news IDs + skills) → build cache key → check cache ──
    // 키 파생은 `resolveMarketNewsDigestCacheKey` 한 곳에만 있다 — peek 경로와
    // 바이트 단위로 같은 키를 읽고 쓰기 위한 유일한 출처.
    const { cacheKey, skills: sampledSkills } =
        resolveMarketNewsDigestCacheKey(options);
    const cache = createCacheProvider();

    if (!options.force && cache !== null) {
        try {
            const cached = await cache.get<NewsAnalysisResponse>(cacheKey);
            if (cached !== null) {
                const result = normalizeNewsAnalysisResponse(cached);
                return { status: 'cached', result };
            }
        } catch (error) {
            console.error(LOG_TAG, 'Cache lookup failed:', error);
        }
    }

    if (options.skipEnqueueIfMiss) {
        return { status: 'miss_no_trigger' };
    }

    // byok-only: a missing key fails here — after the cache read (a cached
    // result is still served keyless), before any data fetch or Redis lock.
    assertByokOnlyKeyPresent(options.keyPolicy, options.userApiKey);

    // ── 3. Build prompt ──
    const locale = options.locale ?? DEFAULT_ANALYSIS_LOCALE;
    const { stable, dynamic } = buildMarketNewsDigestPrompt(
        categoryLabel,
        news,
        sampledSkills,
        locale,
        new Date()
    );
    // Design C: fold the always-on skill digest (`stable`) into SYSTEM so
    // providers with a stable-system cache hit amortise the cost.
    const system = stable
        ? `${newsSystemPrompt(locale)}\n\n${stable}`
        : newsSystemPrompt(locale);
    // 출력 언어를 **마지막 지시**로 한 번 더 못 박는다 — 유저 프롬프트의 필드
    // 설명은 언어를 `Korean`으로 적어 둔 곳이 많아 그것만으로는 뒤집히지 않는다.
    // 기본 로케일(ko)에서는 빈 문자열이라 프롬프트 바이트가 예전과 같다.
    const prompt = `${dynamic}${outputLanguageReminder(locale)}`;

    // callModelId resolves the actual ActiveModelId for the AI call.
    // Deprecated model strings live in ModelId but not in MODEL_SPECS.
    const callModelId: ActiveModelId =
        (modelId as string) in MODEL_SPECS
            ? (modelId as ActiveModelId)
            : DEEPSEEK_V4_1_FLASH_MODEL;

    // ── 4. LLM call (with in-flight deduplication) ──
    const raw = await dedupeGeneration(
        cache,
        cacheKey,
        () =>
            callAnalysisAi({
                prompt,
                model: callModelId,
                tier,
                userApiKey: options.userApiKey,
                keyPolicy: options.keyPolicy,
                signal: options.signal,
                fallbackOnProviderFailure: options.providerFallback,
                system,
                responseSchema: NEWS_RESPONSE_SCHEMA,
                seed: analysisSeed(`${system}\n\n${prompt}`),
                // 호출자가 정하지 않으면 모델 스펙 기본값을 그대로 둔다
                // (`callAnalysisAi`는 `reasoning === undefined`를 "개입 안 함"으로
                // 취급). siglens는 `true`를 넘겨, 스펙상 non-thinking인
                // deepseek-v4.1-flash에서도 추론을 켠다 — 카테고리 피드 전체를 하나의
                // 서술로 합성하는 작업이라 추론 이득이 실제로 나오는 유일한 뉴스 경로다.
                reasoning: options.reasoning,
                correlationId: `${category}:market-news-digest`,
            }),
        {
            signal: options.signal,
            inFlightKey: resolveInFlightKey(
                cacheKey,
                options.keyPolicy,
                options.userApiKey
            ),
        }
    );

    // ── 5. Inline post-processing (formerly in pollMarketNewsDigest) ──
    // Do not skip empty/sparse digest results — callers rely on the cached
    // entry being present even when sparse (mirrors pollMarketNewsDigest).
    // raw를 미리 JSON.parse하지 않는다 — 이 normalize 함수는 parseLlmPayload로
    // 코드펜스 제거·파싱·garbage 방어를 스스로 수행한다. 앞에서 파싱하면 LLM이
    // 비-JSON을 뱉었을 때 예외가 호출자까지 올라가 그 방어가 무력해진다
    // (구 poll* 경로도 파싱하지 않고 그대로 넘겼다).
    const result = normalizeNewsAnalysisResponse(raw);

    if (result.currentDriverKo === '' && result.keyEventsKo.length === 0) {
        console.warn(LOG_TAG, 'Empty digest; raw payload likely malformed', {
            category,
        });
    }

    // Fire-and-forget: cache write must not delay the response.
    if (cache !== null) {
        cache
            .set(cacheKey, result, NEWS_CACHE_TTL_SECONDS)
            .catch(error =>
                console.error(LOG_TAG, 'Cache write failed:', error)
            );
    }

    return { status: 'done', result };
}
