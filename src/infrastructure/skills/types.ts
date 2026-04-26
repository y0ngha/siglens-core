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
