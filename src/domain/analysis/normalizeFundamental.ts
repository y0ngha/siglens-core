import type {
    FundamentalAnalysisResponse,
    FundamentalCategory,
    FundamentalCategoryAssessment,
    FundamentalSentiment,
    RawFundamentalAnalysisResponse,
    RawFundamentalCategoryAssessment,
} from '@/domain/types';
import {
    asArray,
    asEnum,
    asObject,
    asString,
    compact,
} from './normalizePrimitives';
import { extractJsonFromLlmResponse } from './promptFormat';

/** Valid values for the {@link FundamentalSentiment} enum. */
const VALID_FUNDAMENTAL_SENTIMENTS: readonly FundamentalSentiment[] = [
    'bullish',
    'neutral',
    'bearish',
];

/** Valid values for the {@link FundamentalCategory} enum. */
const VALID_FUNDAMENTAL_CATEGORIES: readonly FundamentalCategory[] = [
    'valuation',
    'profitability',
    'growth',
    'health',
    'futureDirection',
];

function parseLlmPayload(raw: unknown): unknown {
    return typeof raw === 'string' ? extractJsonFromLlmResponse(raw) : raw;
}

function normalizeStringArray(raw: unknown): string[] {
    return asArray(raw)
        .map(item => asString(item))
        .filter(item => item.length > 0);
}

function normalizeFundamentalSentiment(value: unknown): FundamentalSentiment {
    return asEnum(value, VALID_FUNDAMENTAL_SENTIMENTS, 'neutral');
}

function normalizeFundamentalCategory(value: unknown): FundamentalCategory {
    return asEnum(value, VALID_FUNDAMENTAL_CATEGORIES, 'valuation');
}

/**
 * Normalize a single category assessment entry from the raw payload.
 *
 * @param item - Raw item from the `categoryAssessments` array.
 */
function normalizeCategoryAssessment(
    item: unknown
): FundamentalCategoryAssessment | null {
    const o = asObject(item) as RawFundamentalCategoryAssessment | null;
    if (!o) return null;

    return {
        category: normalizeFundamentalCategory(o.category),
        sentiment: normalizeFundamentalSentiment(o.sentiment),
        rationaleKo: asString(o.rationaleKo),
    };
}

/**
 * Normalize a raw LLM response string into a typed {@link FundamentalAnalysisResponse}.
 *
 * Strips optional markdown code fences (` ```json ` / ` ``` `), parses JSON, and
 * defensively normalizes every field. Missing strings become `''`, missing
 * arrays become `[]`, malformed child entries are dropped, and invalid enum
 * values fall back to conservative defaults.
 *
 * @param raw - Raw string/object from the LLM worker or cache.
 * @returns A fully-typed {@link FundamentalAnalysisResponse}.
 * @throws {SyntaxError} When the string is not valid JSON after fence removal.
 *
 * @internal Normalizes the fundamental LLM response.
 */
export function normalizeFundamentalAnalysisResponse(
    raw: unknown
): FundamentalAnalysisResponse {
    const parsed = parseLlmPayload(raw);
    const o = (asObject(parsed) ?? {}) as RawFundamentalAnalysisResponse;

    return {
        overallConclusionKo: asString(o.overallConclusionKo),
        categoryAssessments: compact(
            asArray(o.categoryAssessments).map(normalizeCategoryAssessment)
        ),
        riskFactorsKo: normalizeStringArray(o.riskFactorsKo),
        overallSentiment: normalizeFundamentalSentiment(o.overallSentiment),
    };
}
