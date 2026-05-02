import type { Skill } from '@/domain/types';

/**
 * Contract for loading the skill catalog.
 *
 * The default file-system implementation is {@link FileSkillsLoader}.
 * Tests inject stubs to avoid touching the filesystem.
 */
export interface SkillsProvider {
    /** Load every available skill. */
    loadSkills(): Promise<Skill[]>;
}

/** @internal Result shape returned by {@link loadSkillsCached}. */
export interface LoadSkillsCachedResult {
    /** Parsed skills list; empty when load failed. */
    skills: Skill[];
    /**
     * `true` when the loaded skills failed to read from disk and the analysis
     * ran with an empty skills list. Used by the worker / consumer to surface
     * a degraded warning.
     */
    skillsDegraded: boolean;
}
