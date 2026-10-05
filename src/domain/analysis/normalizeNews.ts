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

/**
 * Sentence-initial phrases that describe the INPUT instead of the market
 * (`제공된 25건의 뉴스는…`, `The provided articles…`). The prompts forbid
 * them, but the model still leaks them now and then, so the normalizer strips
 * the lead as a deterministic backstop.
 *
 * What is trimmed, precisely — all three conditions must hold:
 * 1. the text STARTS with the qualifier (Korean `제공된`/`주어진`/`입력된`
 *    followed by whitespace; English `The provided `), so the same words
 *    mid-sentence stay untouched;
 * 2. an optional count follows (Korean `N건의 `; English `N `);
 * 3. an INPUT noun follows (Korean 뉴스·기사·자료·정보·본문·데이터; English
 *    articles·news·headlines·data·information). In Korean, up to two short
 *    descriptor words (no sentence punctuation, each at most 10 characters)
 *    may sit between the count and the noun — `제공된 암호화폐 카테고리 뉴스`,
 *    `제공된 25건의 암호화폐 뉴스`. A descriptor ending in a case or topic
 *    particle (는·은·이·가·을·를·에·에서·의·도·로·와·과) is a real subject, not a
 *    descriptor, so `제공된 가이던스는 시장 뉴스에…` (company guidance) and
 *    `주어진 환경에서…` (a given environment) stay untouched. English takes no
 *    descriptor words.
 *
 * Only the qualifier (+ count) is removed; the descriptor words, the noun and
 * the rest of the sentence are kept.
 */
/** The noun must end the word (optionally plural `들`) or take a particle: `정보기술`/`데이터센터` are not input nouns. */
const KO_INPUT_NOUN = '(?:뉴스|기사|자료|정보|본문|데이터)';
const KO_NOUN_BOUNDARY = '(?:들)?(?:[은는이가을를의에와과도]|\\s|$)';
const KO_DESCRIPTOR_PARTICLES = '는은이가을를에서의도로와과';
const KO_DESCRIPTOR_WORD = `[^\\s.!?,。]{0,9}[^\\s.!?,。${KO_DESCRIPTOR_PARTICLES}]\\s+`;
const KO_INPUT_META_LEAD = new RegExp(
    `^(?:제공된|주어진|입력된)\\s+(?:\\d+\\s*건의\\s+)?(?=(?:${KO_DESCRIPTOR_WORD}){0,2}${KO_INPUT_NOUN}${KO_NOUN_BOUNDARY})`
);
const EN_INPUT_META_LEAD =
    /^The provided (?:\d+ )?(?=(?:articles|news|headlines|data|information)\b)/;

/**
 * @internal Remove a leading input-describing phrase from one generated
 * sentence. For English the next character is capitalised so the sentence
 * still starts like one. Returns the text unchanged when it has no such lead,
 * or when stripping it would leave nothing.
 */
export function stripInputMetaLead(text: string): string {
    const koStripped = text.replace(KO_INPUT_META_LEAD, '');
    if (koStripped !== text) return koStripped.length > 0 ? koStripped : text;

    const enStripped = text.replace(EN_INPUT_META_LEAD, '');
    if (enStripped === text || enStripped.length === 0) return text;
    return `${enStripped.charAt(0).toUpperCase()}${enStripped.slice(1)}`;
}

function normalizeStringArray(raw: unknown): string[] {
    return asArray(raw)
        .map(item => asString(item))
        .filter(item => item.length > 0);
}

function normalizeNarrativeArray(raw: unknown): string[] {
    return normalizeStringArray(raw).map(stripInputMetaLead);
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
        summaryKo: stripInputMetaLead(asString(o.summaryKo)),
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
        currentDriverKo: stripInputMetaLead(asString(o.currentDriverKo)),
        keyEventsKo: normalizeNarrativeArray(o.keyEventsKo),
        upcomingEventsKo: normalizeStringArray(o.upcomingEventsKo),
        overallSentiment: normalizeNewsSentiment(o.overallSentiment),
    };
}
