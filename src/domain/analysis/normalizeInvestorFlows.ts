import { INVESTOR_FLOWS_AXES } from '@/domain/investorFlows/constants';
import type {
    InvestorFlowsAnalysisResponse,
    InvestorFlowsAxisInterpretation,
    RawInvestorFlowsAnalysisResponse,
    RawInvestorFlowsAxisInterpretation,
} from '@/domain/types';
import { asArray, asObject, asString } from './normalizePrimitives';
import { extractJsonFromLlmResponse } from './promptFormat';

function parseLlmPayload(raw: unknown): unknown {
    return typeof raw === 'string' ? extractJsonFromLlmResponse(raw) : raw;
}

function normalizeStringArray(raw: unknown): string[] {
    return asArray(raw)
        .map(item => asString(item))
        .filter(item => item.length > 0);
}

function normalizeInterpretation(
    raw: unknown
): InvestorFlowsAxisInterpretation | null {
    const o = asObject(raw) as RawInvestorFlowsAxisInterpretation | null;
    if (o === null) return null;
    const axis = INVESTOR_FLOWS_AXES.find(a => a === o.axis);
    const interpretationKo = asString(o.interpretationKo);
    return axis === undefined || interpretationKo === ''
        ? null
        : { axis, interpretationKo };
}

/**
 * Normalize a raw LLM response into a typed {@link InvestorFlowsAnalysisResponse}.
 *
 * Strips optional markdown code fences, parses JSON, and defensively
 * normalizes every field. Missing strings become `''`, missing arrays `[]`,
 * non-string array items are dropped. Axis interpretations with an unknown
 * axis or an empty text are dropped, a repeated axis keeps its first entry,
 * and the survivors come back in canonical axis order so a UI can render them
 * without sorting.
 *
 * @param raw - Raw string/object from the LLM or cache.
 * @returns A fully-typed {@link InvestorFlowsAnalysisResponse}.
 * @throws {SyntaxError} When the string is not valid JSON after fence removal.
 */
export function normalizeInvestorFlowsAnalysisResponse(
    raw: unknown
): InvestorFlowsAnalysisResponse {
    const parsed = parseLlmPayload(raw);
    const o = (asObject(parsed) ?? {}) as RawInvestorFlowsAnalysisResponse;
    const interpretations = asArray(o.axisInterpretations).flatMap(item => {
        const normalized = normalizeInterpretation(item);
        return normalized === null ? [] : [normalized];
    });
    return {
        summaryKo: asString(o.summaryKo),
        axisInterpretations: INVESTOR_FLOWS_AXES.flatMap(axis => {
            const first = interpretations.find(i => i.axis === axis);
            return first === undefined ? [] : [first];
        }),
        keySignalsKo: normalizeStringArray(o.keySignalsKo),
        risksKo: normalizeStringArray(o.risksKo),
        dataNotesKo: normalizeStringArray(o.dataNotesKo),
    };
}
