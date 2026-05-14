import { fireAndForget } from '@/application/background';
import { buildUserApiKeyRequiredError } from '@/application/byok/gate';
import { hashAnalysisInput } from '@/infrastructure/hash/analysisInput';
import {
    buildUsageLimitError,
    checkAnalysisUsageAllowed,
    recordAnalysisUsageSafely,
} from '@/application/usage';
import type {
    SubmitOptionsAnalysisLimitError,
    SubmitOptionsAnalysisNoChainsError,
    SubmitOptionsAnalysisOptions,
    SubmitOptionsAnalysisResult,
} from '@/application/options/types';
import { normalizeOptionsAnalysisResponse } from '@/domain/analysis/normalizeOptions';
import { buildOptionsAnalysisPrompt } from '@/domain/options/optionsPrompt';
import { DEFAULT_TIER, requiresByokKey, TIER_CONFIG } from '@/domain/tier';
import { MS_PER_MINUTE } from '@/domain/constants/time';
import { buildOptionsCacheKey } from '@/application/options/cacheKey';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { readWorkerConfig } from '@/infrastructure/market/config';
import { sanitizeOptionsChain } from '@/domain/options/sanitizeOptionsChain';
import type { OptionsAnalysisResponse, OptionsSnapshot } from '@/domain/types';

/** Maximum time to wait for the worker to accept the options analysis job. */
const SUBMIT_OPTIONS_ANALYSIS_TIMEOUT_MS = 5 * MS_PER_MINUTE;

/**
 * Derive a short deterministic hash of the options snapshot and expiration
 * date selection.
 *
 * The hash is computed from the symbol, underlying price, capture timestamp,
 * expiration date filter, and a structural digest of each chain (call/put
 * lengths and open-interest sums). This ensures a meaningful market change
 * (new strikes added, OI shift) busts the cache without requiring the full
 * contract list to be serialized.
 *
 * @param snapshot       - Options snapshot fetched from the provider.
 * @param expirationDate - Target expiration or `'all'`.
 * @returns 16-character lowercase hex string.
 */
function hashOptionsInput(
    snapshot: OptionsSnapshot,
    expirationDate: string | 'all'
): string {
    return hashAnalysisInput(
        JSON.stringify({
            symbol: snapshot.symbol,
            underlyingPrice: snapshot.underlyingPrice,
            capturedAt: snapshot.capturedAt,
            expirationDate,
            chains: snapshot.chains.map(c => ({
                expirationDate: c.expirationDate,
                callsLen: c.calls.length,
                putsLen: c.puts.length,
                callsOiSum: c.calls.reduce((s, x) => s + x.openInterest, 0),
                putsOiSum: c.puts.reduce((s, x) => s + x.openInterest, 0),
            })),
        })
    );
}

/**
 * Submit an options analysis job for the given symbol and expiration.
 *
 * Resolves to one of four outcomes:
 * - `cached`: a recent analysis is reused (keyed by `symbol` + `expirationDate`
 *   + `modelId` + an input hash derived from the snapshot).
 * - `submitted`: the prompt was built, a `jobId` was registered, and a
 *   fire-and-forget HTTP POST was sent to the configured worker. Poll the
 *   result with {@link pollOptionsAnalysis}.
 * - `miss_no_trigger`: the cache missed but no job was enqueued because
 *   `options.skipEnqueueIfMiss` was set; no worker request is made. The
 *   consumer should render a fallback (typically used for bot/crawler gating).
 * - `error`: either no usable chains were found (`no_options_chains`), the
 *   daily analysis limit was exceeded (`usage_limit_exceeded`), or another
 *   gate blocked the submission.
 *
 * Tier and usage checks are skipped entirely when `options.usage` or
 * `options.tier` is not provided — this is the intended pre-Phase 4 behavior.
 *
 * @param options - Symbol, expiration, model, snapshot, and optional
 *   tier/usage/timing config.
 * @returns The submission outcome.
 *
 * @example
 * ```ts
 * const res = await submitOptionsAnalysis({ symbol: 'AAPL', expirationDate: '2026-06-20', modelId: 'gemini-2.5-flash', snapshot });
 * if (res.status === 'cached') return res.result;
 * if (res.status === 'miss_no_trigger') return null; // bot/crawler fallback
 * if (res.status === 'error') return res.error;
 * const polled = await pollOptionsAnalysis(res.jobId);
 * ```
 *
 * @see pollOptionsAnalysis
 */
export async function submitOptionsAnalysis(
    options: SubmitOptionsAnalysisOptions
): Promise<SubmitOptionsAnalysisResult> {
    const {
        symbol,
        companyName = symbol,
        modelId,
        snapshot,
        expirationDate,
    } = options;
    const usage = options.usage;
    const occurredAt = options.now ?? usage?.occurredAt ?? new Date();

    // ── 1. No-chains guard (sanitize each chain, require at least one usable) ──
    // Sanitize each chain, drop unreliable ones, and require at least one
    // chain (for 'all') or the matching chain (for a specific expiration).
    const usableChains = snapshot.chains
        .map(c => sanitizeOptionsChain(c))
        .filter((c): c is NonNullable<typeof c> => c !== null);

    if (usableChains.length === 0) {
        const noChainsError: SubmitOptionsAnalysisNoChainsError = {
            status: 'error',
            code: 'no_options_chains',
            error: 'snapshot has no usable options chains',
        };
        return noChainsError;
    }

    if (expirationDate !== 'all') {
        const hasTarget = usableChains.some(
            c => c.expirationDate === expirationDate
        );
        if (!hasTarget) {
            const noChainsError: SubmitOptionsAnalysisNoChainsError = {
                status: 'error',
                code: 'no_options_chains',
                error: `expiration ${expirationDate} not present in snapshot`,
            };
            return noChainsError;
        }
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
            const limitError: SubmitOptionsAnalysisLimitError = {
                status: 'error',
                code: 'usage_limit_exceeded',
                error: buildUsageLimitError('analysisPerDay', tier),
            };
            return limitError;
        }
    }

    // ── 3. Hash snapshot → build cache key → check cache ──
    const inputHash = hashOptionsInput(snapshot, expirationDate);
    const cacheKey = buildOptionsCacheKey(
        symbol,
        expirationDate,
        modelId,
        inputHash
    );
    const cache = createCacheProvider();

    if (cache !== null) {
        try {
            const cached = await cache.get<unknown>(cacheKey);
            // Lightweight structural validation — schema drift from a prior
            // release should fall through as a cache miss rather than poison
            // the response. The schema-version prefix on the cache key is the
            // primary invalidation lever (see CACHE_KEY_SCHEMA_VERSION); this
            // check is a belt-and-braces fallback.
            if (cached !== null) {
                const result: OptionsAnalysisResponse =
                    normalizeOptionsAnalysisResponse(cached, occurredAt);
                await recordAnalysisUsageSafely(usage, modelId, occurredAt);
                return { status: 'cached', result };
            }
        } catch (error) {
            console.error('[submitOptionsAnalysis] Cache read failed:', error);
        }
    }

    if (options.skipEnqueueIfMiss) {
        return { status: 'miss_no_trigger' };
    }

    // ── 4. Build prompt, enqueue job, fire-and-forget worker POST ──
    const { workerUrl, workerSecret } = readWorkerConfig();
    const prompt = buildOptionsAnalysisPrompt({
        expirationDate,
        companyName,
        snapshot: { ...snapshot, chains: usableChains },
    });
    const jobId = crypto.randomUUID();

    await setJobMeta(jobId, {
        symbol,
        modelId,
        cacheKey,
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
        signal: AbortSignal.timeout(SUBMIT_OPTIONS_ANALYSIS_TIMEOUT_MS),
    }).catch(error => {
        console.error('[submitOptionsAnalysis] Worker request failed:', error);
    });
    fireAndForget(dispatch, options);

    await recordAnalysisUsageSafely(usage, modelId, occurredAt);

    return { status: 'submitted', jobId };
}
