import { fireAndForget } from '@/application/background';
import { dispatchWorkerJob } from '@/application/workerDispatch';
import {
    analysisSeed,
    hashAnalysisInput,
    normalizeSkillsForHash,
} from '@/infrastructure/hash/analysisInput';
import type {
    SubmitMarketNewsDigestOptions,
    SubmitMarketNewsDigestResult,
} from '@/application/news/marketNewsDigestTypes';
import { normalizeNewsAnalysisResponse } from '@/domain/analysis/normalizeNews';
import { buildMarketNewsDigestPrompt } from '@/domain/analysis/marketNewsDigestPrompt';
import { NEWS_RESPONSE_SCHEMA } from '@/domain/analysis/responseSchemas';
import { NEWS_SYSTEM_PROMPT } from '@/domain/analysis/systemPrompt';
import { DEFAULT_TIER } from '@/domain/tier';
import { MS_PER_SECOND } from '@/domain/constants/time';
import { buildMarketNewsDigestCacheKey } from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { readWorkerConfig } from '@/infrastructure/market/config';
import { createSkillSamplingPlan } from '@/infrastructure/skills/sampling';
import type { AnalysisType, NewsAnalysisResponse, Skill } from '@/domain/types';

const LOG_TAG = '[SubmitMarketNewsDigest]' as const;

/**
 * Maximum time to wait for the worker to accept the market-news digest job.
 * Fire-and-forget worker enqueue — 30s caps stuck requests; the worker has its own job-level timeout.
 */
const SUBMIT_MARKET_NEWS_DIGEST_TIMEOUT_MS = 30 * MS_PER_SECOND;

/**
 * Derive a deterministic input hash from the news article IDs, tier, and sampled skills.
 *
 * Mirrors the approach in {@link submitNewsAnalysis} but omits the earnings calendar
 * axis (no calendar for market-wide category digests). Skill fingerprint includes
 * each prompt-relevant skill field so that editing any injected skill busts the
 * cache rather than serving a stale digest for the full TTL.
 *
 * @param newsIds - Sorted news item IDs.
 * @param tier    - Resolved tier used to sample the prompt skills.
 * @param skills  - Sampled skills passed to the digest prompt.
 * @returns 16-character lowercase hex string.
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
 * Submit a market-news category digest job.
 *
 * The category digest is the market-wide analog of {@link submitNewsAnalysis}:
 * same output shape ({@link NewsAnalysisResponse}), same worker/cache machinery,
 * but keyed by `category` instead of a symbol, and without symbol, companyName,
 * earnings calendar, usage, or BYOK handling. It is a public analysis of the
 * news flow for a single {@link NewsFeedCategory} feed bucket, with optional
 * tier-aware skill sampling.
 *
 * Resolves to one of four outcomes:
 * - `cached`: a recent digest is reused (keyed by `category` + `modelId` +
 *   tier-aware input hash).
 * - `submitted`: the prompt was built, a `jobId` registered, and a fire-and-forget
 *   POST sent to the worker. Poll with {@link pollMarketNewsDigest}.
 * - `miss_no_trigger`: cache missed but `skipEnqueueIfMiss` is set; no worker call.
 * - `no_news`: `news` array was empty; analysis impossible.
 *
 * @param options - Category, model, news, and optional caching/timing config.
 * @returns The submission outcome.
 *
 * @see pollMarketNewsDigest
 *
 * @example
 * ```ts
 * const result = await submitMarketNewsDigest({
 *   category: 'crypto',
 *   categoryLabel: '미국 암호화폐',
 *   modelId: 'gemini-2.5-flash',
 *   news: enrichedItems,
 * });
 * if (result.status === 'cached') return result.result;
 * if (result.status === 'submitted') {
 *   const polled = await pollMarketNewsDigest(result.jobId);
 *   if (polled.status === 'done') return polled.result;
 * }
 * ```
 */
export async function submitMarketNewsDigest(
    options: SubmitMarketNewsDigestOptions
): Promise<SubmitMarketNewsDigestResult> {
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
            console.error(
                LOG_TAG,
                'Cache lookup or normalization failed:',
                error
            );
        }
    }

    if (options.skipEnqueueIfMiss) {
        return { status: 'miss_no_trigger' };
    }

    // ── 3. Build prompt, enqueue job, fire-and-forget worker POST ──
    const { workerUrl, workerSecret } = readWorkerConfig();
    const { stable, dynamic } = buildMarketNewsDigestPrompt(
        categoryLabel,
        news,
        skillSampling.skills
    );
    // Design C (A/B-gate validated): fold the always-on skill digest
    // (`stable`) into the SYSTEM prompt; send `dynamic` alone as the user
    // prompt.
    const system = stable
        ? `${NEWS_SYSTEM_PROMPT}\n\n${stable}`
        : NEWS_SYSTEM_PROMPT;
    const prompt = dynamic;
    const jobId = crypto.randomUUID();

    await setJobMeta(jobId, {
        category,
        modelId,
        cacheKey,
    });

    const dispatch = dispatchWorkerJob(
        `${workerUrl}/analyze`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Worker-Secret': workerSecret,
            },
            body: JSON.stringify({
                jobId,
                prompt,
                seed: analysisSeed(`${system}\n\n${prompt}`),
                model: modelId,
                tier,
                analysisType: 'news' satisfies AnalysisType,
                system,
                responseSchema: NEWS_RESPONSE_SCHEMA,
            }),
            signal: AbortSignal.timeout(SUBMIT_MARKET_NEWS_DIGEST_TIMEOUT_MS),
        },
        jobId,
        LOG_TAG
    );
    fireAndForget(dispatch, options);

    return { status: 'submitted', jobId };
}
