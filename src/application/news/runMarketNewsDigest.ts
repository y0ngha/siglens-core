import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { dedupeInFlight } from '@/application/analysis/inFlight';
import { DEEPSEEK_V4_FLASH_MODEL } from '@/application/chat/constants';
import type {
    RunMarketNewsDigestResult,
    SubmitMarketNewsDigestOptions,
} from '@/application/news/marketNewsDigestTypes';
import { normalizeNewsAnalysisResponse } from '@/domain/analysis/normalizeNews';
import { buildMarketNewsDigestPrompt } from '@/domain/analysis/marketNewsDigestPrompt';
import { NEWS_RESPONSE_SCHEMA } from '@/domain/analysis/responseSchemas';
import { NEWS_SYSTEM_PROMPT } from '@/domain/analysis/systemPrompt';
import { MODEL_SPECS } from '@/domain/analysis/modelSpecs';
import { DEFAULT_TIER } from '@/domain/tier';
import type {
    ActiveModelId,
    NewsAnalysisResponse,
    Skill,
} from '@/domain/types';
import {
    buildMarketNewsDigestCacheKey,
    NEWS_CACHE_TTL_SECONDS,
} from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import {
    analysisSeed,
    hashAnalysisInput,
    normalizeSkillsForHash,
} from '@/infrastructure/hash/analysisInput';
import { createSkillSamplingPlan } from '@/infrastructure/skills/sampling';

const LOG_TAG = '[RunMarketNewsDigest]' as const;

/**
 * Derive a deterministic input hash from the news article IDs, tier, and sampled skills.
 *
 * Mirrors `submitMarketNewsDigest`'s private helper — cache keys produced by
 * both paths are byte-identical for the same input so a cache entry written by
 * one path is readable by the other.
 */
function hashMarketNewsDigestInput(
    newsIds: readonly string[],
    tier: string,
    skills: readonly Skill[]
): string {
    const sortedIds = newsIds.toSorted().join(',');
    const skillFingerprint = JSON.stringify(normalizeSkillsForHash(skills));
    return hashAnalysisInput(`${tier}|${sortedIds}|${skillFingerprint}`);
}

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
 * Concurrent calls for the same `cacheKey` are deduplicated via
 * {@link dedupeInFlight}: only one LLM call fires; all waiting callers
 * receive the same result.
 *
 * Pass `options.signal` so a dropped connection aborts the in-flight LLM call.
 *
 * @throws If the AI provider call fails (network, 5xx, abort). Gate denials
 *   are returned as discriminated-union variants, not thrown.
 *
 * @see submitMarketNewsDigest — the queued predecessor; still exported for
 *   the existing production path until siglens switches to runMarketNewsDigest.
 */
export async function runMarketNewsDigest(
    options: SubmitMarketNewsDigestOptions
): Promise<RunMarketNewsDigestResult> {
    const { category, categoryLabel, modelId, news } = options;
    const skills = options.skills ?? [];
    const tier = options.tier ?? DEFAULT_TIER;

    // ── 1. Empty news guard ──
    if (news.length === 0) {
        return { status: 'no_news' };
    }

    // ── 2. Hash (news IDs + skills) → build cache key → check cache ──
    const newsIds = news.map(n => n.id);
    const skillSampling = createSkillSamplingPlan(skills, tier, [
        'market-news-digest',
        category,
        modelId,
        tier,
        'news-ids',
        ...newsIds.toSorted(),
    ]);
    const inputHash = hashMarketNewsDigestInput(
        newsIds,
        tier,
        skillSampling.skills
    );
    const cacheKey = buildMarketNewsDigestCacheKey(
        category,
        modelId,
        inputHash
    );
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

    // ── 3. Build prompt ──
    const { stable, dynamic } = buildMarketNewsDigestPrompt(
        categoryLabel,
        news,
        skillSampling.skills
    );
    // Design C: fold the always-on skill digest (`stable`) into SYSTEM so
    // providers with a stable-system cache hit amortise the cost.
    const system = stable
        ? `${NEWS_SYSTEM_PROMPT}\n\n${stable}`
        : NEWS_SYSTEM_PROMPT;
    const prompt = dynamic;

    // callModelId resolves the actual ActiveModelId for the AI call.
    // Deprecated model strings live in ModelId but not in MODEL_SPECS.
    const callModelId: ActiveModelId =
        (modelId as string) in MODEL_SPECS
            ? (modelId as ActiveModelId)
            : DEEPSEEK_V4_FLASH_MODEL;

    // ── 4. LLM call (with in-flight deduplication) ──
    const raw = await dedupeInFlight(cacheKey, () =>
        callAnalysisAi({
            prompt,
            model: callModelId,
            tier,
            signal: options.signal,
            system,
            responseSchema: NEWS_RESPONSE_SCHEMA,
            seed: analysisSeed(`${system}\n\n${prompt}`),
            correlationId: `${category}:market-news-digest`,
        })
    );

    // ── 5. Inline post-processing (formerly in pollMarketNewsDigest) ──
    // Do not skip empty/sparse digest results — callers rely on the cached
    // entry being present even when sparse (mirrors pollMarketNewsDigest).
    const result = normalizeNewsAnalysisResponse(JSON.parse(raw));

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
