import { postProcessAnalysisWithReconcile } from '@/domain/analysis/ai-levels';
import { enrichAnalysisWithConfidence } from '@/domain/analysis/confidence';
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
    OverlayCandidate,
    PatternTargetGeometry,
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
    readonly currency?: CurrencyCode;
    readonly locale?: AnalysisLocale;
    readonly krxTickTable?: KrxTickTable;
}

/**
 * @internal
 * `reconciled` is the post-processed analysis; `resolvedOverlays` the overlays the model's
 * references resolved to, which `runAnalysis` stores next to it; `modelOutput` the analysis
 * before any price rounding.
 */
export interface PostProcessedRawAnalysis {
    readonly reconciled: AnalysisResponse;
    readonly resolvedOverlays: ResolvedChartOverlays;
    /**
     * The analysis as the model wrote it: enriched and with pattern geometry aligned, but
     * before any KRX tick rounding or reconciliation. The price provenance check reads
     * this one, because rounding snaps a made-up price onto a printed-looking tick.
     */
    readonly modelOutput: AnalysisResponse;
}

/**
 * @internal
 *
 * Everything `runAnalysis` does to a parsed model reply before it adds the computed
 * fields (`riskLevel`, `analyzedAt`, `dataAsOf`): confidence enrichment, overlay
 * resolution, pattern-geometry alignment, KRX tick rounding, SL/TP reconciliation and
 * the plan check. One function so the deterministic checks and the replay tooling run
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
        currency,
        locale = DEFAULT_ANALYSIS_LOCALE,
        krxTickTable,
    } = input;
    const enriched = enrichAnalysisWithConfidence(rawResult, skills);
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
    const reconciled = roundAnalysisPrices(
        postProcessAnalysisWithReconcile(
            roundAnalysisPrices(modelOutput, currency, krxTickTable),
            lastClose,
            atr,
            currency,
            locale,
            krxTickTable
        ),
        currency,
        krxTickTable
    );
    return { reconciled, resolvedOverlays, modelOutput };
}
