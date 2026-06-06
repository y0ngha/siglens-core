import { HIGH_CONFIDENCE_WEIGHT } from '@/domain/indicators/constants';
import type { SkillUsageRole } from '@/domain/types';

/**
 * Low/Medium 경계. 제거된 `MIN_CONFIDENCE_WEIGHT`(하한 *필터*)와 같은 0.5 값이지만
 * 의미가 다르다 — 포함/제외가 아니라 표시 *등급* 경계다. 등급 경계는 이 모듈이
 * 단일 소유한다(스펙 §4.2). Medium/High 경계는 `HIGH_CONFIDENCE_WEIGHT`를 재사용한다.
 */
export const MEDIUM_CONFIDENCE_THRESHOLD = 0.5;

export type ConfidenceLevel = 'low' | 'medium' | 'high';

/**
 * confidenceWeight를 표시 등급으로 변환한다. 포함 여부를 결정하지 않는다 —
 * 모든 등급(Low 포함)이 프롬프트/UI에 표시된다.
 */
export function getConfidenceLevel(weight: number): ConfidenceLevel {
    if (weight >= HIGH_CONFIDENCE_WEIGHT) return 'high';
    if (weight >= MEDIUM_CONFIDENCE_THRESHOLD) return 'medium';
    return 'low';
}

const LEVEL_LABEL: Record<ConfidenceLevel, string> = {
    low: '[Low Confidence]',
    medium: '[Medium Confidence]',
    high: '[High Confidence]',
};

/** 프롬프트용 confidence 라벨. 모든 스킬 유형이 같은 라벨을 쓴다. */
export function confidenceLabel(weight: number): string {
    return LEVEL_LABEL[getConfidenceLevel(weight)];
}

const ROLE_ORDER: readonly SkillUsageRole[] = [
    'signal',
    'confirmation',
    'regime',
    'measurement',
    'risk',
];

const ROLE_LABEL: Record<SkillUsageRole, string> = {
    signal: 'Signal',
    confirmation: 'Confirmation',
    regime: 'Regime',
    measurement: 'Measurement',
    risk: 'Risk',
};

/**
 * indicator_guide의 usage role 라벨을 canonical order로 결정적으로 만든다.
 * 역할이 없으면 빈 문자열을 반환해 라벨을 생략한다(외부/구버전 스킬 fail-safe).
 * 선행 공백을 포함하므로 `### Name [Conf]${roleLabel(...)}` 형태로 직접 이어붙인다.
 */
export function roleLabel(roles: SkillUsageRole[] | undefined): string {
    if (!roles || roles.length === 0) return '';
    const ordered = ROLE_ORDER.filter(r => roles.includes(r));
    if (ordered.length === 0) return '';
    return ` [Roles: ${ordered.map(r => ROLE_LABEL[r]).join(', ')}]`;
}
