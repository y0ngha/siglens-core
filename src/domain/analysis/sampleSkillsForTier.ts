import type { Skill, SkillType, Tier } from '@/domain/types';

const FREE_TIER_GROUP_CAP = 3;
const REGULAR_GROUP_KEY = 'regular';
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

type SkillGroupKey = SkillType | typeof REGULAR_GROUP_KEY;

interface RankedSkill {
    skill: Skill;
    hash: number;
    identity: string;
}

const byStringEn = (a: string, b: string): number => a.localeCompare(b, 'en');

const groupKeyOf = (skill: Skill): SkillGroupKey =>
    skill.type ?? REGULAR_GROUP_KEY;

const stableSerialize = (value: unknown): string => {
    if (Array.isArray(value)) {
        return `[${value.map(stableSerialize).join(',')}]`;
    }

    if (value !== null && typeof value === 'object') {
        // `typeof value === 'object'` excludes null above; every remaining value
        // can be enumerated as string keys for deterministic serialization.
        const record = value as Record<string, unknown>;

        return `{${Object.keys(record)
            .toSorted(byStringEn)
            .map(
                key => `${JSON.stringify(key)}:${stableSerialize(record[key])}`
            )
            .join(',')}}`;
    }

    const serialized = JSON.stringify(value);
    return `${typeof value}:${serialized ?? String(value)}`;
};

const stableSkillIdentity = (skill: Skill): string => stableSerialize(skill);

const hashString = (input: string): number =>
    input
        .split('')
        .reduce(
            (hash, character) =>
                Math.imul(hash ^ character.charCodeAt(0), FNV_PRIME) >>> 0,
            FNV_OFFSET_BASIS
        );

const byRank = (a: RankedSkill, b: RankedSkill): number =>
    a.hash - b.hash ||
    byStringEn(a.skill.name, b.skill.name) ||
    byStringEn(a.identity, b.identity);

const rankSkill = (
    skill: Skill,
    groupKey: SkillGroupKey,
    seed: string
): RankedSkill => {
    const identity = stableSkillIdentity(skill);
    return {
        skill,
        hash: hashString(`${seed}\u0000${groupKey}\u0000${identity}`),
        identity,
    };
};

/**
 * @internal
 *
 * Deterministically caps the free-tier catalog to at most three skills per
 * prompt-injection group before any later relevance filtering.
 */
export function sampleSkillsForTier(
    skills: readonly Skill[],
    tier: Tier,
    seed: string
): Skill[] {
    if (tier !== 'free') return [...skills];

    // Grouping via a local Map accumulator: `skills` (the input) is never
    // mutated, and each group array is a freshly created local, mutated only
    // within this loop, which is allowed under the domain "Performance
    // Exceptions" (externally pure, no mutation of shared/input state). Preserves
    // original per-group insertion order. `Map.groupBy` (ES2024) is not used
    // because this project's tsconfig `lib` is pinned to `ES2023`.
    const grouped = new Map<SkillGroupKey, Skill[]>();
    for (const skill of skills) {
        const groupKey = groupKeyOf(skill);
        const existing = grouped.get(groupKey);
        if (existing) {
            existing.push(skill);
        } else {
            grouped.set(groupKey, [skill]);
        }
    }

    return [...grouped.entries()]
        .toSorted(([left], [right]) => byStringEn(left, right))
        .flatMap(([groupKey, groupSkills]) =>
            groupSkills
                .map(skill => rankSkill(skill, groupKey, seed))
                .toSorted(byRank)
                .slice(0, FREE_TIER_GROUP_CAP)
                .map(({ skill }) => skill)
        );
}
