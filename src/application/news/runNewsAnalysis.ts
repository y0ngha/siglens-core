import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { dedupeInFlight } from '@/application/analysis/inFlight';
import { buildUserApiKeyRequiredError } from '@/application/byok/gate';
import type {
    RunNewsAnalysisResult,
    SubmitNewsAnalysisLimitError,
    SubmitNewsAnalysisNoNewsError,
    SubmitNewsAnalysisOptions,
} from '@/application/news/types';
import {
    buildUsageLimitError,
    checkAnalysisUsageAllowed,
    recordAnalysisUsageSafely,
} from '@/application/usage';
import { normalizeNewsAnalysisResponse } from '@/domain/analysis/normalizeNews';
import { buildNewsAnalysisPrompt } from '@/domain/analysis/newsPrompt';
import {
    DEFAULT_ANALYSIS_LOCALE,
    outputLanguageReminder,
} from '@/domain/analysis/outputLocale';
import { NEWS_RESPONSE_SCHEMA } from '@/domain/analysis/responseSchemas';
import { newsSystemPrompt } from '@/domain/analysis/systemPrompt';
import { DEFAULT_TIER, requiresByokKey, TIER_CONFIG } from '@/domain/tier';
import type {
    ActiveModelId,
    NewsAnalysisResponse,
    Skill,
} from '@/domain/types';
import {
    buildNewsCacheKey,
    NEWS_CACHE_TTL_SECONDS,
} from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import {
    analysisSeed,
    hashAnalysisInput,
    normalizeSkillsForHash,
} from '@/infrastructure/hash/analysisInput';
import { loadSkillsCached } from '@/infrastructure/skills/loader';
import {
    createSkillSamplingPlan,
    reasoningSeedPart,
} from '@/infrastructure/skills/sampling';

/**
 * Derive a deterministic hash of the news set, calendar, tier, and sampled skills.
 *
 * Mirrors `submitNewsAnalysis`'s `hashNewsInput` — kept local to avoid a
 * shared abstraction between the submit and run paths. Cache keys produced by
 * both paths are byte-identical for the same input so a cache entry written by
 * one path is readable by the other.
 */
function hashNewsInput(
    newsIds: readonly string[],
    earningsDates: readonly string[],
    tier: string,
    skills: readonly Skill[]
): string {
    const sortedIds = newsIds.toSorted().join(',');
    const sortedDates = earningsDates.toSorted().join(',');
    const skillFingerprint = JSON.stringify(normalizeSkillsForHash(skills));
    return hashAnalysisInput(
        `${tier}|${sortedIds}|${sortedDates}|${skillFingerprint}`
    );
}

/**
 * Run a news analysis end-to-end: gate checks → cache lookup → LLM call
 * → normalize → cache write → return.
 *
 * This is the direct (non-queued) replacement for the `submitNewsAnalysis` +
 * `pollNewsAnalysis` pair. The caller awaits a single promise; no job IDs, no
 * Redis meta, no polling loop.
 *
 * Skills are loaded once and serve both the sampling plan (cache key / prompt
 * assembly) and the result — a single `loadSkillsCached()` replaces the split
 * across submit and poll.
 *
 * Concurrent calls for the same `cacheKey` are deduplicated via
 * {@link dedupeInFlight}: only one LLM call fires; all waiting callers
 * receive the same result.
 *
 * Usage is recorded AFTER the LLM resolves, so an aborted or failed call
 * does not consume quota.
 *
 * Pass `options.signal` (e.g. `request.signal` from the SSE route handler)
 * so a dropped connection aborts the in-flight LLM call.
 *
 * @throws If the AI provider call fails (network, 5xx, abort). Gate denials
 *   are returned as `{status:'error'}` or `{status:'key_error'}`, not thrown.
 *
 * @see submitNewsAnalysis — the queued predecessor; still exported for the
 *   existing production path until siglens switches to runNewsAnalysis.
 */
export async function runNewsAnalysis(
    options: SubmitNewsAnalysisOptions
): Promise<RunNewsAnalysisResult> {
    const {
        symbol,
        companyName = symbol,
        modelId,
        news,
        upcomingCalendar,
    } = options;
    const usage = options.usage;
    const occurredAt = options.now ?? usage?.occurredAt ?? new Date();

    // ── 1. Empty news guard (before tier/cache/prompt) ──
    if (news.length === 0) {
        const noNewsError: SubmitNewsAnalysisNoNewsError = {
            status: 'error',
            code: 'no_news',
            error: 'No news to analyze',
        };
        return noNewsError;
    }

    // ── 2. BYOK gate (tier + premium model + no userApiKey) ──
    const tier = options.tier ?? DEFAULT_TIER;
    const tierConfig = options.tierConfig ?? TIER_CONFIG;

    if (
        requiresByokKey(tier, modelId, tierConfig) &&
        options.userApiKey === undefined
    ) {
        return buildUserApiKeyRequiredError(tier, modelId);
    }

    // ── 3. Usage limit check (only when both tier and usage are provided) ──
    if (options.tier !== undefined && usage !== undefined) {
        const allowed = await checkAnalysisUsageAllowed(
            usage,
            tier,
            occurredAt,
            tierConfig
        );
        if (!allowed) {
            const limitError: SubmitNewsAnalysisLimitError = {
                status: 'error',
                code: 'usage_limit_exceeded',
                error: buildUsageLimitError('analysisPerDay', tier),
            };
            return limitError;
        }
    }

    // ── 4. Load skills once ──
    // Skills are loaded BEFORE hashing so that a skill change (add/remove/edit
    // content) invalidates the cached analysis — otherwise the same news set
    // would keep returning the previous result for the full 24h TTL.
    const { skills } = await loadSkillsCached();
    const newsIds = news.map(n => n.id);
    const earningsDates = upcomingCalendar.map(c => c.earningsDate);
    const skillSampling = createSkillSamplingPlan(skills, tier, [
        'news',
        symbol,
        modelId,
        reasoningSeedPart(options.reasoning),
        tier,
        'news-ids',
        ...newsIds.toSorted(),
        'earnings-dates',
        ...earningsDates.toSorted(),
    ]);
    const inputHash = hashNewsInput(
        newsIds,
        earningsDates,
        tier,
        skillSampling.skills
    );
    const cacheKey = buildNewsCacheKey(
        symbol,
        modelId,
        inputHash,
        options.reasoning,
        options.locale
    );
    const cache = createCacheProvider();

    // ── 5. Cache check ──
    if (!options.force && cache !== null) {
        try {
            const cached = await cache.get<NewsAnalysisResponse>(cacheKey);
            if (cached !== null) {
                const result = normalizeNewsAnalysisResponse(cached);
                await recordAnalysisUsageSafely(usage, modelId, occurredAt);
                return { status: 'cached', result };
            }
        } catch (error) {
            console.error('[RunNewsAnalysis] Cache read failed:', error);
        }
    }

    if (options.skipEnqueueIfMiss) {
        return { status: 'miss_no_trigger' };
    }

    // ── 6. Build prompt ──
    const { stable, dynamic } = buildNewsAnalysisPrompt(
        symbol,
        companyName,
        news,
        upcomingCalendar,
        skillSampling.skills,
        options.assetClass ?? 'equity'
    );
    // Design C: fold the always-on skill digest (`stable`) into SYSTEM so
    // providers with a stable-system cache hit amortise the cost.
    const locale = options.locale ?? DEFAULT_ANALYSIS_LOCALE;
    const system = stable
        ? `${newsSystemPrompt(locale)}\n\n${stable}`
        : newsSystemPrompt(locale);
    // 출력 언어를 **마지막 지시**로 한 번 더 못 박는다 — 유저 프롬프트의 필드
    // 설명은 언어를 `Korean`으로 적어 둔 곳이 많아 그것만으로는 뒤집히지 않는다.
    // 기본 로케일(ko)에서는 빈 문자열이라 프롬프트 바이트가 예전과 같다.
    const prompt = `${dynamic}${outputLanguageReminder(locale)}`;

    // ── 7. LLM call (with in-flight deduplication) ──
    // modelId is caller-validated (BYOK gate passed a tierConfig check). Cast
    // to ActiveModelId: caller's responsibility, same contract as the worker had.
    const raw = await dedupeInFlight(cacheKey, () =>
        callAnalysisAi({
            prompt,
            model: modelId as ActiveModelId,
            tier,
            userApiKey: options.userApiKey,
            signal: options.signal,
            system,
            responseSchema: NEWS_RESPONSE_SCHEMA,
            seed: analysisSeed(`${system}\n\n${prompt}`),
            reasoning: options.reasoning,
            correlationId: `${symbol}:news`,
        })
    );

    // ── 8. Inline post-processing (formerly in pollNewsAnalysis) ──
    // callAnalysisAi returns normalized JSON; JSON.parse gives an object, so
    // normalizeNewsAnalysisResponse receives a non-string and skips re-parsing.
    // raw를 미리 JSON.parse하지 않는다 — 이 normalize 함수는 parseLlmPayload로
    // 코드펜스 제거·파싱·garbage 방어를 스스로 수행한다. 앞에서 파싱하면 LLM이
    // 비-JSON을 뱉었을 때 예외가 호출자까지 올라가 그 방어가 무력해진다
    // (구 poll* 경로도 파싱하지 않고 그대로 넘겼다).
    const result = normalizeNewsAnalysisResponse(raw);

    if (result.currentDriverKo === '' && result.keyEventsKo.length === 0) {
        console.warn(
            '[RunNewsAnalysis] Empty news analysis; raw payload likely malformed',
            { symbol }
        );
    }

    if (cache !== null) {
        // Fire-and-forget: cache write must not delay the response.
        cache
            .set(cacheKey, result, NEWS_CACHE_TTL_SECONDS)
            .catch(error =>
                console.error('[RunNewsAnalysis] Cache write failed:', error)
            );
    }

    // Record usage AFTER the LLM returns so an aborted or failed call does not
    // consume quota.
    await recordAnalysisUsageSafely(usage, modelId, occurredAt);

    return { status: 'done', result };
}
