import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { dedupeGeneration } from '@/application/analysis/generationLock';
import {
    buildUserApiKeyRequiredError,
    isUserApiKeyGateDeniedAt,
    resolveInFlightKey,
} from '@/application/byok/gate';
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
import {
    applyNewsCitations,
    type CitationContext,
} from '@/domain/analysis/newsCitations';
import { buildNewsAnalysisPrompt } from '@/domain/analysis/newsPrompt';
import {
    DEFAULT_ANALYSIS_LOCALE,
    outputLanguageReminder,
} from '@/domain/analysis/outputLocale';
import { NEWS_RESPONSE_SCHEMA } from '@/domain/analysis/responseSchemas';
import { newsSystemPrompt } from '@/domain/analysis/systemPrompt';
import { DEFAULT_TIER, TIER_CONFIG } from '@/domain/tier';
import type {
    ActiveModelId,
    NewsAnalysisResponse,
    NewsInstrumentKind,
    Skill,
} from '@/domain/types';
import {
    buildNewsCacheKey,
    NEWS_CACHE_TTL_SECONDS,
} from '@/infrastructure/cache/config';
import { resolveCacheProvider } from '@/application/shared/resolveCacheProvider';
import {
    analysisSeed,
    hashAnalysisInput,
    macroCalendarFingerprintParts,
    normalizeSkillsForHash,
} from '@/infrastructure/hash/analysisInput';
import { loadSkillsCached } from '@/infrastructure/skills/loader';
import {
    createSkillSamplingPlan,
    reasoningSeedPart,
} from '@/infrastructure/skills/sampling';

/**
 * Derive a deterministic hash of the news set, calendar, tier, sampled
 * skills, and (when present) the macro calendar.
 *
 * `macroFingerprintParts` is appended only when non-empty — an empty macro calendar (every call site before that option existed)
 * hashes the exact same string as before, so pre-existing cache entries stay
 * valid.
 */
function hashNewsInput(
    newsIds: readonly string[],
    earningsDates: readonly string[],
    tier: string,
    skills: readonly Skill[],
    macroFingerprintParts: readonly string[],
    instrumentKind: NewsInstrumentKind
): string {
    const sortedIds = newsIds.toSorted().join(',');
    const sortedDates = earningsDates.toSorted().join(',');
    const skillFingerprint = JSON.stringify(normalizeSkillsForHash(skills));
    const base = `${tier}|${sortedIds}|${sortedDates}|${skillFingerprint}`;
    const withMacro =
        macroFingerprintParts.length > 0
            ? `${base}|${macroFingerprintParts.join(',')}`
            : base;
    // Fund framing changes the prompt, so it gets its own entry; company (the
    // default) adds nothing and keeps every existing key.
    return hashAnalysisInput(
        instrumentKind === 'fund' ? `${withMacro}|fund` : withMacro
    );
}

/**
 * Run a news analysis end-to-end: gate checks → cache lookup → LLM call
 * → normalize → cache write → return.
 *
 * The caller awaits a single promise; no job IDs, no
 * Redis meta, no polling loop.
 *
 * Skills are loaded once and serve both the sampling plan (cache key / prompt
 * assembly) and the result — a single `loadSkillsCached()` replaces the split
 * across submit and poll.
 *
 * Concurrent calls sharing the same in-flight key are deduplicated via
 * `dedupeGeneration` (in-process and cross-instance): only one LLM call fires; all waiting callers
 * with that key receive the same result.
 * "Same in-flight key" means the same `cacheKey` for `keyPolicy: 'tier'` (the
 * default), and the same `cacheKey` plus the same `userApiKey` (scoped by a hash,
 * never the raw key) for `'byok-only'` — callers on other keys or policies
 * neither join this run nor receive its result or failure.
 *
 * Usage is recorded AFTER the LLM resolves, so an aborted or failed call
 * does not consume quota.
 *
 * Pass `options.signal` (e.g. `request.signal` from the SSE route handler)
 * so a dropped connection aborts the in-flight LLM call.
 *
 * @throws If the AI provider call fails (network, 5xx, abort). Gate denials
 *   are returned as `{status:'error'}` or `{status:'key_error'}`, not thrown.
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
        macroCalendar = [],
    } = options;
    const usage = options.usage;
    const occurredAt = options.now ?? usage?.occurredAt ?? new Date();
    // The prompt numbers `news` in this order, so `[#n]` resolves to news[n-1].
    const citations: CitationContext = {
        articles: news,
        locale: options.locale ?? DEFAULT_ANALYSIS_LOCALE,
        currency: options.currency ?? 'USD',
    };

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
        isUserApiKeyGateDeniedAt(
            'before-cache',
            tier,
            modelId,
            tierConfig,
            options.userApiKey,
            options.keyPolicy
        )
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
    // An estimated date carries a `~` so the cached result turns over when the
    // company confirms it (the prompt labels the two differently). Confirmed
    // and unknown rows keep the bare date, so their keys are unchanged.
    const earningsDates = upcomingCalendar.map(c =>
        c.dateConfirmed === false ? `${c.earningsDate}~` : c.earningsDate
    );
    // Empty when `macroCalendar` is omitted/[] — spreading zero extra parts
    // keeps the seed identical to every call site before this option existed.
    const macroFingerprintParts = macroCalendarFingerprintParts(macroCalendar);
    // Crypto ignores the framing, so it never splits crypto keys.
    const instrumentKind: NewsInstrumentKind =
        options.assetClass === 'crypto'
            ? 'company'
            : (options.instrumentKind ?? 'company');
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
        ...(macroFingerprintParts.length > 0
            ? ['macro-calendar', ...macroFingerprintParts]
            : []),
        ...(instrumentKind === 'fund' ? ['fund'] : []),
    ]);
    const inputHash = hashNewsInput(
        newsIds,
        earningsDates,
        tier,
        skillSampling.skills,
        macroFingerprintParts,
        instrumentKind
    );
    const cacheKey = buildNewsCacheKey(
        symbol,
        modelId,
        inputHash,
        options.reasoning,
        options.locale
    );
    const cache = resolveCacheProvider(options.cache);

    // ── 5. Cache check ──
    if (!options.force && cache !== null) {
        try {
            const cached = await cache.get<NewsAnalysisResponse>(cacheKey);
            if (cached !== null) {
                // Stored results are already resolved (see the generate step).
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

    // byok-only key gate: after the cache read (a cached result is served
    // keyless), before any provider fetch or Redis lock. Under the default
    // policy the gate stays at the top, unchanged.
    if (
        isUserApiKeyGateDeniedAt(
            'after-cache',
            tier,
            modelId,
            tierConfig,
            options.userApiKey,
            options.keyPolicy
        )
    ) {
        return buildUserApiKeyRequiredError(tier, modelId);
    }

    // ── 6. Build prompt ──
    const locale = citations.locale;
    const { stable, dynamic } = buildNewsAnalysisPrompt(
        symbol,
        companyName,
        news,
        upcomingCalendar,
        skillSampling.skills,
        options.assetClass ?? 'equity',
        locale,
        options.currency,
        occurredAt,
        macroCalendar,
        instrumentKind
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

    // ── 7. LLM call (with in-flight deduplication) ──
    // modelId is caller-validated (BYOK gate passed a tierConfig check). Cast
    // to ActiveModelId: caller's responsibility, same contract as the worker had.
    const raw = await dedupeGeneration(
        cache,
        cacheKey,
        async () => {
            const generated = await callAnalysisAi({
                prompt,
                model: modelId as ActiveModelId,
                tier,
                userApiKey: options.userApiKey,
                keyPolicy: options.keyPolicy,
                signal: options.signal,
                fallbackOnProviderFailure: options.providerFallback,
                system,
                responseSchema: NEWS_RESPONSE_SCHEMA,
                seed: analysisSeed(`${system}\n\n${prompt}`),
                reasoning: options.reasoning,
                correlationId: `${symbol}:news`,
            });
            // Resolve `[#n]` markers HERE, against the article order this
            // caller's prompt used. dedupeGeneration hands this return value
            // to in-process and cross-instance joiners of the same cache key,
            // whose own `news` may be ordered differently (the key hashes
            // sorted IDs), so they must receive resolved text, not markers.
            return JSON.stringify(
                applyNewsCitations(
                    normalizeNewsAnalysisResponse(generated),
                    citations
                )
            );
        },
        {
            signal: options.signal,
            inFlightKey: resolveInFlightKey(
                cacheKey,
                options.keyPolicy,
                options.userApiKey
            ),
        }
    );

    // ── 8. Inline post-processing ──
    // `raw` is the generate step's normalized, citation-resolved JSON (this
    // caller's or the winning peer's); normalizing it again is idempotent.
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
