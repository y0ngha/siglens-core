import { fireAndForget } from '@/application/background';
import type {
    SubmitCongressTrendOptions,
    SubmitCongressTrendResult,
    SubmitCongressTrendFetchError,
} from '@/application/congress/types';
import { normalizeCongressTrendResponse } from '@/domain/analysis/normalizeCongressTrend';
import { normalizeCongressTrades } from '@/domain/analysis/normalizeCongressTrades';
import { summarizeCongressTrades } from '@/domain/analysis/summarizeCongressTrades';
import { buildCongressTrendPrompt } from '@/domain/analysis/congressTrendPrompt';
import { CONGRESS_RESPONSE_SCHEMA } from '@/domain/analysis/responseSchemas';
import { CONGRESS_SYSTEM_PROMPT } from '@/domain/analysis/systemPrompt';
import { DEFAULT_TIER } from '@/domain/tier';
import { MS_PER_MINUTE } from '@/domain/constants/time';
import { buildCongressTrendCacheKey } from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { analysisSeed } from '@/infrastructure/hash/analysisInput';
import type { CongressTradesProvider } from '@/domain/ports/congressTradesProvider';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { readWorkerConfig } from '@/infrastructure/market/config';
import { loadSkillsCached } from '@/infrastructure/skills/loader';
import { createSkillSamplingPlan } from '@/infrastructure/skills/sampling';
import type {
    AnalysisType,
    CongressTrade,
    CongressTrendResponse,
} from '@/domain/types';

/** Maximum time to wait for the worker to accept the congress trend analysis job. */
const SUBMIT_CONGRESS_TREND_TIMEOUT_MS = 5 * MS_PER_MINUTE;

/** Default number of trade records fetched per chamber when `limit` is omitted. */
const DEFAULT_LIMIT = 50;

type ProviderFetchResult =
    | {
          status: 'ok';
          trades: CongressTrade[];
      }
    | SubmitCongressTrendFetchError;

/**
 * Fetch senate + house trades in parallel and merge with the already-loaded
 * skill catalog. Returns `fetch_failed` on any provider error — an empty
 * `trades` array is NOT an error (0건 = 정상); the caller's `no_trades` guard
 * handles that case. The skill catalog is loaded once by the caller and passed
 * in to avoid a redundant memoized fetch.
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

        const trades = normalizeCongressTrades(senate, house);

        return {
            status: 'ok',
            trades,
        };
    } catch (error) {
        console.error('[submitCongressTrend] Provider fetch failed:', error);
        return { status: 'error', code: 'fetch_failed', error: String(error) };
    }
}

/**
 * Submit a congressional-trade trend analysis job for the given symbol.
 *
 * Mirrors {@link submitFinancialsAnalysis} but **simpler** — congress data is
 * fully public, so there is no usage-limit check and no BYOK gate. Resolves to:
 * - `cached`: a recent analysis is reused (keyed by `symbol` + `modelId` +
 *   skill fingerprint). The Redis check happens before any provider fetch.
 * - `no_trades`: senate + house fetch + normalize yielded zero trades. No job
 *   is enqueued and the LLM is never called (cost guard; congress 0건 = 정상).
 * - `submitted`: trades were found, the prompt was built from the normalized
 *   trades + count-based stats, a `jobId` was registered, and a
 *   fire-and-forget HTTP POST was sent to the configured worker.
 * - `miss_no_trigger`: the cache missed but no job was enqueued because
 *   `options.skipEnqueueIfMiss` was set. Provider data is not fetched.
 * - `error`: the data provider threw (`code: 'fetch_failed'`).
 *
 * The job meta carries only the AI text identity (`symbol`/`modelId`/`cacheKey`).
 * The worker payload always carries {@link DEFAULT_TIER}.
 *
 * @param options - Symbol, model, provider, and optional tier/skip/limit config.
 * @returns The submission outcome.
 * @see pollCongressTrend - Polls the worker for the result of a `submitted` job.
 */
export async function submitCongressTrend(
    options: SubmitCongressTrendOptions
): Promise<SubmitCongressTrendResult> {
    const { symbol, modelId, dataProvider } = options;
    const tier = options.tier ?? DEFAULT_TIER;
    const limit = options.limit ?? DEFAULT_LIMIT;

    // Sample before prompt relevance filtering so the cache key and prompt use
    // the same tier-specific skill catalog.
    const skillsResult = await loadSkillsCached();
    const skillSampling = createSkillSamplingPlan(skillsResult.skills, tier, [
        'congress',
        symbol,
        modelId,
        options.reasoning === true ? 'reasoning-on' : 'reasoning-off',
        tier,
    ]);
    const cacheKey = buildCongressTrendCacheKey(
        symbol,
        modelId,
        `${tier}:${skillSampling.fingerprint}`,
        options.reasoning
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
            console.error('[submitCongressTrend] Cache read failed:', error);
        }
    }

    if (options.skipEnqueueIfMiss) {
        return { status: 'miss_no_trigger' };
    }

    const providerData = await fetchProviderData(dataProvider, symbol, limit);
    if (providerData.status === 'error') return providerData;
    const { trades } = providerData;

    // Cost guard: a symbol with zero disclosures is normal, not an error. Skip
    // the job + LLM entirely so we never pay to "analyze nothing".
    if (trades.length === 0) {
        return { status: 'no_trades' };
    }

    const { workerUrl, workerSecret } = readWorkerConfig();
    const stats = summarizeCongressTrades(trades);
    const { stable, dynamic } = buildCongressTrendPrompt(
        symbol,
        trades,
        stats,
        skillSampling.skills
    );
    // Design C (A/B-gate validated): fold the always-on skill digest
    // (`stable`) into the SYSTEM prompt; send `dynamic` alone as the user
    // prompt.
    const system = stable
        ? `${CONGRESS_SYSTEM_PROMPT}\n\n${stable}`
        : CONGRESS_SYSTEM_PROMPT;
    const prompt = dynamic;
    const jobId = crypto.randomUUID();

    await setJobMeta(jobId, {
        symbol,
        modelId,
        cacheKey,
        ...(skillsResult.skillsDegraded && { skillsDegraded: true }),
    });

    const dispatch = fetch(`${workerUrl}/analyze`, {
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
            analysisType: 'congress' satisfies AnalysisType,
            system,
            responseSchema: CONGRESS_RESPONSE_SCHEMA,
            ...(options.reasoning === true && { reasoning: true }),
        }),
        signal: AbortSignal.timeout(SUBMIT_CONGRESS_TREND_TIMEOUT_MS),
    }).catch(error => {
        console.error('[submitCongressTrend] Worker request failed:', error);
    });
    fireAndForget(dispatch, options);

    return { status: 'submitted', jobId };
}
