import type {
    CongressSentiment,
    CongressTrendResponse,
    RawCongressTrendResponse,
} from '@/domain/types';
import { asArray, asEnum, asObject, asString } from './normalizePrimitives';
import { extractJsonFromLlmResponse } from './promptFormat';

const VALID_SENTIMENTS: readonly CongressSentiment[] = [
    'bullish',
    'neutral',
    'bearish',
];

function parseLlmPayload(raw: unknown): unknown {
    return typeof raw === 'string' ? extractJsonFromLlmResponse(raw) : raw;
}

function normalizeStringArray(raw: unknown): string[] {
    return asArray(raw)
        .map(item => asString(item))
        .filter(item => item.length > 0);
}

/**
 * Normalize a raw LLM response into a typed {@link CongressTrendResponse}.
 *
 * Strips optional markdown code fences (` ```json ` / ` ``` `), parses JSON,
 * and defensively normalizes every field. Missing strings become `''`, missing
 * arrays become `[]`, non-string array items are dropped, and invalid enum
 * values fall back to `'neutral'`.
 *
 * @param raw - Raw string/object from the LLM worker or cache.
 * @returns A fully-typed {@link CongressTrendResponse}.
 * @throws {SyntaxError} When the string is not valid JSON after fence removal.
 * @example
 * ```ts
 * normalizeCongressTrendResponse(
 *   '```json\n{"summaryKo":"순매수 우세","overallSentiment":"bullish"}\n```'
 * );
 * // → { summaryKo: '순매수 우세', notableMembersKo: [], riskNoteKo: '', overallSentiment: 'bullish' }
 * ```
 */
export function normalizeCongressTrendResponse(
    raw: unknown
): CongressTrendResponse {
    const parsed = parseLlmPayload(raw);
    // Cast needed: asObject returns Record<string, unknown> | null. Runtime-safe
    // because RawCongressTrendResponse's fields are all optional `unknown`, so
    // any object (or the `{}` fallback) structurally satisfies it.
    const o = (asObject(parsed) ?? {}) as RawCongressTrendResponse;
    return {
        summaryKo: asString(o.summaryKo),
        notableMembersKo: normalizeStringArray(o.notableMembersKo),
        riskNoteKo: asString(o.riskNoteKo),
        overallSentiment: asEnum(
            o.overallSentiment,
            VALID_SENTIMENTS,
            'neutral'
        ),
    };
}
