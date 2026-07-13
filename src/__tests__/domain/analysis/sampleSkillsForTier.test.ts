import { describe, expect, it } from 'vitest';
import { sampleSkillsForTier } from '@/domain/analysis/sampleSkillsForTier';
import type { Skill, SkillCategory, SkillType } from '@/domain/types';

const SKILL_TYPES: readonly SkillType[] = [
    'pattern',
    'indicator_guide',
    'strategy',
    'candlestick',
    'support_resistance',
];

const SKILL_USAGE_ROLES = [
    'signal',
    'confirmation',
    'regime',
    'measurement',
    'risk',
] as const;

type GroupKey = SkillType | 'regular';

const makeSkill = (
    name: string,
    type?: SkillType,
    category?: SkillCategory
): Skill => ({
    name,
    description: `${name} description`,
    type,
    category,
    indicators: [],
    confidenceWeight: 1,
    content: `${name} content`,
});

const makeGroup = (group: GroupKey): Skill[] =>
    Array.from({ length: 5 }, (_, index) =>
        group === 'regular'
            ? makeSkill(
                  `${group}-${index}`,
                  undefined,
                  index % 2 === 0 ? 'fundamental' : 'news'
              )
            : makeSkill(`${group}-${index}`, group)
    );

const catalog = [...SKILL_TYPES, 'regular' as const].flatMap(makeGroup);

const namesOf = (skills: readonly Skill[]): string[] =>
    skills.map(skill => skill.name);

const stableSerialize = (value: unknown): string => {
    if (Array.isArray(value)) {
        return `[${value.map(stableSerialize).join(',')}]`;
    }

    if (value !== null && typeof value === 'object') {
        const record = value as Record<string, unknown>;

        return `{${Object.keys(record)
            .toSorted((left, right) => left.localeCompare(right, 'en'))
            .map(
                key => `${JSON.stringify(key)}:${stableSerialize(record[key])}`
            )
            .join(',')}}`;
    }

    const serialized = JSON.stringify(value);
    return `${typeof value}:${serialized ?? String(value)}`;
};

const identitiesOf = (skills: readonly Skill[]): string[] =>
    skills.map(stableSerialize);

const groupOf = (skill: Skill): GroupKey => skill.type ?? 'regular';

describe('sampleSkillsForTier', () => {
    describe('free tier', () => {
        it('caps every SkillType and the regular group at three skills', () => {
            const sampled = sampleSkillsForTier(catalog, 'free', 'seed-a');

            expect(sampled).toHaveLength((SKILL_TYPES.length + 1) * 3);
            expect(
                [...SKILL_TYPES, 'regular' as const].every(
                    group =>
                        sampled.filter(skill => groupOf(skill) === group)
                            .length === 3
                )
            ).toBe(true);
        });

        it('returns the same named selection for the same seed and catalog', () => {
            const first = sampleSkillsForTier(catalog, 'free', 'seed-a');
            const second = sampleSkillsForTier(catalog, 'free', 'seed-a');

            expect(namesOf(first)).toEqual(namesOf(second));
        });

        it('returns the same named selection when the input is reversed', () => {
            const sampled = sampleSkillsForTier(catalog, 'free', 'seed-a');
            const reversed = sampleSkillsForTier(
                catalog.toReversed(),
                'free',
                'seed-a'
            );

            expect(namesOf(reversed)).toEqual(namesOf(sampled));
        });

        it('keeps same-named metadata variants deterministic when input is reversed', () => {
            const metadataVariants = Array.from(
                { length: 5 },
                (_, index): Skill => ({
                    ...makeSkill('metadata-variant', 'indicator_guide'),
                    display: {
                        chart: {
                            show: index % 2 === 0,
                            type: 'line',
                            color: `#00000${index}`,
                            label: `Variant ${index}`,
                        },
                    },
                    gating: {
                        tier: 'gated',
                        signalKind: 'event',
                        triggers: [`metadata-trigger-${index}`],
                    },
                    tokenCost: 100 + index,
                    smcFullGuide: index % 2 === 0,
                    usageRoles: [SKILL_USAGE_ROLES[index]],
                })
            );
            const sampled = sampleSkillsForTier(
                metadataVariants,
                'free',
                'seed-a'
            );
            const reversed = sampleSkillsForTier(
                metadataVariants.toReversed(),
                'free',
                'seed-a'
            );

            expect(sampled).toHaveLength(3);
            expect(identitiesOf(reversed)).toEqual(identitiesOf(sampled));
        });

        it('uses the seed and ignores nested object property order', () => {
            const variants = Array.from(
                { length: 8 },
                (_, index): Skill => ({
                    ...makeSkill(`seed-variant-${index}`, 'pattern'),
                    gating: {
                        tier: 'gated',
                        signalKind: 'event',
                        triggers: [`seed-trigger-${index}`],
                    },
                })
            );
            const reordered = variants.map(skill => ({
                ...skill,
                gating: {
                    triggers: [
                        ...(skill.gating?.tier === 'gated' &&
                        skill.gating.signalKind === 'event'
                            ? skill.gating.triggers
                            : []),
                    ],
                    signalKind: 'event' as const,
                    tier: 'gated' as const,
                },
            }));
            const selections = ['seed-a', 'seed-b', 'seed-c'].map(seed =>
                identitiesOf(sampleSkillsForTier(variants, 'free', seed)).join(
                    '\n'
                )
            );

            expect(new Set(selections).size).toBeGreaterThan(1);
            expect(sampleSkillsForTier(reordered, 'free', 'seed-a')).toEqual(
                sampleSkillsForTier(variants, 'free', 'seed-a')
            );
        });
    });

    describe('member and pro tiers', () => {
        it.each(['member', 'pro'] as const)(
            'keeps the complete original catalog for the %s tier',
            tier => {
                const result = sampleSkillsForTier(catalog, tier, 'seed-a');

                expect(result).toEqual(catalog);
                expect(result).not.toBe(catalog);
            }
        );
    });

    describe('catalog edge cases', () => {
        it('does not mutate the original catalog or its order', () => {
            const original = [...catalog];

            sampleSkillsForTier(catalog, 'free', 'seed-a');

            expect(catalog).toEqual(original);
            expect(namesOf(catalog)).toEqual(namesOf(original));
        });

        it('handles empty and small groups', () => {
            expect(sampleSkillsForTier([], 'free', 'seed-a')).toEqual([]);

            const smallCatalog = [
                makeSkill('one-pattern', 'pattern'),
                makeSkill('one-fundamental', undefined, 'fundamental'),
            ];
            const sampled = sampleSkillsForTier(smallCatalog, 'free', 'seed-a');

            expect(namesOf(sampled)).toEqual(
                expect.arrayContaining(['one-pattern', 'one-fundamental'])
            );
            expect(sampled).toHaveLength(smallCatalog.length);
        });
    });
});
