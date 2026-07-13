import { describe, expect, it } from 'vitest';
import { createSkillSamplingPlan } from '@/infrastructure/skills/sampling';
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

/**
 * Six skills of the same type-group so a free-tier cap of three actually
 * trims the catalog (rather than being a no-op on an already-small group).
 */
const OVER_CAP_CATALOG: Skill[] = Array.from({ length: 6 }, (_, index) =>
    makeSkill(`pattern-${index}`, 'pattern')
);

const SEED_PARTS: readonly string[] = ['technical', 'AAPL', '1Day'];

describe('createSkillSamplingPlan 함수는', () => {
    describe('free 티어', () => {
        it('그룹당 3개로 캡핑하고 fingerprint를 sampled skills로부터 계산한다', () => {
            const plan = createSkillSamplingPlan(
                OVER_CAP_CATALOG,
                'free',
                SEED_PARTS
            );

            expect(plan.skills.length).toBeLessThanOrEqual(3);
            expect(plan.skills.length).toBeGreaterThan(0);
            expect(plan.fingerprint).toBe(hashSkillCatalog(plan.skills));
            // Cap actually trimmed the catalog (regression guard against a
            // no-op sampler): fewer skills than the original catalog.
            expect(plan.skills.length).toBeLessThan(OVER_CAP_CATALOG.length);
        });
    });

    describe.each(['member', 'pro'] as const)('%s 티어', tier => {
        it('전체 카탈로그를 그대로 반환하고 fingerprint는 전체 카탈로그 기준이다', () => {
            const plan = createSkillSamplingPlan(
                OVER_CAP_CATALOG,
                tier,
                SEED_PARTS
            );

            expect(plan.skills).toEqual(OVER_CAP_CATALOG);
            expect(plan.fingerprint).toBe(hashSkillCatalog(OVER_CAP_CATALOG));
        });
    });

    describe('결정성', () => {
        it('동일한 (skills, tier, seedParts)는 동일한 skills + fingerprint를 반환한다', () => {
            const first = createSkillSamplingPlan(
                OVER_CAP_CATALOG,
                'free',
                SEED_PARTS
            );
            const second = createSkillSamplingPlan(
                OVER_CAP_CATALOG,
                'free',
                SEED_PARTS
            );

            expect(second.skills).toEqual(first.skills);
            expect(second.fingerprint).toBe(first.fingerprint);
        });
    });

    describe('seed 민감도', () => {
        it('free 티어에서 카탈로그가 cap을 초과할 때 seedParts가 다르면 sampled set/fingerprint가 달라진다', () => {
            const candidateSeeds: readonly (readonly string[])[] = [
                ['technical', 'AAPL', '1Day'],
                ['technical', 'MSFT', '1Day'],
                ['technical', 'AAPL', '1Hour'],
                ['overall', 'AAPL', '1Day'],
            ];

            const plans = candidateSeeds.map(seedParts =>
                createSkillSamplingPlan(OVER_CAP_CATALOG, 'free', seedParts)
            );
            const fingerprints = new Set(plans.map(plan => plan.fingerprint));

            expect(fingerprints.size).toBeGreaterThan(1);
        });

        it("seedParts 배열이 콜라이드할 수 있는 문자열(['a','b'] vs ['ab'] vs ['a b'])을 구분한다", () => {
            const seedAB = createSkillSamplingPlan(OVER_CAP_CATALOG, 'free', [
                'a',
                'b',
            ]);
            const seedConcatenated = createSkillSamplingPlan(
                OVER_CAP_CATALOG,
                'free',
                ['ab']
            );
            const seedSpaced = createSkillSamplingPlan(
                OVER_CAP_CATALOG,
                'free',
                ['a b']
            );

            // Without JSON.stringify + a NUL separator in `samplingSeed`, joining
            // seedParts naively would make ['a', 'b'] and ['ab'] indistinguishable
            // (both collapse to the string "ab"). This guards against a regression
            // to that naive join.
            expect(seedAB.fingerprint).not.toBe(seedConcatenated.fingerprint);
            expect(seedAB.fingerprint).not.toBe(seedSpaced.fingerprint);
            expect(seedAB.skills).not.toEqual(seedConcatenated.skills);
        });
    });
});
