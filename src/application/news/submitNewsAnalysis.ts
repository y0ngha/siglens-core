import { fireAndForget } from '@/application/background';
import { buildUserApiKeyRequiredError } from '@/application/byok/gate';
import { hashAnalysisInput } from '@/infrastructure/hash/analysisInput';
import {
    buildUsageLimitError,
    checkAnalysisUsageAllowed,
    recordAnalysisUsageSafely,
} from '@/application/usage';
import type {
    SubmitNewsAnalysisLimitError,
    SubmitNewsAnalysisNoNewsError,
    SubmitNewsAnalysisOptions,
    SubmitNewsAnalysisResult,
} from '@/application/news/types';
import { normalizeNewsAnalysisResponse } from '@/domain/analysis/normalizeNews';
import { buildNewsAnalysisPrompt } from '@/domain/analysis/newsPrompt';
import { DEFAULT_TIER, requiresByokKey, TIER_CONFIG } from '@/domain/tier';
import { MS_PER_MINUTE } from '@/domain/constants/time';
import { buildNewsCacheKey } from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { readWorkerConfig } from '@/infrastructure/market/config';
import { loadSkillsCached } from '@/infrastructure/skills/loader';
import type { NewsAnalysisResponse, Skill } from '@/domain/types';

/** Maximum time to wait for the worker to accept the news analysis job. */
const SUBMIT_NEWS_ANALYSIS_TIMEOUT_MS = 5 * MS_PER_MINUTE;

/**
 * Derive a short deterministic hash of the news set, calendar, and active skills.
 *
 * Sorted news IDs joined with sorted earnings dates and a sorted skill
 * fingerprint (`name + content`), delegated to {@link hashAnalysisInput}.
 * Deterministic across re-runs with the same input regardless of original
 * ordering.
 *
 * Skill fingerprint is included so that adding, removing, or editing a skill
 * busts the cache — otherwise the same news set would keep returning the
 * previous result for the full 24h TTL.
 *
 * @param newsIds       - Array of news item IDs.
 * @param earningsDates - Array of earnings calendar date strings.
 * @param skills        - Skills loaded for the prompt; only `name` + `content`
 *   are used for the hash.
 * @returns 16-character lowercase hex string.
 */
function hashNewsInput(
    newsIds: readonly string[],
    earningsDates: readonly string[],
    skills: readonly Skill[]
): string {
    const sortedIds = newsIds.toSorted().join(',');
    const sortedDates = earningsDates.toSorted().join(',');
    const skillFingerprint = JSON.stringify(
        skills
            .map(s => ({ name: s.name, content: s.content }))
            .toSorted((a, b) => a.name.localeCompare(b.name))
    );
    return hashAnalysisInput(`${sortedIds}|${sortedDates}|${skillFingerprint}`);
}

/**
 * Submit a news analysis job for the given symbol.
 *
 * Resolves to one of four outcomes:
 * - `cached`: a recent analysis is reused (keyed by `symbol` + `modelId` +
 *   an input hash of the sorted news IDs and earnings dates).
 * - `submitted`: the prompt was built, a `jobId` was registered, and a
 *   fire-and-forget HTTP POST was sent to the configured worker. Poll the
 *   result with {@link pollNewsAnalysis}.
 * - `miss_no_trigger`: the cache missed but no job was enqueued because
 *   `options.skipEnqueueIfMiss` was set; no worker request is made. The
 *   consumer should render a fallback (typically used for bot/crawler gating).
 * - `error`: either no news was provided (`no_news`), the daily analysis
 *   limit was exceeded (`usage_limit_exceeded`), or another gate blocked
 *   the submission.
 *
 * Tier and usage checks are skipped entirely when `options.usage` or
 * `options.tier` is not provided — this is the intended pre-Phase 4 behavior.
 *
 * @param options - Symbol, model, news, calendar, and optional tier/usage/timing config.
 * @returns The submission outcome.
 *
 * @example
 * ```ts
 * const res = await submitNewsAnalysis({ symbol: 'AAPL', modelId: 'gemini-2.5-flash', news, upcomingCalendar });
 * if (res.status === 'cached') return res.result;
 * if (res.status === 'miss_no_trigger') return null; // bot/crawler fallback
 * if (res.status === 'error')  return res.error;
 * const polled = await pollNewsAnalysis(res.jobId);
 * ```
 *
 * @see pollNewsAnalysis
 * @see cancelNewsAnalysisJob
 */
export async function submitNewsAnalysis(
    options: SubmitNewsAnalysisOptions
): Promise<SubmitNewsAnalysisResult> {
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

    // ── 0a. BYOK gate (tier + premium model + no userApiKey) ──
    const tier = options.tier ?? DEFAULT_TIER;
    const tierConfig = options.tierConfig ?? TIER_CONFIG;

    if (
        requiresByokKey(tier, modelId, tierConfig) &&
        options.userApiKey === undefined
    ) {
        return buildUserApiKeyRequiredError(tier, modelId);
    }

    // ── 2. Usage limit check (only when both tier and usage are provided) ──
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

    // ── 3. Load skills, hash (news + skills) → build cache key → check cache ──
    // Skills are loaded BEFORE hashing so that a skill change (add/remove/edit
    // content) invalidates the cached analysis — otherwise the same news set
    // would keep returning the previous result for the full 24h TTL.
    const { skills, skillsDegraded } = await loadSkillsCached();
    const newsIds = news.map(n => n.id);
    const earningsDates = upcomingCalendar.map(c => c.earningsDate);
    const inputHash = hashNewsInput(newsIds, earningsDates, skills);
    const cacheKey = buildNewsCacheKey(symbol, modelId, inputHash);
    const cache = createCacheProvider();

    if (cache !== null) {
        try {
            const cached = await cache.get<NewsAnalysisResponse>(cacheKey);
            // Lightweight structural validation — schema drift from a prior
            // release should fall through as a cache miss rather than poison
            // the response. The schema-version prefix on the cache key is the
            // primary invalidation lever (see CACHE_KEY_SCHEMA_VERSION); this
            // check is a belt-and-braces fallback.
            if (cached !== null) {
                const result = normalizeNewsAnalysisResponse(cached);
                await recordAnalysisUsageSafely(usage, modelId, occurredAt);
                return { status: 'cached', result };
            }
        } catch (error) {
            console.error('[submitNewsAnalysis] Cache read failed:', error);
        }
    }

    if (options.skipEnqueueIfMiss) {
        return { status: 'miss_no_trigger' };
    }

    // ── 4. Build prompt, enqueue job, fire-and-forget worker POST ──
    const { workerUrl, workerSecret } = readWorkerConfig();
    const prompt = buildNewsAnalysisPrompt(
        symbol,
        companyName,
        news,
        upcomingCalendar,
        skills
    );
    const jobId = crypto.randomUUID();

    await setJobMeta(jobId, {
        symbol,
        modelId,
        cacheKey,
        ...(skillsDegraded && { skillsDegraded }),
    });

    const userApiKeyHeader: Record<string, string> =
        options.userApiKey !== undefined
            ? { 'X-AI-API-KEY': options.userApiKey }
            : {};

    const dispatch = fetch(`${workerUrl}/analyze`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Worker-Secret': workerSecret,
            ...userApiKeyHeader,
        },
        body: JSON.stringify({ jobId, prompt, model: modelId, tier }),
        signal: AbortSignal.timeout(SUBMIT_NEWS_ANALYSIS_TIMEOUT_MS),
    }).catch(error => {
        console.error('[submitNewsAnalysis] Worker request failed:', error);
    });
    fireAndForget(dispatch, options);

    await recordAnalysisUsageSafely(usage, modelId, occurredAt);

    return { status: 'submitted', jobId };
}
