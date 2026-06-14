import type {
    FinancialsAnalysisResponse,
    FinancialsAxis,
    FinancialsAxisAssessment,
    FinancialsSentiment,
    RawFinancialsAnalysisResponse,
    RawFinancialsAxisAssessment,
} from '@/domain/types';
import {
    asArray,
    asEnum,
    asObject,
    asString,
    compact,
} from './normalizePrimitives';
import { extractJsonFromLlmResponse } from './promptFormat';

const VALID_SENTIMENTS: readonly FinancialsSentiment[] = [
    'bullish',
    'neutral',
    'bearish',
];
const VALID_AXES: readonly FinancialsAxis[] = [
    'growth',
    'quality',
    'solvency',
    'cash',
];

function parseLlmPayload(raw: unknown): unknown {
    return typeof raw === 'string' ? extractJsonFromLlmResponse(raw) : raw;
}

function normalizeStringArray(raw: unknown): string[] {
    return asArray(raw)
        .map(item => asString(item))
        .filter(item => item.length > 0);
}

function normalizeSentiment(value: unknown): FinancialsSentiment {
    return asEnum(value, VALID_SENTIMENTS, 'neutral');
}

function normalizeAxis(value: unknown): FinancialsAxis {
    return asEnum(value, VALID_AXES, 'growth');
}

function normalizeAxisAssessment(
    item: unknown
): FinancialsAxisAssessment | null {
    const o = asObject(item) as RawFinancialsAxisAssessment | null;
    if (!o) return null;
    return {
        axis: normalizeAxis(o.axis),
        sentiment: normalizeSentiment(o.sentiment),
        rationaleKo: asString(o.rationaleKo),
    };
}

/**
 * @internal 재무 LLM 응답을 typed {@link FinancialsAnalysisResponse}로 방어 정규화.
 * 마크다운 펜스 제거 → JSON.parse → 누락 string→'', array→[], invalid enum→기본값, malformed child 드롭.
 * @throws {SyntaxError} 펜스 제거 후에도 JSON이 아닐 때.
 */
export function normalizeFinancialsAnalysisResponse(
    raw: unknown
): FinancialsAnalysisResponse {
    const parsed = parseLlmPayload(raw);
    const o = (asObject(parsed) ?? {}) as RawFinancialsAnalysisResponse;
    return {
        overallConclusionKo: asString(o.overallConclusionKo),
        axisAssessments: compact(
            asArray(o.axisAssessments).map(normalizeAxisAssessment)
        ),
        riskFactorsKo: normalizeStringArray(o.riskFactorsKo),
        overallSentiment: normalizeSentiment(o.overallSentiment),
    };
}
