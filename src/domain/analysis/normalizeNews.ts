import type {
    NewsAnalysisResponse,
    NewsCardAnalysis,
    NewsCategory,
    NewsSentiment,
} from '@/domain/types';
import { extractJsonFromLlmResponse } from './promptFormat';

/** Valid values for the {@link NewsSentiment} enum. */
const VALID_NEWS_SENTIMENTS: readonly NewsSentiment[] = [
    'bullish',
    'neutral',
    'bearish',
];

/** Valid values for the {@link NewsCategory} enum. */
const VALID_NEWS_CATEGORIES: readonly NewsCategory[] = [
    'earnings',
    'm_and_a',
    'guidance',
    'regulation',
    'macro',
    'product',
    'other',
];

/**
 * Validate and coerce a raw value to a {@link NewsSentiment}.
 *
 * @param value - Candidate value from parsed JSON.
 * @param field - Field name used in the thrown error message.
 * @throws {Error} When `value` is not a valid {@link NewsSentiment}.
 */
function requireNewsSentiment(value: unknown, field: string): NewsSentiment {
    if (!VALID_NEWS_SENTIMENTS.includes(value as NewsSentiment)) {
        throw new Error(
            `Invalid NewsSentiment for field "${field}": ${String(value)}. ` +
                `Expected one of: ${VALID_NEWS_SENTIMENTS.join(', ')}`
        );
    }
    // .includes() guard above guarantees value is a valid NewsSentiment at runtime
    return value as NewsSentiment;
}

/**
 * Validate and coerce a raw value to a {@link NewsCategory}.
 *
 * @param value - Candidate value from parsed JSON.
 * @param field - Field name used in the thrown error message.
 * @throws {Error} When `value` is not a valid {@link NewsCategory}.
 */
function requireNewsCategory(value: unknown, field: string): NewsCategory {
    if (!VALID_NEWS_CATEGORIES.includes(value as NewsCategory)) {
        throw new Error(
            `Invalid NewsCategory for field "${field}": ${String(value)}. ` +
                `Expected one of: ${VALID_NEWS_CATEGORIES.join(', ')}`
        );
    }
    // .includes() guard above guarantees value is a valid NewsCategory at runtime
    return value as NewsCategory;
}

/**
 * Normalize a raw LLM response string into a typed {@link NewsCardAnalysis}.
 *
 * Strips optional markdown code fences, parses JSON, and validates all required
 * fields and enum values. `bodyKo` may be `null` (the LLM may omit a body for
 * brief news items). Throws a descriptive error on missing required fields or
 * invalid enum values.
 *
 * @param raw - Raw string from the LLM worker response.
 * @returns A fully-typed {@link NewsCardAnalysis}.
 * @throws {SyntaxError} When the string is not valid JSON after fence removal.
 * @throws {Error} When required fields are missing or enum values are invalid.
 */
export function normalizeNewsCardAnalysis(raw: string): NewsCardAnalysis {
    const parsed = extractJsonFromLlmResponse(raw);

    if (
        parsed === null ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
    ) {
        throw new Error('NewsCardAnalysis: payload must be a JSON object');
    }
    const o = parsed as Record<string, unknown>;

    if (typeof o.titleKo !== 'string') {
        throw new Error('NewsCardAnalysis: missing required field "titleKo"');
    }
    if (typeof o.summaryKo !== 'string') {
        throw new Error('NewsCardAnalysis: missing required field "summaryKo"');
    }

    const sentiment = requireNewsSentiment(o.sentiment, 'sentiment');
    const category = requireNewsCategory(o.category, 'category');

    const bodyKo =
        o.bodyKo === null || o.bodyKo === undefined
            ? null
            : typeof o.bodyKo === 'string'
              ? o.bodyKo
              : null;

    return {
        titleKo: o.titleKo,
        bodyKo,
        summaryKo: o.summaryKo,
        sentiment,
        category,
    };
}

/**
 * Normalize a raw LLM response string into a typed {@link NewsAnalysisResponse}.
 *
 * Strips optional markdown code fences, parses JSON, and validates all required
 * fields and enum values. Throws a descriptive error on missing required fields
 * or invalid enum values so the caller can surface a meaningful failure.
 *
 * @param raw - Raw string from the LLM worker response.
 * @returns A fully-typed {@link NewsAnalysisResponse}.
 * @throws {SyntaxError} When the string is not valid JSON after fence removal.
 * @throws {Error} When required fields are missing or enum values are invalid.
 */
export function normalizeNewsAnalysisResponse(
    raw: string
): NewsAnalysisResponse {
    const parsed = extractJsonFromLlmResponse(raw);

    if (
        parsed === null ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
    ) {
        throw new Error('NewsAnalysisResponse: payload must be a JSON object');
    }
    const o = parsed as Record<string, unknown>;

    if (typeof o.currentDriverKo !== 'string') {
        throw new Error(
            'NewsAnalysisResponse: missing required field "currentDriverKo"'
        );
    }
    if (!Array.isArray(o.keyEventsKo)) {
        throw new Error(
            'NewsAnalysisResponse: missing required field "keyEventsKo"'
        );
    }
    if (!Array.isArray(o.upcomingEventsKo)) {
        throw new Error(
            'NewsAnalysisResponse: missing required field "upcomingEventsKo"'
        );
    }

    const overallSentiment = requireNewsSentiment(
        o.overallSentiment,
        'overallSentiment'
    );

    return {
        currentDriverKo: o.currentDriverKo,
        keyEventsKo: (o.keyEventsKo as unknown[]).map(String),
        upcomingEventsKo: (o.upcomingEventsKo as unknown[]).map(String),
        overallSentiment,
    };
}
