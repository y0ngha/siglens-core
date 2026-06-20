import {
    asEnum,
    asObject,
    asString,
} from '@/domain/analysis/normalizePrimitives';
import { extractJsonFromLlmResponse } from '@/domain/analysis/promptFormat';
import type { NewsSentiment } from '@/domain/types';
import type { EconomicEventAnalysis, RawEconomicEventAnalysis } from './types';

/** Valid values for the sentiment tri-state. */
const VALID_SENTIMENTS: readonly NewsSentiment[] = [
    'bullish',
    'neutral',
    'bearish',
];

function parseLlmPayload(raw: unknown): unknown {
    return typeof raw === 'string' ? extractJsonFromLlmResponse(raw) : raw;
}

/**
 * @internal Normalize a raw LLM response into a typed {@link EconomicEventAnalysis}.
 *
 * Strips optional markdown code fences, parses JSON, and defensively normalizes
 * every field. Missing strings become `''` and invalid sentiment values fall back
 * to `'neutral'`. Always returns a well-formed object — never throws on garbage input.
 *
 * @param raw - Raw string/object from the LLM worker or cache.
 * @returns A fully-typed {@link EconomicEventAnalysis}.
 * @throws {SyntaxError} When the string is not valid JSON after fence removal.
 */
export function normalizeEconomicEventAnalysis(
    raw: unknown
): EconomicEventAnalysis {
    const parsed = parseLlmPayload(raw);
    const o = (asObject(parsed) ?? {}) as RawEconomicEventAnalysis;

    return {
        sentiment: asEnum<NewsSentiment>(
            o.sentiment,
            VALID_SENTIMENTS,
            'neutral'
        ),
        summaryKo: asString(o.summaryKo),
        interpretationKo: asString(o.interpretationKo),
    };
}
