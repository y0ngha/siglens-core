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

type GroupKey = SkillType | SkillCategory | 'regular';

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

/**
 * `'regular'` is a real fallback group only for skills that carry neither a
 * `type` nor a `category`; every other group here builds skills that carry
 * exactly one `SkillType`. The multi-category (fundamental/news/congress)
 * fallback-by-category scenario is covered separately, below, in
 * `describe('free tier: non-technical categories', ...)`.
 */
const makeGroup = (group: SkillType | 'regular'): Skill[] =>
    Array.from({ length: 5 }, (_, index) =>
        group === 'regular'
            ? makeSkill(`${group}-${index}`)
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

const groupOf = (skill: Skill): GroupKey =>
    skill.type ?? skill.category ?? 'regular';

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
            const variants = Array.from({ length: 8 }, (_, index): Skill => ({
                ...makeSkill(`seed-variant-${index}`, 'pattern'),
                gating: {
                    tier: 'gated',
                    signalKind: 'event',
                    triggers: [`seed-trigger-${index}`],
                },
            }));
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

    describe('free tier: non-technical categories', () => {
        /**
         * Regression fixture for the "mixed catalog" bug: technical skills
         * carry a `type`, but fundamental/news/congress skills carry only a
         * `category`. Before the `groupKeyOf` fallback-to-category fix, ALL
         * type-less skills (regardless of category) collapsed into one
         * shared `'regular'` bucket, so the free-tier cap of 3 applied
         * across fundamental+news+congress COMBINED rather than per
         * category. A downstream per-category prompt filter (e.g.
         * `congressTrendPrompt` keeping only `category === 'congress'`)
         * could then be starved to zero congress skills even though 5 were
         * loaded. This suite asserts each category is capped independently.
         */
        const TECHNICAL_TYPE: SkillType = 'indicator_guide';
        const NON_TECHNICAL_CATEGORIES: readonly SkillCategory[] = [
            'fundamental',
            'news',
            'congress',
        ];

        const makeCategorySkills = (category: SkillCategory): Skill[] =>
            Array.from({ length: 5 }, (_, index) =>
                makeSkill(`${category}-${index}`, undefined, category)
            );

        const mixedCatalog: Skill[] = [
            ...Array.from({ length: 5 }, (_, index) =>
                makeSkill(`technical-${index}`, TECHNICAL_TYPE)
            ),
            ...NON_TECHNICAL_CATEGORIES.flatMap(makeCategorySkills),
        ];

        it('caps the technical type group and each non-technical category independently at three, starving none', () => {
            const sampled = sampleSkillsForTier(mixedCatalog, 'free', 'seed-a');

            const countOf = (group: SkillType | SkillCategory): number =>
                sampled.filter(skill => groupOf(skill) === group).length;

            expect(countOf(TECHNICAL_TYPE)).toBe(3);
            expect(countOf('fundamental')).toBe(3);
            expect(countOf('news')).toBe(3);
            expect(countOf('congress')).toBe(3);
            expect(sampled).toHaveLength(12);
        });

        it('regression: congress is never starved to zero for a mixed non-technical catalog (would fail under the old shared-regular-bucket grouping)', () => {
            const sampled = sampleSkillsForTier(mixedCatalog, 'free', 'seed-a');
            const congressCount = sampled.filter(
                skill => skill.category === 'congress'
            ).length;

            // Under the pre-fix `groupKeyOf` (`skill.type ?? 'regular'`), all
            // 15 non-technical skills here (fundamental+news+congress) would
            // share one 'regular' bucket capped at 3 total, so congress could
            // easily land at 0. The fix caps congress in its own bucket.
            expect(congressCount).toBeGreaterThan(0);
            expect(congressCount).toBe(3);
        });

        it.each(['member', 'pro'] as const)(
            'keeps the complete mixed catalog for the %s tier',
            tier => {
                const result = sampleSkillsForTier(
                    mixedCatalog,
                    tier,
                    'seed-a'
                );

                expect(result).toEqual(mixedCatalog);
                expect(result).not.toBe(mixedCatalog);
            }
        );
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

        it('keeps a duplicated catalog entry deterministic: identical copies tie on rank and stay adjacent', () => {
            // A loader bug (same file walked twice) yields byte-identical
            // entries — same hash, same name, same identity — so the ranking
            // falls through every tie-breaker. The sample must not depend on
            // input order and the copies must land next to each other.
            const patterns = makeGroup('pattern');
            const duplicated = [
                ...patterns,
                ...patterns.map(skill => ({ ...skill })),
            ];

            const sampled = sampleSkillsForTier(duplicated, 'free', 'seed-a');
            const reversed = sampleSkillsForTier(
                duplicated.toReversed(),
                'free',
                'seed-a'
            );

            expect(sampled).toHaveLength(3);
            expect(namesOf(reversed)).toEqual(namesOf(sampled));
            expect(sampled[0].name).toBe(sampled[1].name);
        });
    });
});
