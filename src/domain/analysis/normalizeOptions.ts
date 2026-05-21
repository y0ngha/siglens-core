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
 * Normalize a raw LLM options analysis response into a fully-typed
 * OptionsAnalysisResponse. Never throws — every field has a fallback so
 * downstream rendering is safe even when the model returns garbage.
 *
 * Domain purity: `now` is taken as a required argument so this function
 * stays a pure transformation.
 *
 * `analyzedAt`은 LLM이 응답에 넣은 값이 아닌 항상 `now.toISOString()`을 사용한다.
 * 분석을 수행한 권위 있는 시각은 서버 쪽이며, LLM은 프롬프트 예시 문자열
 * (예: "2023-10-27T10:30:00")을 그대로 반환해 잘못된 과거 날짜를 노출한
 * 사례가 있어 raw 입력의 `analyzedAt` 필드를 신뢰하지 않는다. 캐시 히트
 * 경로(`submitOptionsAnalysis`)도 이 함수를 통과하므로 캐시 결과의 표시
 * 시각은 "최근 본 시각" 의미가 된다 — TTL이 1일이라 분석 시점과의
 * 어긋남은 24시간 이내로 제한된다.
 *
 * @param raw - Worker JSON / cached payload / arbitrary unknown.
 * @param now - Reference clock; `analyzedAt`에 항상 사용된다.
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
