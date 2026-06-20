import type {
    NewsAnalysisResponse,
    NewsCardAnalysis,
    NewsCategory,
    NewsImpact,
    NewsSentiment,
    RawNewsAnalysisResponse,
    RawNewsCardAnalysis,
} from '@/domain/types';
import { asArray, asEnum, asObject, asString } from './normalizePrimitives';
import { parseLlmPayload } from './promptFormat';

/** Valid values for the {@link NewsSentiment} enum. */
const VALID_NEWS_SENTIMENTS: readonly NewsSentiment[] = [
    'bullish',
    'neutral',
    'bearish',
];

/** Valid values for the {@link NewsImpact} enum. */
const VALID_NEWS_IMPACTS: readonly NewsImpact[] = [
    'high',
    'medium',
    'low',
    'negligible',
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

function normalizeStringArray(raw: unknown): string[] {
    return asArray(raw)
        .map(item => asString(item))
        .filter(item => item.length > 0);
}

function normalizeNewsSentiment(value: unknown): NewsSentiment {
    return asEnum(value, VALID_NEWS_SENTIMENTS, 'neutral');
}

function normalizeNewsCategory(value: unknown): NewsCategory {
    return asEnum(value, VALID_NEWS_CATEGORIES, 'other');
}

function normalizeNewsImpact(value: unknown): NewsImpact {
    return asEnum(value, VALID_NEWS_IMPACTS, 'negligible');
}

/**
 * @internal Normalizes a single news-card LLM response.
 *
 * Normalize a raw LLM response string into a typed {@link NewsCardAnalysis}.
 *
 * Strips optional markdown code fences, parses JSON, and defensively normalizes
 * every field. Missing strings become `''`, missing body becomes `null`, and
 * invalid enum values fall back to conservative defaults.
 *
 * @param raw - Raw string/object from the LLM worker or cache.
 * @returns A fully-typed {@link NewsCardAnalysis}.
 * @throws {SyntaxError} When the string is not valid JSON after fence removal.
 */
export function normalizeNewsCardAnalysis(raw: unknown): NewsCardAnalysis {
    const parsed = parseLlmPayload(raw);
    const o = (asObject(parsed) ?? {}) as RawNewsCardAnalysis;

    const bodyKo =
        o.bodyKo === null || o.bodyKo === undefined
            ? null
            : typeof o.bodyKo === 'string'
              ? o.bodyKo
              : null;

    return {
        titleKo: asString(o.titleKo),
        bodyKo,
        summaryKo: asString(o.summaryKo),
        sentiment: normalizeNewsSentiment(o.sentiment),
        category: normalizeNewsCategory(o.category),
        priceImpact: normalizeNewsImpact(o.priceImpact),
    };
}

/**
 * @internal Normalizes the news-analysis LLM response.
 *
 * Normalize a raw LLM response string into a typed {@link NewsAnalysisResponse}.
 *
 * Strips optional markdown code fences, parses JSON, and defensively normalizes
 * every field. Missing strings become `''`, missing arrays become `[]`, and
 * invalid sentiment values fall back to `"neutral"`.
 *
 * @param raw - Raw string/object from the LLM worker or cache.
 * @returns A fully-typed {@link NewsAnalysisResponse}.
 * @throws {SyntaxError} When the string is not valid JSON after fence removal.
 */
export function normalizeNewsAnalysisResponse(
    raw: unknown
): NewsAnalysisResponse {
    const parsed = parseLlmPayload(raw);
    const o = (asObject(parsed) ?? {}) as RawNewsAnalysisResponse;

    return {
        currentDriverKo: asString(o.currentDriverKo),
        keyEventsKo: normalizeStringArray(o.keyEventsKo),
        upcomingEventsKo: normalizeStringArray(o.upcomingEventsKo),
        overallSentiment: normalizeNewsSentiment(o.overallSentiment),
    };
}
