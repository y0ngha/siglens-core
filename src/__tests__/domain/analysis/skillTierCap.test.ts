import { describe, expect, it } from 'vitest';
import {
    FREE_TIER_GATED_SKILLS_PER_GROUP,
    gatedSkillCapForTier,
    skillGroupKey,
} from '@/domain/analysis/skillTierCap';
import type { Skill } from '@/domain/types';

const skill = (extra: Partial<Skill>): Skill => ({
    name: 'S',
    description: 'd',
    indicators: [],
    confidenceWeight: 1,
    content: 'c',
    ...extra,
});

describe('gatedSkillCapForTier 함수는', () => {
    it('free는 상수만큼 캡을 둔다', () => {
        expect(gatedSkillCapForTier('free')).toBe(
            FREE_TIER_GATED_SKILLS_PER_GROUP
        );
    });

    it.each(['member', 'pro'] as const)('%s는 캡이 없다(null)', tier => {
        expect(gatedSkillCapForTier(tier)).toBeNull();
    });
});

describe('skillGroupKey 함수는', () => {
    it('type이 있으면 type으로 묶는다(category가 있어도)', () => {
        expect(
            skillGroupKey(skill({ type: 'pattern', category: 'news' }))
        ).toBe('pattern');
    });

    it('type이 없으면 category로 묶는다', () => {
        expect(skillGroupKey(skill({ category: 'fundamental' }))).toBe(
            'fundamental'
        );
    });

    it('둘 다 없으면 regular다', () => {
        expect(skillGroupKey(skill({}))).toBe('regular');
    });
});
