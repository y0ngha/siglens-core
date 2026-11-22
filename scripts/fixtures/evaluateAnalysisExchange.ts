/**
 * The deterministic checks applied to one stored analysis exchange (a prompt and the
 * model's raw reply). Shared by the fixture builder, which classifies stored exchanges
 * with it, and by the fixture tests, which assert on the same result — so the builder
 * can never select a fixture by a rule the test does not run.
 */
import { jsonrepair } from 'jsonrepair';
import { postProcessRawAnalysis } from '@/application/market/postProcessRawAnalysis';
import { normalizeJsonResponse } from '@/infrastructure/ai/normalizeJsonResponse';
import { parsePromptSupportPrices } from '@/domain/analysis/promptNumbers';
import {
    checkPlanInvariants,
    type PlanInvariantViolation,
} from '@/domain/analysis/planInvariants';
import {
    checkPriceProvenance,
    createPriceGrounding,
    type PriceProvenanceReport,
} from '@/domain/analysis/priceProvenance';
import { priceQuoting } from '@/domain/analysis/promptFormat';
import { TECHNICAL_RESPONSE_SCHEMA } from '@/domain/analysis/responseSchemas';
import type { ActionRecommendation, AnalysisResponse } from '@/domain/types';

/**
 * One stored exchange as committed under `src/__tests__/fixtures/analysisExchanges/`.
 * `rawText` is the concatenated `response.output_text.delta` stream of the provider
 * reply, `lastClose` / `atr` the dataset day record the prompt was built from.
 */
export interface AnalysisExchangeFixture {
    readonly id: string;
    readonly source: 'backtest-2026-11-daily-ai';
    readonly ticker: string;
    readonly date: string;
    readonly promptVersion: string;
    readonly lastClose: number;
    readonly atr: number | null;
    readonly dynamic: string;
    readonly rawText: string;
}

export interface AnalysisExchangeEvaluation {
    /** The model's recommendation as parsed, before any post-processing. */
    readonly rawRecommendation: ActionRecommendation | undefined;
    /** The post-processed analysis (skills `[]`, no overlays). */
    readonly result: AnalysisResponse;
    /** The analysis as the model wrote it, before any price rounding: what provenance reads. */
    readonly modelOutput: AnalysisResponse;
    readonly invariants: readonly PlanInvariantViolation[];
    readonly provenance: PriceProvenanceReport;
    /** The reply needed `normalizeJsonResponse` to drop trailing content to parse. */
    readonly needsTrailingContentSalvage: boolean;
}

/**
 * Whether `normalizeJsonResponse` kept only the first object of a reply that carries
 * more after it. Decided without copying its scan: the reply does not parse as is, and
 * `jsonrepair` — the step the salvage runs ahead of — would have produced something
 * other than what the normalizer returned (it turns `{…}{…}` into an array).
 */
function needsTrailingContentSalvage(
    rawText: string,
    normalized: string
): boolean {
    try {
        JSON.parse(rawText.trim());
        return false;
    } catch {
        // fall through to the comparison below
    }
    try {
        return (
            JSON.stringify(JSON.parse(jsonrepair(rawText.trim()))) !==
            normalized
        );
    } catch {
        return true;
    }
}

/**
 * Runs the exact production chain — `normalizeJsonResponse` against the technical
 * schema, then `postProcessRawAnalysis` — and then both deterministic checks.
 * Throws when the reply cannot be normalized (the fixtures are chosen so it can).
 */
export function evaluateAnalysisExchange(
    fixture: AnalysisExchangeFixture
): AnalysisExchangeEvaluation {
    const normalized = normalizeJsonResponse(
        fixture.rawText,
        TECHNICAL_RESPONSE_SCHEMA
    );
    const rawResult = JSON.parse(normalized) as {
        actionRecommendation?: ActionRecommendation;
    };
    const { reconciled, modelOutput } = postProcessRawAnalysis({
        rawResult,
        skills: [],
        overlayCandidates: [],
        patternGeometries: new Map(),
        lastClose: fixture.lastClose,
        atr: fixture.atr ?? undefined,
        // The stop floor snaps to a support the stored prompt printed; the fixture keeps
        // that prompt, so the candidates are read back from its text.
        stopCandidates: parsePromptSupportPrices(fixture.dynamic),
        currency: 'USD',
    });
    return {
        rawRecommendation: rawResult.actionRecommendation,
        result: reconciled,
        modelOutput,
        invariants: checkPlanInvariants(
            reconciled.actionRecommendation,
            fixture.lastClose,
            fixture.atr
        ),
        provenance: checkPriceProvenance({
            promptDynamic: fixture.dynamic,
            result: modelOutput,
            priceDecimals: priceQuoting(fixture.lastClose).dp,
        }),
        needsTrailingContentSalvage: needsTrailingContentSalvage(
            fixture.rawText,
            normalized
        ),
    };
}

/** Share of a decimal, rounded for display and for pinning in `expected.json`. */
const RATE_DIGITS = 10_000;

/**
 * The false-grounding control of a prompt: the share of prices on its own price grid
 * within ±10% of `lastClose` that count as printed. A random price a model could invent
 * is "grounded" with about this probability, so it is the measurement limit of
 * {@link checkPriceProvenance} for this prompt (an ungrounded rate below it is noise).
 */
export function falseGroundingRate(
    promptDynamic: string,
    lastClose: number,
    priceDecimals: number
): number {
    const isGrounded = createPriceGrounding(promptDynamic, priceDecimals);
    const unit = 10 ** -priceDecimals;
    const first = Math.ceil((lastClose * 0.9) / unit);
    const last = Math.floor((lastClose * 1.1) / unit);
    const grid = Array.from(
        { length: last - first + 1 },
        (_, i) => (first + i) * unit
    );
    const hits = grid.filter(price => isGrounded(price)).length;
    return Math.round((hits / grid.length) * RATE_DIGITS) / RATE_DIGITS;
}
