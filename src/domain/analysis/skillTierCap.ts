import type { Skill, SkillCategory, SkillType, Tier } from '@/domain/types';

/**
 * @internal
 * Free tier: the most gated skills (those whose gate fired for the chart) one
 * prompt-injection group may carry. Always-on skills are never counted against
 * it. The cap is applied by {@link selectSkills} AFTER relevance ordering, so
 * the skills kept are the group's most relevant ones, not a hash draw.
 *
 * The cap is part of every free cache key (`tierCapKeyPart`,
 * `infrastructure/skills/sampling.ts`), so changing it moves the free keys by
 * itself and no prompt template version bump is needed for it.
 */
export const FREE_TIER_GATED_SKILLS_PER_GROUP = 3;

const REGULAR_GROUP_KEY = 'regular';

/**
 * Technical skills always carry a `SkillType`, so they group by `type`. The
 * type-less fundamental/news/congress skills fall back to their
 * `SkillCategory`, so each of those categories is counted independently
 * instead of sharing one bucket.
 */
type SkillGroupKey = SkillType | SkillCategory | typeof REGULAR_GROUP_KEY;

/** @internal The prompt-injection group a skill is counted in: `type ?? category ?? 'regular'`. */
export const skillGroupKey = (skill: Skill): SkillGroupKey =>
    skill.type ?? skill.category ?? REGULAR_GROUP_KEY;

/**
 * @internal
 * The gated-skill cap per injection group for a tier: free carries at most
 * {@link FREE_TIER_GATED_SKILLS_PER_GROUP}; member and pro are uncapped
 * (`null`).
 */
export function gatedSkillCapForTier(tier: Tier): number | null {
    return tier === 'free' ? FREE_TIER_GATED_SKILLS_PER_GROUP : null;
}
