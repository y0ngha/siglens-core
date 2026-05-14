import type {
    OptionsAnalysisResponse,
    OptionsTone,
    OptionsSignalKind,
    RawOptionsAnalysisResponse,
} from '@/domain/types';
import {
    asArray,
    asEnum,
    asIsoDate,
    asObject,
    asString,
    compact,
} from './normalizePrimitives';
import { extractJsonFromLlmResponse } from './promptFormat';

const VALID_TONES: readonly OptionsTone[] = [
    'bullish',
    'bearish',
    'neutral',
    'cautious',
];
const VALID_SIGNAL_KINDS: readonly OptionsSignalKind[] = [
    'bullish',
    'bearish',
    'neutral',
    'volatility',
];

const FALLBACK_SUMMARY =
    '옵션 분석을 가져올 수 없었어요. 잠시 후 다시 시도해주세요.';
const FALLBACK_COMMENTARY = '이 만기에 대한 해석을 가져올 수 없었어요.';

function parseLlmPayload(raw: unknown): unknown {
    if (typeof raw !== 'string') return raw;
    try {
        return extractJsonFromLlmResponse(raw);
    } catch {
        return null;
    }
}

function normalizePerExpirationItem(item: unknown) {
    const o = asObject(item);
    if (!o) return null;
    const expirationDate = asIsoDate(o.expirationDate);
    if (expirationDate === null) return null;
    return {
        expirationDate,
        commentary: asString(o.commentary, FALLBACK_COMMENTARY),
        tone: asEnum<OptionsTone>(o.tone, VALID_TONES, 'neutral'),
    };
}

function normalizeSignalItem(item: unknown) {
    const o = asObject(item);
    if (!o) return null;
    const message = asString(o.message);
    if (message.length === 0) return null;
    return {
        kind: asEnum<OptionsSignalKind>(o.kind, VALID_SIGNAL_KINDS, 'neutral'),
        message,
    };
}

/**
 * Normalize a raw LLM options analysis response into a fully-typed
 * OptionsAnalysisResponse. Never throws — every field has a fallback.
 *
 * Used in two places per the spec (siglens-core SOP):
 *   1. pollOptionsAnalysis — normalize raw worker output before caching
 *   2. submitOptionsAnalysis — re-normalize cached payloads (schema drift guard)
 */
export function normalizeOptionsAnalysisResponse(
    raw: unknown,
    now: Date = new Date()
): OptionsAnalysisResponse {
    const parsed = parseLlmPayload(raw);
    const o = (asObject(parsed) ?? {}) as RawOptionsAnalysisResponse;

    return {
        summary: asString(o.summary, FALLBACK_SUMMARY),
        perExpiration: compact(
            asArray(o.perExpiration).map(normalizePerExpirationItem)
        ),
        signals: compact(asArray(o.signals).map(normalizeSignalItem)),
        analyzedAt: asIsoDate(o.analyzedAt) ?? now.toISOString(),
    };
}
