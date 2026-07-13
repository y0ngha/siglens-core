import { sampleSkillsForTier } from '@/domain/analysis/sampleSkillsForTier';
import type { Skill, Tier } from '@/domain/types';
import { hashSkillCatalog } from '@/infrastructure/hash/analysisInput';

/** @internal */
export interface SkillSamplingPlan {
    skills: Skill[];
    fingerprint: string;
}

const samplingSeed = (parts: readonly string[]): string =>
    parts.map(part => JSON.stringify(part)).join('\u0000');

/** @internal */
export function createSkillSamplingPlan(
    skills: readonly Skill[],
    tier: Tier,
    seedParts: readonly string[]
): SkillSamplingPlan {
    const sampledSkills = sampleSkillsForTier(
        skills,
        tier,
        samplingSeed(seedParts)
    );
    return {
        skills: sampledSkills,
        fingerprint: hashSkillCatalog(sampledSkills),
    };
}
