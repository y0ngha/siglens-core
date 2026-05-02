import { createHash } from 'node:crypto';
import { fireAndForget } from '@/application/background';
import { checkAnalysisLimit, buildUsageLimitError } from '@/application/usage';
import type {
    SubmitNewsAnalysisOptions,
    SubmitNewsAnalysisResult,
} from '@/application/news/types';
import { buildNewsAnalysisPrompt } from '@/domain/analysis/newsPrompt';
import { TIER_CONFIG } from '@/domain/tier';
import { MS_PER_MINUTE } from '@/domain/constants/time';
import { buildNewsCacheKey, NEWS_CACHE_TTL_SECONDS } from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { hashUsageIp } from '@/infrastructure/usage/hash';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { readWorkerConfig } from '@/infrastructure/market/config';
import { FileSkillsLoader } from '@/infrastructure/skills/loader';
import type { NewsAnalysisResponse, Skill } from '@/domain/types';

/** Length of the hex input hash prefix used in the news cache key. */
const INPUT_HASH_LENGTH = 16;

/** Maximum time to wait for the worker to accept the news analysis job. */
const SUBMIT_NEWS_ANALYSIS_TIMEOUT_MS = 5 * MS_PER_MINUTE;

/**
 * Derive a short deterministic hash of the news set and upcoming calendar.
 *
 * SHA-256 of sorted news IDs joined with sorted earnings dates, truncated
 * to the first 16 hex characters. Deterministic across re-runs with the
 * same news set regardless of original ordering.
 *
 * @param newsIds - Array of news item IDs.
 * @param earningsDates - Array of earnings calendar date strings.
 * @returns 16-character lowercase hex string.
 */
function hashNewsInput(
    newsIds: readonly string[],
    earningsDates: readonly string[]
): string {
    const sortedIds = [...newsIds].sort().join(',');
    const sortedDates = [...earningsDates].sort().join(',');
    return createHash('sha256')
        .update(`${sortedIds}|${sortedDates}`)
        .digest('hex')
        .slice(0, INPUT_HASH_LENGTH);
}

/**
 * Submit a news analysis job for the given symbol.
 *
 * Resolves to one of three outcomes:
 * - `cached`: a recent analysis is reused (keyed by `symbol` + `modelId` +
 *   an input hash of the sorted news IDs and earnings dates).
 * - `submitted`: the prompt was built, a `jobId` was registered, and a
 *   fire-and-forget HTTP POST was sent to the configured worker. Poll the
 *   result with {@link pollNewsAnalysis}.
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
 * if (res.status === 'error')  return res.error;
 * const polled = await pollNewsAnalysis(res.jobId);
 * ```
 *
 * @see pollNewsAnalysis
 * @see cancelFundamentalAnalysisJob
 */
export async function submitNewsAnalysis(
    options: SubmitNewsAnalysisOptions
): Promise<SubmitNewsAnalysisResult> {
    const { symbol, modelId, news, upcomingCalendar } = options;
    const occurredAt = options.now ?? new Date();

    // ── 1. Empty news guard (before tier/cache/prompt) ──
    if (news.length === 0) {
        return {
            status: 'error',
            code: 'no_news',
            error: 'No news to analyze',
        };
    }

    // ── 2. Usage limit check (only when both tier and usage are provided) ──
    if (options.tier !== undefined && options.usage !== undefined) {
        const tier = options.tier;
        const tierConfig = options.tierConfig ?? TIER_CONFIG;
        const ipHash = hashUsageIp(options.usage.clientIp, occurredAt);
        const allowed = await checkAnalysisLimit(
            { ipHash, tier, now: occurredAt, config: tierConfig },
            { usage: options.usage.usageRepository }
        );
        if (!allowed) {
            return {
                status: 'error',
                code: 'usage_limit_exceeded',
                error: buildUsageLimitError('analysisPerDay', tier),
            };
        }
    }

    // ── 3. Hash input → build cache key → check cache ──
    const newsIds = news.map(n => n.id);
    const earningsDates = upcomingCalendar.map(c => c.earningsDate);
    const inputHash = hashNewsInput(newsIds, earningsDates);
    const cacheKey = buildNewsCacheKey(symbol, modelId, inputHash);
    const cache = createCacheProvider();

    if (cache !== null) {
        try {
            const cached = await cache.get<NewsAnalysisResponse>(cacheKey);
            if (cached !== null) {
                return { status: 'cached', result: cached };
            }
        } catch (error) {
            console.error('[submitNewsAnalysis] Cache read failed:', error);
        }
    }

    // ── 4. Load skills (best-effort), build prompt, enqueue job, fire-and-forget ──
    let skills: Skill[];
    try {
        skills = await new FileSkillsLoader().loadSkills();
    } catch {
        skills = [];
    }

    const { workerUrl, workerSecret } = readWorkerConfig();
    const prompt = buildNewsAnalysisPrompt(symbol, news, upcomingCalendar, skills);
    const jobId = crypto.randomUUID();

    await setJobMeta(jobId, {
        symbol,
        modelId,
        cacheKey,
    });

    const dispatch = fetch(`${workerUrl}/analyze`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Worker-Secret': workerSecret,
        },
        body: JSON.stringify({ jobId, prompt, model: modelId }),
        signal: AbortSignal.timeout(SUBMIT_NEWS_ANALYSIS_TIMEOUT_MS),
    }).catch(error => {
        console.error('[submitNewsAnalysis] Worker request failed:', error);
    });
    fireAndForget(dispatch, options);

    return { status: 'submitted', jobId };
}
