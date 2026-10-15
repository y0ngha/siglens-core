import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { dedupeGeneration } from '@/application/analysis/generationLock';
import { DEEPSEEK_V4_1_FLASH_MODEL } from '@/application/chat/constants';
import {
    buildUserApiKeyRequiredError,
    isUserApiKeyGateDenied,
    resolveInFlightKey,
} from '@/application/byok/gate';
import {
    analysisSeed,
    hashAnalysisInput,
} from '@/infrastructure/hash/analysisInput';
import {
    buildUsageLimitError,
    checkAnalysisUsageAllowed,
    recordAnalysisUsageSafely,
} from '@/application/usage';
import type {
    RunOptionsAnalysisResult,
    SubmitOptionsAnalysisLimitError,
    SubmitOptionsAnalysisNoChainsError,
    SubmitOptionsAnalysisOptions,
} from '@/application/options/types';
import { normalizeOptionsAnalysisResponse } from '@/domain/analysis/normalizeOptions';
import {
    DEFAULT_ANALYSIS_LOCALE,
    outputLanguageReminder,
} from '@/domain/analysis/outputLocale';
import { buildOptionsAnalysisPrompt } from '@/domain/options/optionsPrompt';
import { OPTIONS_RESPONSE_SCHEMA } from '@/domain/analysis/responseSchemas';
import { optionsSystemPrompt } from '@/domain/analysis/systemPrompt';
import { MODEL_SPECS } from '@/domain/analysis/modelSpecs';
import { DEFAULT_TIER, TIER_CONFIG } from '@/domain/tier';
import {
    buildOptionsCacheKey,
    OPTIONS_CACHE_TTL_SECONDS,
} from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { sanitizeOptionsChain } from '@/domain/options/sanitizeOptionsChain';
import type {
    ActiveModelId,
    OptionsAnalysisResponse,
    OptionsExpirationFilter,
    OptionsSnapshot,
} from '@/domain/types';

const LOG_PREFIX = '[RunOptions]';

/**
 * Derive a short deterministic hash of the options snapshot and expiration
 * date selection.
 *
 * Mirrors the private helper in `submitOptionsAnalysis.ts` — intentionally
 * not shared so that the two modules remain independently deployable.
 * See `submitOptionsAnalysis.ts` for the full rationale of what fields are
 * included in the hash (structural identity only; volatile fields excluded).
 */
function hashOptionsInput(
    snapshot: OptionsSnapshot,
    expirationDate: OptionsExpirationFilter
): string {
    const targetChains =
        expirationDate === 'all'
            ? snapshot.chains
            : snapshot.chains.filter(c => c.expirationDate === expirationDate);

    return hashAnalysisInput(
        JSON.stringify({
            symbol: snapshot.symbol,
            expirationDate,
            chains: targetChains.map(c => ({
                expirationDate: c.expirationDate,
                callsLen: c.calls.length,
                putsLen: c.puts.length,
            })),
        })
    );
}

/**
 * Run an options analysis end-to-end: no-chains guard → cache lookup → tier
 * gate → LLM call → normalisation → cache write → return.
 *
 * This is the direct (non-queued) replacement for the
 * `submitOptionsAnalysis` + `pollOptionsAnalysis` pair. The caller awaits a
 * single promise; no job IDs, no Redis meta, no polling loop.
 *
 * Gate order matches `submitOptionsAnalysis`:
 *  1. No-chains guard (sanitise chains; return `no_chains_error` immediately
 *     if no usable chain exists — before any cache or tier check).
 *  2. Cache lookup (a cached result is returned without a BYOK or usage gate).
 *  3. `skipEnqueueIfMiss` check.
 *  4. BYOK gate.
 *  5. Usage limit check.
 *  6. LLM call + normalisation + cache write.
 *
 * `normalizeOptionsAnalysisResponse` never throws — every field has a fallback.
 * An empty response (summary blank, no expirations, no signals) is logged as a
 * warning and still written to cache (matches `pollOptionsAnalysis` behaviour).
 *
 * Concurrent calls sharing the same in-flight key are deduplicated via
 * `dedupeGeneration` (in-process and cross-instance): only one LLM call fires; all waiting callers
 * with that key receive the same result.
 * "Same in-flight key" means the same `cacheKey` for `keyPolicy: 'tier'` (the
 * default), and the same `cacheKey` plus the same `userApiKey` (scoped by a hash,
 * never the raw key) for `'byok-only'` — callers on other keys or policies
 * neither join this run nor receive its result or failure.
 *
 * Pass `options.signal` (e.g. `request.signal` from the SSE route handler)
 * so a dropped connection aborts the in-flight LLM call.
 *
 * @throws If the AI provider call fails (network, 5xx, abort). Gate denials
 *   are returned as discriminated-union variants, not thrown.
 *
 * @see submitOptionsAnalysis — the queued predecessor; still exported for
 *   the existing production path until siglens switches to runOptionsAnalysis.
 */
export async function runOptionsAnalysis(
    options: SubmitOptionsAnalysisOptions
): Promise<RunOptionsAnalysisResult> {
    const {
        symbol,
        companyName = symbol,
        modelId,
        snapshot,
        expirationDate,
    } = options;
    const usage = options.usage;
    const occurredAt = options.now ?? usage?.occurredAt ?? new Date();

    // ── 1. No-chains guard (before cache — same order as submitOptionsAnalysis) ──
    const usableChains = snapshot.chains
        .map(c => sanitizeOptionsChain(c))
        .filter((c): c is NonNullable<typeof c> => c !== null);

    if (usableChains.length === 0) {
        const noChainsError: SubmitOptionsAnalysisNoChainsError = {
            status: 'no_chains_error',
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
                status: 'no_chains_error',
                code: 'no_options_chains',
                error: `expiration ${expirationDate} not present in snapshot`,
            };
            return noChainsError;
        }
    }

    // ── 2. Hash snapshot → build cache key → check cache ──
    // Cache check runs BEFORE the BYOK gate and usage limit so a cached result
    // (which involves no new AI computation) is never blocked by a missing user
    // API key or an exhausted daily quota. Mirrors submitOptionsAnalysis.
    const inputHash = hashOptionsInput(snapshot, expirationDate);
    const cacheKey = buildOptionsCacheKey(
        symbol,
        expirationDate,
        modelId,
        inputHash,
        options.reasoning,
        options.locale
    );
    const cache = createCacheProvider();

    if (!options.force && cache !== null) {
        try {
            const cached = await cache.get<unknown>(cacheKey);
            if (cached !== null) {
                const result: OptionsAnalysisResponse =
                    normalizeOptionsAnalysisResponse(cached, occurredAt);
                await recordAnalysisUsageSafely(usage, modelId, occurredAt);
                return { status: 'cached', result };
            }
        } catch (error) {
            console.error(`${LOG_PREFIX} Cache read failed:`, error);
        }
    }

    if (options.skipEnqueueIfMiss) {
        return { status: 'miss_no_trigger' };
    }

    // ── 3. BYOK gate (after cache miss — same order as submitOptionsAnalysis) ──
    const tier = options.tier ?? DEFAULT_TIER;
    const tierConfig = options.tierConfig ?? TIER_CONFIG;

    if (
        isUserApiKeyGateDenied(
            tier,
            modelId,
            tierConfig,
            options.userApiKey,
            options.keyPolicy
        )
    ) {
        return buildUserApiKeyRequiredError(tier, modelId);
    }

    // ── 4. Usage limit check ──
    if (options.tier !== undefined && usage !== undefined) {
        const allowed = await checkAnalysisUsageAllowed(
            usage,
            tier,
            occurredAt,
            tierConfig
        );
        if (!allowed) {
            const limitError: SubmitOptionsAnalysisLimitError = {
                status: 'limit_error',
                code: 'usage_limit_exceeded',
                error: buildUsageLimitError('analysisPerDay', tier),
            };
            return limitError;
        }
    }

    // ── 5. Build prompt, call LLM, normalise, cache, return ──
    const locale = options.locale ?? DEFAULT_ANALYSIS_LOCALE;
    const { stable, dynamic } = buildOptionsAnalysisPrompt({
        expirationDate,
        companyName,
        snapshot: { ...snapshot, chains: usableChains },
        locale,
    });
    // Design C: the always-on skill digest (`stable`) folds into SYSTEM.
    // This builder has no skills catalog, so `stable` is always '' and
    // `system` stays the base persona unchanged.
    const system = stable
        ? `${optionsSystemPrompt(locale)}\n\n${stable}`
        : optionsSystemPrompt(locale);
    // 출력 언어를 **마지막 지시**로 한 번 더 못 박는다 — 유저 프롬프트의 필드
    // 설명은 언어를 `Korean`으로 적어 둔 곳이 많아 그것만으로는 뒤집히지 않는다.
    // 기본 로케일(ko)에서는 빈 문자열이라 프롬프트 바이트가 예전과 같다.
    const prompt = `${dynamic}${outputLanguageReminder(locale)}`;

    // callModelId resolves the actual ActiveModelId for the AI call.
    const callModelId: ActiveModelId =
        (modelId as string) in MODEL_SPECS
            ? (modelId as ActiveModelId)
            : DEEPSEEK_V4_1_FLASH_MODEL;

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
                responseSchema: OPTIONS_RESPONSE_SCHEMA,
                seed: analysisSeed(`${system}\n\n${prompt}`),
                reasoning: options.reasoning,
                correlationId: `${symbol}:options`,
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

    // Inline post-processing (formerly in pollOptionsAnalysis). No job queue involved.
    // normalizeOptionsAnalysisResponse never throws — every field has a fallback.
    const rawResult = JSON.parse(raw) as unknown;
    const result: OptionsAnalysisResponse = normalizeOptionsAnalysisResponse(
        rawResult,
        occurredAt
    );

    if (
        result.summary === '' &&
        result.perExpiration.length === 0 &&
        result.signals.length === 0
    ) {
        console.warn(`${LOG_PREFIX} Empty options analysis`, { symbol });
    }

    // Cache the normalized result. Matches pollOptionsAnalysis: write even
    // when the result is content-empty. Fire-and-forget so the cache write
    // does not delay the response.
    if (cache !== null) {
        cache
            .set(cacheKey, result, OPTIONS_CACHE_TTL_SECONDS)
            .catch(error =>
                console.error(`${LOG_PREFIX} Cache write failed:`, error)
            );
    }

    // Record usage AFTER the LLM returns so an aborted or failed call does
    // not consume quota (invariant 4 of the worker-removal design).
    await recordAnalysisUsageSafely(usage, modelId, occurredAt);

    return { status: 'done', result };
}
