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
    // Cast needed: asObject returns Record<string, unknown> | null. Runtime-safe
    // because RawFinancialsAxisAssessment's fields are all optional `unknown`, so
    // any object structurally satisfies it (the cast only narrows for property access).
    const o = asObject(item) as RawFinancialsAxisAssessment | null;
    if (!o) return null;
    return {
        axis: normalizeAxis(o.axis),
        sentiment: normalizeSentiment(o.sentiment),
        rationaleKo: asString(o.rationaleKo),
    };
}

/**
 * Normalize a raw LLM response into a typed {@link FinancialsAnalysisResponse}.
 *
 * Strips optional markdown code fences (` ```json ` / ` ``` `), parses JSON, and
 * defensively normalizes every field. Missing strings become `''`, missing
 * arrays become `[]`, malformed child entries are dropped, and invalid enum
 * values fall back to conservative defaults (`overallSentiment`/axis sentiment →
 * `'neutral'`, axis → `'growth'`).
 *
 * @param raw - Raw string/object from the LLM worker or cache.
 * @returns A fully-typed {@link FinancialsAnalysisResponse}.
 * @throws {SyntaxError} When the string is not valid JSON after fence removal.
 */
export function normalizeFinancialsAnalysisResponse(
    raw: unknown
): FinancialsAnalysisResponse {
    const parsed = parseLlmPayload(raw);
    // Cast needed: asObject returns Record<string, unknown> | null. Runtime-safe
    // because RawFinancialsAnalysisResponse's fields are all optional `unknown`,
    // so any object (or the `{}` fallback) structurally satisfies it.
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
