import { describe, expect, it } from 'vitest';
import {
    fingerprintSkillCatalog,
    reasoningSeedPart,
    skillCatalogKeyPart,
    tierCapKeyPart,
} from '@/infrastructure/skills/sampling';
import { FREE_TIER_GATED_SKILLS_PER_GROUP } from '@/domain/analysis/skillTierCap';
import { hashSkillCatalog } from '@/infrastructure/hash/analysisInput';
import type { Skill, SkillType } from '@/domain/types';

const makeSkill = (name: string, type?: SkillType): Skill => ({
    name,
    description: `${name} description`,
    type,
    indicators: [],
    confidenceWeight: 1,
    content: `${name} content`,
});

const CATALOG: Skill[] = Array.from({ length: 6 }, (_, index) =>
    makeSkill(`pattern-${index}`, 'pattern')
);

describe('fingerprintSkillCatalog 함수는', () => {
    it('카탈로그 전체의 hashSkillCatalog와 같다 (티어로 줄이지 않는다)', () => {
        expect(fingerprintSkillCatalog(CATALOG)).toBe(
            hashSkillCatalog(CATALOG)
        );
    });

    it('카탈로그가 같으면 호출 순서·횟수와 무관하게 같은 값을 낸다', () => {
        expect(fingerprintSkillCatalog(CATALOG)).toBe(
            fingerprintSkillCatalog(CATALOG.toReversed())
        );
    });

    it('스킬이 하나 빠지면 값이 달라진다', () => {
        expect(fingerprintSkillCatalog(CATALOG.slice(1))).not.toBe(
            fingerprintSkillCatalog(CATALOG)
        );
    });
});

describe('tierCapKeyPart 함수는', () => {
    it('free는 상한이 들어간 free-c<상한>이다', () => {
        expect(tierCapKeyPart('free')).toBe(
            `free-c${FREE_TIER_GATED_SKILLS_PER_GROUP}`
        );
    });

    it.each(['member', 'pro'] as const)(
        '%s는 티어 이름 그대로라 키가 예전과 같다',
        tier => {
            expect(tierCapKeyPart(tier)).toBe(tier);
        }
    );
});

describe('skillCatalogKeyPart 함수는', () => {
    it('`<티어 부분>:<카탈로그 지문>` 형식이다', () => {
        const fingerprint = fingerprintSkillCatalog(CATALOG);

        expect(skillCatalogKeyPart('free', CATALOG)).toBe(
            `free-c${FREE_TIER_GATED_SKILLS_PER_GROUP}:${fingerprint}`
        );
        expect(skillCatalogKeyPart('member', CATALOG)).toBe(
            `member:${fingerprint}`
        );
        expect(skillCatalogKeyPart('pro', CATALOG)).toBe(`pro:${fingerprint}`);
    });
});

describe('reasoningSeedPart 함수는', () => {
    it("reasoning이 true이면 'reasoning-on'을 반환한다", () => {
        expect(reasoningSeedPart(true)).toBe('reasoning-on');
    });

    it("reasoning이 false이면 'reasoning-off'를 반환한다", () => {
        expect(reasoningSeedPart(false)).toBe('reasoning-off');
    });

    it("reasoning이 undefined이면 'reasoning-off'를 반환한다", () => {
        expect(reasoningSeedPart(undefined)).toBe('reasoning-off');
    });
});
