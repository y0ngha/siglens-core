import type { Skill, SkillCategory } from '@/domain/types';

/** Always-on skills per fixture catalog; more than the free per-group cap. */
export const ALWAYS_ON_COUNT = 4;
/** Gated skills per fixture catalog; more than the free per-group cap. */
export const GATED_COUNT = 4;

const baseSkill = (name: string, category: SkillCategory): Skill => ({
    name,
    description: `${name} description`,
    category,
    indicators: [],
    confidenceWeight: 1,
    content: `${name} content`,
});

/**
 * Catalog of one category with more always-on and more gated skills than the
 * free cap: the always-on ones must all survive, the gated ones are the only
 * thing a cap may trim.
 */
export function tierCapCatalog(
    category: SkillCategory,
    prefix: string
): { catalog: Skill[]; alwaysOnNames: string[]; gatedNames: string[] } {
    const alwaysOnNames = Array.from(
        { length: ALWAYS_ON_COUNT },
        (_, i) => `${prefix} Always ${i}`
    );
    const gatedNames = Array.from(
        { length: GATED_COUNT },
        (_, i) => `${prefix} Gated ${i}`
    );
    return {
        alwaysOnNames,
        gatedNames,
        catalog: [
            ...alwaysOnNames.map(name => ({
                ...baseSkill(name, category),
                gating: { tier: 'always_on' as const },
            })),
            ...gatedNames.map(name => ({
                ...baseSkill(name, category),
                gating: {
                    tier: 'gated' as const,
                    signalKind: 'event' as const,
                    triggers: ['rsi_oversold'],
                },
            })),
        ],
    };
}
