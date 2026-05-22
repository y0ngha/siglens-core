import type { Skill } from '@/domain/types';

/** @internal Result shape returned by `loadSkillsCached`. */
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
