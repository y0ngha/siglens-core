import type {
    OptionsAnalysisResponse,
    OptionsPerExpirationCommentary,
    OptionsSignal,
    OptionsTone,
    OptionsSignalKind,
} from '@/domain/types';
import type { RawOptionsAnalysisResponse } from '@/domain/options/types';
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

function normalizePerExpirationItem(
    item: unknown
): OptionsPerExpirationCommentary | null {
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

function normalizeSignalItem(item: unknown): OptionsSignal | null {
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
 * @internal Normalizes the options-analysis LLM response.
 *
 * Normalize a raw LLM options analysis response into a fully-typed
 * OptionsAnalysisResponse. Never throws — every field has a fallback so
 * downstream rendering is safe even when the model returns garbage.
 *
 * Domain purity: `now` is taken as a required argument so this function
 * stays a pure transformation.
 *
 * `analyzedAt` is always set to `now.toISOString()` — any value supplied
 * in `raw` is intentionally ignored. The server is the authoritative
 * source for analysis time, and the LLM has been observed echoing the
 * prompt example string (e.g. `"2023-10-27T10:30:00"`) verbatim,
 * surfacing stale past dates in the UI. Cache-hit paths also flow
 * through this function (see `submitOptionsAnalysis`), so the displayed
 * time effectively means "most recently observed"; with the 1-day cache
 * TTL the drift from the original analysis time is bounded to 24 hours.
 *
 * @param raw - Worker JSON / cached payload / arbitrary unknown.
 * @param now - Reference clock; always used as `analyzedAt`.
 * @returns Fully-typed normalized response with every field populated.
 */
export function normalizeOptionsAnalysisResponse(
    raw: unknown,
    now: Date
): OptionsAnalysisResponse {
    const parsed = parseLlmPayload(raw);
    // `asObject` filters to plain objects (returns null for arrays/primitives).
    // `?? {}` ensures non-null so subsequent property access never throws.
    // The cast to `RawOptionsAnalysisResponse` is safe because every Raw
    // field is `unknown?` — any object shape is structurally assignable.
    const o = (asObject(parsed) ?? {}) as RawOptionsAnalysisResponse;

    return {
        summary: asString(o.summary, FALLBACK_SUMMARY),
        perExpiration: compact(
            asArray(o.perExpiration).map(normalizePerExpirationItem)
        ),
        signals: compact(asArray(o.signals).map(normalizeSignalItem)),
        analyzedAt: now.toISOString(),
    };
}
