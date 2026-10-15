import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { dedupeGeneration } from '@/application/analysis/generationLock';
import { DEEPSEEK_V4_1_FLASH_MODEL } from '@/application/chat/constants';
import type {
    RunInvestorFlowsAnalysisFetchError,
    RunInvestorFlowsAnalysisOptions,
    RunInvestorFlowsAnalysisResult,
} from '@/application/investorFlows/types';
import { normalizeInvestorFlowsAnalysisResponse } from '@/domain/analysis/normalizeInvestorFlows';
import { buildInvestorFlowsAnalysisPrompt } from '@/domain/analysis/investorFlowsPrompt';
import { MODEL_SPECS } from '@/domain/analysis/modelSpecs';
import {
    DEFAULT_ANALYSIS_LOCALE,
    outputLanguageReminder,
} from '@/domain/analysis/outputLocale';
import { INVESTOR_FLOWS_RESPONSE_SCHEMA } from '@/domain/analysis/responseSchemas';
import { investorFlowsSystemPrompt } from '@/domain/analysis/systemPrompt';
import { INVESTOR_FLOWS_AXES } from '@/domain/investorFlows/constants';
import { evaluateInvestorFlows } from '@/domain/investorFlows/evaluateInvestorFlows';
import type { InvestorFlowsDataProvider } from '@/domain/ports/investorFlowsDataProvider';
import { DEFAULT_TIER } from '@/domain/tier';
import type {
    ActiveModelId,
    InvestorFlowsAnalysisResponse,
    InvestorFlowsSnapshot,
} from '@/domain/types';
import {
    buildInvestorFlowsCacheKey,
    INVESTOR_FLOWS_CACHE_TTL_SECONDS,
} from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { analysisSeed } from '@/infrastructure/hash/analysisInput';
import { reasoningSeedPart } from '@/infrastructure/skills/sampling';

type SnapshotFetchResult =
    | { status: 'ok'; snapshot: InvestorFlowsSnapshot | null }
    | RunInvestorFlowsAnalysisFetchError;

async function fetchSnapshot(
    dataProvider: InvestorFlowsDataProvider,
    symbol: string
): Promise<SnapshotFetchResult> {
    try {
        return {
            status: 'ok',
            snapshot: await dataProvider.getInvestorFlowsSnapshot(symbol),
        };
    } catch (error) {
        console.error(
            '[RunInvestorFlowsAnalysis] Provider fetch failed:',
            error
        );
        return { status: 'error', code: 'fetch_failed', error: String(error) };
    }
}

/**
 * Run an investor-flows analysis end-to-end: cache lookup → snapshot fetch →
 * no-data guard → scorecard + prompt → LLM call → normalize → cache write.
 *
 * The scorecard is computed in code (`evaluateInvestorFlows`) and injected into
 * the prompt; the model only interprets it. The use-case consumes no skill
 * catalog, so the cache key carries no skill fingerprint.
 *
 * Investor flows data is public: there is no usage-limit gate and no BYOK-required
 * check — tier gating for `modelId` is the caller's responsibility. The cache
 * key folds `reasoning`, `locale` and `includeFinraData`, and the seed folds
 * `reasoning` (so the toggles never share an entry).
 *
 * Concurrent calls for the same cache key are deduplicated via
 * `dedupeGeneration` (in-process and cross-instance). Pass `options.signal` so a
 * dropped connection aborts the in-flight call.
 *
 * @param options - See {@link RunInvestorFlowsAnalysisOptions}.
 * @returns `cached`, `done` (with the scorecard it interpreted),
 *   `miss_no_trigger`, `no_data` (no snapshot, or every axis insufficient) or
 *   `error` (`fetch_failed`).
 * @throws If the AI provider call fails (network, 5xx, abort).
 */
export async function runInvestorFlowsAnalysis(
    options: RunInvestorFlowsAnalysisOptions
): Promise<RunInvestorFlowsAnalysisResult> {
    const { symbol, modelId, dataProvider } = options;
    const tier = options.tier ?? DEFAULT_TIER;
    const locale = options.locale ?? DEFAULT_ANALYSIS_LOCALE;
    const includeFinraData = options.includeFinraData ?? true;

    const cacheKey = buildInvestorFlowsCacheKey(
        symbol,
        modelId,
        options.reasoning,
        options.locale,
        includeFinraData
    );
    const cache = createCacheProvider();

    if (!options.force && cache !== null) {
        try {
            const cached =
                await cache.get<InvestorFlowsAnalysisResponse>(cacheKey);
            if (cached !== null) {
                const result = normalizeInvestorFlowsAnalysisResponse(cached);
                // A blank summary is worse than regenerating.
                if (result.summaryKo) return { status: 'cached', result };
            }
        } catch (error) {
            console.error(
                '[RunInvestorFlowsAnalysis] Cache read failed:',
                error
            );
        }
    }

    if (options.skipEnqueueIfMiss) return { status: 'miss_no_trigger' };

    const fetched = await fetchSnapshot(dataProvider, symbol);
    if (fetched.status === 'error') return fetched;
    const { snapshot } = fetched;
    if (snapshot === null) return { status: 'no_data' };

    const scorecard = evaluateInvestorFlows(snapshot, { includeFinraData });
    // Cost guard: with every axis insufficient there is nothing to interpret.
    if (INVESTOR_FLOWS_AXES.every(axis => scorecard[axis].score === null)) {
        return { status: 'no_data' };
    }

    const { dynamic } = buildInvestorFlowsAnalysisPrompt(
        symbol,
        includeFinraData
            ? snapshot
            : { ...snapshot, shortInterest: null, shortVolume: null },
        scorecard,
        locale
    );
    const system = investorFlowsSystemPrompt(locale);
    // Restate the output language as the LAST instruction; empty for the default locale.
    const prompt = `${dynamic}${outputLanguageReminder(locale)}`;

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
                signal: options.signal,
                fallbackOnProviderFailure: options.providerFallback,
                system,
                responseSchema: INVESTOR_FLOWS_RESPONSE_SCHEMA,
                seed: analysisSeed(
                    `${system}\n\n${prompt}\n${reasoningSeedPart(options.reasoning)}`
                ),
                reasoning: options.reasoning,
                correlationId: `${symbol}:investorFlows`,
            }),
        { signal: options.signal }
    );

    // normalize parses fences/garbage itself; parsing here would let a non-JSON
    // reply throw past that defence.
    const result = normalizeInvestorFlowsAnalysisResponse(raw);

    if (result.summaryKo === '' && result.axisInterpretations.length === 0) {
        console.warn(
            '[RunInvestorFlowsAnalysis] Empty investor flows (수급) analysis',
            {
                symbol,
            }
        );
    }

    if (cache !== null) {
        cache
            .set(cacheKey, result, INVESTOR_FLOWS_CACHE_TTL_SECONDS)
            .catch(error =>
                console.error(
                    '[RunInvestorFlowsAnalysis] Cache write failed:',
                    error
                )
            );
    }

    return { status: 'done', result, scorecard };
}
