import {
    asArray,
    asEnum,
    asObject,
    asString,
} from '@/domain/analysis/normalizePrimitives';
import type { MacroBriefingResponse, MacroRegime } from './types';

const REGIMES: readonly MacroRegime[] = [
    'expansion',
    'slowdown',
    'contraction',
    'recovery',
    'neutral',
];

/**
 * @internal 거시 브리핑 LLM 응답을 검증된 {@link MacroBriefingResponse}로 변환한다.
 *
 * `as*` 헬퍼로 방어적 coerce — summary는 비문자열이면 ''(호출부가 error 처리),
 * highlights는 빈 문자열 제거, regime은 유효 enum이 아니면 'neutral'. raw가
 * null/undefined/오형식이어도 항상 well-formed 객체를 반환한다.
 *
 * @see buildMacroBriefingPrompt
 */
export function normalizeMacroBriefing(raw: unknown): MacroBriefingResponse {
    const o = asObject(raw);
    if (o === null) {
        return { summary: '', highlights: [], regime: 'neutral' };
    }
    return {
        summary: asString(o.summary),
        highlights: asArray(o.highlights)
            .map(h => asString(h))
            .filter((h): h is string => h.length > 0),
        regime: asEnum<MacroRegime>(o.regime, REGIMES, 'neutral'),
    };
}
