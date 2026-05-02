import type {
    FundamentalAnalysisResponse,
    FundamentalCategory,
    FundamentalCategoryAssessment,
    FundamentalSentiment,
} from '@/domain/types';
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

/**
 * Validate and coerce a raw value to a {@link FundamentalSentiment}.
 *
 * @param value - Candidate value from parsed JSON.
 * @param field - Field name used in the thrown error message.
 * @throws {Error} When `value` is not a valid {@link FundamentalSentiment}.
 */
function requireFundamentalSentiment(
    value: unknown,
    field: string
): FundamentalSentiment {
    if (!VALID_FUNDAMENTAL_SENTIMENTS.includes(value as FundamentalSentiment)) {
        throw new Error(
            `Invalid FundamentalSentiment for field "${field}": ${String(value)}. ` +
                `Expected one of: ${VALID_FUNDAMENTAL_SENTIMENTS.join(', ')}`
        );
    }
    return value as FundamentalSentiment;
}

/**
 * Validate and coerce a raw value to a {@link FundamentalCategory}.
 *
 * @param value - Candidate value from parsed JSON.
 * @param field - Field name used in the thrown error message.
 * @throws {Error} When `value` is not a valid {@link FundamentalCategory}.
 */
function requireFundamentalCategory(
    value: unknown,
    field: string
): FundamentalCategory {
    if (!VALID_FUNDAMENTAL_CATEGORIES.includes(value as FundamentalCategory)) {
        throw new Error(
            `Invalid FundamentalCategory for field "${field}": ${String(value)}. ` +
                `Expected one of: ${VALID_FUNDAMENTAL_CATEGORIES.join(', ')}`
        );
    }
    return value as FundamentalCategory;
}

/**
 * Validate and parse a single category assessment entry from the raw payload.
 *
 * @param item - Raw item from the `categoryAssessments` array.
 * @param index - Array index used in error messages.
 * @throws {Error} When any required sub-field is missing or invalid.
 */
function parseCategoryAssessment(
    item: unknown,
    index: number
): FundamentalCategoryAssessment {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error(
            `categoryAssessments[${index}] must be an object, got: ${typeof item}`
        );
    }
    const o = item as Record<string, unknown>;

    const category = requireFundamentalCategory(
        o.category,
        `categoryAssessments[${index}].category`
    );
    const sentiment = requireFundamentalSentiment(
        o.sentiment,
        `categoryAssessments[${index}].sentiment`
    );

    if (typeof o.rationaleKo !== 'string') {
        throw new Error(
            `categoryAssessments[${index}].rationaleKo must be a string`
        );
    }

    return { category, sentiment, rationaleKo: o.rationaleKo };
}

/**
 * Normalize a raw LLM response string into a typed {@link FundamentalAnalysisResponse}.
 *
 * Strips optional markdown code fences (` ```json ` / ` ``` `), parses JSON, and
 * validates all required fields and enum values. Throws a descriptive error when
 * the payload is missing required fields or contains invalid enum values so the
 * caller can surface a meaningful failure to the user.
 *
 * @param raw - Raw string from the LLM worker response.
 * @returns A fully-typed {@link FundamentalAnalysisResponse}.
 * @throws {SyntaxError} When the string is not valid JSON after fence removal.
 * @throws {Error} When required fields are missing or enum values are invalid.
 */
export function normalizeFundamentalAnalysisResponse(
    raw: string
): FundamentalAnalysisResponse {
    const parsed = extractJsonFromLlmResponse(raw);

    if (
        parsed === null ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
    ) {
        throw new Error(
            'FundamentalAnalysisResponse: payload must be a JSON object'
        );
    }
    const o = parsed as Record<string, unknown>;

    if (typeof o.overallConclusionKo !== 'string') {
        throw new Error(
            'FundamentalAnalysisResponse: missing required field "overallConclusionKo"'
        );
    }

    if (!Array.isArray(o.categoryAssessments)) {
        throw new Error(
            'FundamentalAnalysisResponse: missing required field "categoryAssessments"'
        );
    }

    if (!Array.isArray(o.riskFactorsKo)) {
        throw new Error(
            'FundamentalAnalysisResponse: missing required field "riskFactorsKo"'
        );
    }

    const overallSentiment = requireFundamentalSentiment(
        o.overallSentiment,
        'overallSentiment'
    );

    const categoryAssessments = (o.categoryAssessments as unknown[]).map(
        (item, i) => parseCategoryAssessment(item, i)
    );

    return {
        overallConclusionKo: o.overallConclusionKo,
        categoryAssessments,
        riskFactorsKo: (o.riskFactorsKo as unknown[]).map(String),
        overallSentiment,
    };
}
