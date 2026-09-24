import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { dedupeInFlight } from '@/application/analysis/inFlight';
import { DEEPSEEK_V4_1_FLASH_MODEL } from '@/application/chat/constants';
import type {
    RunCongressTrendResult,
    SubmitCongressTrendFetchError,
    SubmitCongressTrendOptions,
} from '@/application/congress/types';
import { normalizeCongressTrendResponse } from '@/domain/analysis/normalizeCongressTrend';
import { normalizeCongressTrades } from '@/domain/analysis/normalizeCongressTrades';
import {
    DEFAULT_ANALYSIS_LOCALE,
    outputLanguageReminder,
} from '@/domain/analysis/outputLocale';
import { summarizeCongressTrades } from '@/domain/analysis/summarizeCongressTrades';
import { buildCongressTrendPrompt } from '@/domain/analysis/congressTrendPrompt';
import { CONGRESS_RESPONSE_SCHEMA } from '@/domain/analysis/responseSchemas';
import { congressSystemPrompt } from '@/domain/analysis/systemPrompt';
import { MODEL_SPECS } from '@/domain/analysis/modelSpecs';
import { DEFAULT_TIER } from '@/domain/tier';
import type {
    ActiveModelId,
    CongressTrade,
    CongressTrendResponse,
} from '@/domain/types';
import type { CongressTradesProvider } from '@/domain/ports/congressTradesProvider';
import {
    buildCongressTrendCacheKey,
    CONGRESS_CACHE_TTL_SECONDS,
} from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { analysisSeed } from '@/infrastructure/hash/analysisInput';
import { loadSkillsCached } from '@/infrastructure/skills/loader';
import {
    createSkillSamplingPlan,
    reasoningSeedPart,
} from '@/infrastructure/skills/sampling';

/** Default number of trade records fetched per chamber when `limit` is omitted. */
const DEFAULT_LIMIT = 50;

type ProviderFetchResult =
    { status: 'ok'; trades: CongressTrade[] } | SubmitCongressTrendFetchError;

/**
 * Fetch senate + house trades in parallel and merge them.
 *
 * An empty `trades` array is NOT an error (0건 = 정상); the caller's
 * `no_trades` guard handles that case. The skill catalog is loaded once
 * by the caller and passed in to avoid a redundant fetch.
 */
async function fetchProviderData(
    dataProvider: CongressTradesProvider,
    symbol: string,
    limit: number
): Promise<ProviderFetchResult> {
    try {
        const [senate, house] = await Promise.all([
            dataProvider.getTrades(symbol, 'senate', limit),
            dataProvider.getTrades(symbol, 'house', limit),
        ]);
        return { status: 'ok', trades: normalizeCongressTrades(senate, house) };
    } catch (error) {
        console.error('[RunCongressTrend] Provider fetch failed:', error);
        return { status: 'error', code: 'fetch_failed', error: String(error) };
    }
}

/**
 * Run a congressional-trade trend analysis end-to-end: tier-neutral gate →
 * cache lookup → provider fetch → prompt build → LLM call → normalize →
 * cache write → return.
 *
 * This is the direct (non-queued) replacement for `submitCongressTrend` +
 * `pollCongressTrend`. The caller awaits a single promise; no job IDs, no
 * Redis meta, no polling loop.
 *
 * Congress data is fully public, so **there is no usage-limit gate** and
 * **no BYOK-required check** — tier gating for `modelId` is the caller's
 * (siglens) responsibility, consistent with the submit/poll contract. The
 * optional `options.userApiKey` is forwarded to `callAnalysisAi` unchanged.
 *
 * Skills are loaded once via {@link loadSkillsCached} and used for both the
 * sampling plan (cache-key fingerprint + prompt assembly) — a single load
 * replaces the split across submit and poll.
 *
 * Concurrent calls for the same `cacheKey` are deduplicated via
 * {@link dedupeInFlight}: only one LLM call fires; all waiting callers
 * receive the same result.
 *
 * Pass `options.signal` so a dropped connection aborts the in-flight LLM call.
 *
 * @throws If the AI provider call fails (network, 5xx, abort). All other
 *   outcomes are returned as discriminated-union variants.
 *
 * @see submitCongressTrend — the queued predecessor; still exported for
 *   the existing production path until siglens switches to runCongressTrend.
 */
export async function runCongressTrend(
    options: SubmitCongressTrendOptions
): Promise<RunCongressTrendResult> {
    const { symbol, modelId, dataProvider } = options;
    const tier = options.tier ?? DEFAULT_TIER;
    const limit = options.limit ?? DEFAULT_LIMIT;

    // Skills are loaded once; the same load serves both the sampling plan
    // (cache-key fingerprint + prompt assembly) — replaces the split across
    // submit (which loaded skills) and poll (which did not).
    const skillsResult = await loadSkillsCached();
    const skillSampling = createSkillSamplingPlan(skillsResult.skills, tier, [
        'congress',
        symbol,
        modelId,
        reasoningSeedPart(options.reasoning),
        tier,
    ]);
    const cacheKey = buildCongressTrendCacheKey(
        symbol,
        modelId,
        `${tier}:${skillSampling.fingerprint}`,
        options.reasoning,
        options.locale
    );
    const cache = createCacheProvider();

    if (!options.force && cache !== null) {
        try {
            const cached = await cache.get<CongressTrendResponse>(cacheKey);
            if (cached !== null) {
                const result = normalizeCongressTrendResponse(cached);
                // Treat an empty summary as a cache miss — a blank result is
                // worse than re-running the analysis.
                if (result.summaryKo) {
                    return { status: 'cached', result };
                }
            }
        } catch (error) {
            console.error('[RunCongressTrend] Cache read failed:', error);
        }
    }

    if (options.skipEnqueueIfMiss) {
        return { status: 'miss_no_trigger' };
    }

    const providerData = await fetchProviderData(dataProvider, symbol, limit);
    if (providerData.status === 'error') return providerData;
    const { trades } = providerData;

    // Cost guard: a symbol with zero disclosures is normal, not an error. Skip
    // the LLM entirely so we never pay to "analyze nothing".
    if (trades.length === 0) {
        return { status: 'no_trades' };
    }

    const stats = summarizeCongressTrades(trades);
    const locale = options.locale ?? DEFAULT_ANALYSIS_LOCALE;
    const { stable, dynamic } = buildCongressTrendPrompt(
        symbol,
        trades,
        stats,
        skillSampling.skills,
        locale
    );
    // Design C: fold the always-on skill digest (`stable`) into SYSTEM so
    // providers with a stable-system cache hit amortise the cost.
    const system = stable
        ? `${congressSystemPrompt(locale)}\n\n${stable}`
        : congressSystemPrompt(locale);
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

    const raw = await dedupeInFlight(cacheKey, () =>
        callAnalysisAi({
            prompt,
            model: callModelId,
            tier,
            userApiKey: options.userApiKey,
            signal: options.signal,
            fallbackOnProviderFailure: options.providerFallback,
            system,
            responseSchema: CONGRESS_RESPONSE_SCHEMA,
            seed: analysisSeed(`${system}\n\n${prompt}`),
            reasoning: options.reasoning,
            correlationId: `${symbol}:congress`,
        })
    );

    // Inline post-processing (formerly in pollCongressTrend). No job queue involved.
    // raw를 미리 JSON.parse하지 않는다 — 이 normalize 함수는 parseLlmPayload로
    // 코드펜스 제거·파싱·garbage 방어를 스스로 수행한다. 앞에서 파싱하면 LLM이
    // 비-JSON을 뱉었을 때 예외가 호출자까지 올라가 그 방어가 무력해진다
    // (구 poll* 경로도 파싱하지 않고 그대로 넘겼다).
    const result = normalizeCongressTrendResponse(raw);

    if (result.summaryKo === '' && result.notableMembersKo.length === 0) {
        console.warn('[RunCongressTrend] Empty congress trend analysis', {
            symbol,
        });
    }

    // Cache the normalized result. Mirrors pollCongressTrend: write even when
    // the result is content-empty. Fire-and-forget so the cache write does not
    // delay the response.
    if (cache !== null) {
        cache
            .set(cacheKey, result, CONGRESS_CACHE_TTL_SECONDS)
            .catch(error =>
                console.error('[RunCongressTrend] Cache write failed:', error)
            );
    }

    return { status: 'done', result };
}
