import type { Skill } from '@/domain/types';

/**
 * @internal Port for loading the skill catalog the domain depends on.
 * @port
 * Contract for loading the skill catalog the domain depends on for
 * prompt enrichment, signal scoring, and showcase rendering.
 *
 * Adapters live in `infrastructure/skills/` and surface load failures
 * to the caller — graceful degradation (e.g. continuing with an empty
 * skills list when a single file is malformed) is the responsibility
 * of the adapter or the application-layer caller, not this contract.
 */
export interface SkillsProvider {
    /**
     * Load every available skill.
     *
     * @returns A promise that resolves to the full list of parsed skills.
     */
    loadSkills(): Promise<Skill[]>;
}
