import { postProcessAnalysisWithReconcile } from '@/domain/analysis/ai-levels';
import {
    attachComputedCards,
    enrichAnalysisWithConfidence,
    isFallbackAnalysis,
} from '@/domain/analysis/confidence';
import type { KrxTickTable } from '@/domain/analysis/krxTick';
import { normalizeIdList } from '@/domain/analysis/normalize';
import { asObject } from '@/domain/analysis/normalizePrimitives';
import {
    DEFAULT_ANALYSIS_LOCALE,
    type AnalysisLocale,
} from '@/domain/analysis/outputLocale';
import { roundAnalysisPrices } from '@/domain/analysis/roundAnalysisPrices';
import { alignPatternGeometry, resolveChartOverlays } from '@/domain/overlays';
import type {
    AnalysisResponse,
    CurrencyCode,
    IndicatorGuideResult,
    OverlayCandidate,
    PatternTargetGeometry,
    RawStrategyResult,
    ResolvedChartOverlays,
    Skill,
} from '@/domain/types';

/**
 * @internal
 * Inputs of {@link postProcessRawAnalysis}: the model's parsed JSON plus everything the
 * prompt builder and the bars fed into the same run.
 */
export interface PostProcessRawAnalysisInput {
    /** The parsed model JSON (`JSON.parse` of the normalized reply). */
    readonly rawResult: unknown;
    readonly skills: Skill[];
    /** `TechnicalAssembledPrompt.overlayCandidates`; `[]` resolves no overlay. */
    readonly overlayCandidates: readonly OverlayCandidate[];
    /** `TechnicalAssembledPrompt.patternGeometries`; empty strips every detected card's geometry. */
    readonly patternGeometries: ReadonlyMap<
        string,
        PatternTargetGeometry | null
    >;
    /** Close of the last bar, the price the plan check measures against. */
    readonly lastClose: number | undefined;
    readonly atr: number | undefined;
    /**
     * `TechnicalAssembledPrompt.printedSupportPrices`: the support prices the prompt printed,
     * the stop floor's candidates. Required: omitting it would turn every `level` stop into
     * an ATR one without a trace.
     */
    readonly stopCandidates: readonly number[];
    /**
     * `TechnicalAssembledPrompt.patternSkillNames`: the pattern skills the prompt listed. A
     * `patternSummaries` entry whose skill is not among them is dropped (the prompt allows
     * entries for the listed patterns only). Omitted keeps every entry, as for callers
     * that have no prompt.
     */
    readonly allowedPatternSkills?: readonly string[];
    /**
     * `TechnicalAssembledPrompt.indicatorCards`: the indicator cards code built from the
     * prompt's own lines. They become `indicatorResults` after enrichment; whatever the model
     * wrote under that name is dropped. Required, like `stopCandidates`: omitting it would
     * leave the analysis without cards and without a trace.
     */
    readonly computedIndicatorResults: readonly IndicatorGuideResult[];
    /**
     * `TechnicalAssembledPrompt.cycleCards`: the MA and MACD cycle cards. They join
     * `strategyResults` after the model's entries, and any model entry for a skill that
     * carries a `computed_card` tag is dropped. Required for the same reason.
     */
    readonly computedStrategyResults: readonly RawStrategyResult[];
    readonly currency?: CurrencyCode;
    readonly locale?: AnalysisLocale;
    readonly krxTickTable?: KrxTickTable;
}

/**
 * @internal
 * `reconciled` is the post-processed analysis, with the computed cards; `resolvedOverlays`
 * the overlays the model's references resolved to, which `runAnalysis` stores next to it;
 * `modelOutput` the analysis before any price rounding, without the computed cards.
 */
export interface PostProcessedRawAnalysis {
    readonly reconciled: AnalysisResponse;
    readonly resolvedOverlays: ResolvedChartOverlays;
    /**
     * The analysis as the model wrote it: enriched and with pattern geometry aligned, but
     * before any KRX tick rounding or reconciliation. The price provenance check reads
     * this one, because rounding snaps a made-up price onto a printed-looking tick. It has
     * no computed cards: their numbers are prompt values, not prices the model wrote.
     */
    readonly modelOutput: AnalysisResponse;
}

/**
 * @internal
 *
 * Everything `runAnalysis` does to a parsed model reply before it adds the computed
 * fields (`riskLevel`, `analyzedAt`, `dataAsOf`): confidence enrichment (the cards code
 * computed are attached last, and not at all to an empty fallback reply), overlay
 * resolution, pattern-geometry alignment, KRX tick rounding, SL/TP reconciliation, the
 * plan check and the plan state (which also sets `entryRecommendation`). One function so the deterministic checks and the replay tooling run
 * the exact chain production runs, never a copy of it.
 *
 * Overlays are resolved against the enriched analysis **before** post-processing: the
 * pattern targets `postProcessAnalysisWithReconcile` appends are derived from
 * `geometry`, which `alignPatternGeometry` first replaces with the geometry of the
 * overlay the card actually draws. Post-processing only touches
 * `keyPrices`/`actionRecommendation` — none of the ids, names, `detected` or candidate
 * ids resolution reads — so resolving earlier yields the same overlays.
 *
 * KRX prices are rounded to their tick on both sides of post-processing: before, so the
 * plan check and the risk:reward line read the levels the card will show; after, for the
 * measured pattern targets post-processing appends.
 */
export function postProcessRawAnalysis(
    input: PostProcessRawAnalysisInput
): PostProcessedRawAnalysis {
    const {
        rawResult,
        skills,
        overlayCandidates,
        patternGeometries,
        lastClose,
        atr,
        stopCandidates,
        allowedPatternSkills,
        computedIndicatorResults,
        computedStrategyResults,
        currency,
        locale = DEFAULT_ANALYSIS_LOCALE,
        krxTickTable,
    } = input;
    const enriched = enrichAnalysisWithConfidence(
        rawResult,
        skills,
        allowedPatternSkills,
        { withoutModelCards: true }
    );
    const resolvedOverlays = resolveChartOverlays(
        overlayCandidates,
        enriched,
        normalizeIdList(asObject(rawResult)?.trendlineIds),
        skills
    );
    const modelOutput = alignPatternGeometry(
        enriched,
        resolvedOverlays.chartOverlays,
        patternGeometries
    );
    const reconciledWithoutCards = roundAnalysisPrices(
        postProcessAnalysisWithReconcile(
            roundAnalysisPrices(modelOutput, currency, krxTickTable),
            lastClose,
            atr,
            stopCandidates,
            currency,
            locale,
            krxTickTable
        ),
        currency,
        krxTickTable
    );
    // A reply that is the empty fallback gets no card: with one, `isFallbackAnalysis` would
    // no longer recognise it and the failed reply would be cached and shown as an analysis.
    // The decision is on the model's reply (`enriched`), before the cards exist.
    const reconciled = isFallbackAnalysis(enriched)
        ? reconciledWithoutCards
        : attachComputedCards(
              reconciledWithoutCards,
              {
                  indicatorResults: computedIndicatorResults,
                  strategyResults: computedStrategyResults,
              },
              skills
          );
    return { reconciled, resolvedOverlays, modelOutput };
}
