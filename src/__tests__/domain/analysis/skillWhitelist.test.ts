import { describe, it, expect } from 'vitest';
import {
    isSkillAllowedInContext,
    SKILL_CONTEXT_WHITELIST,
    type PromptSkillContext,
} from '@/domain/analysis/skillWhitelist';
import type { Skill, SkillCategory, SkillType } from '@/domain/types';

// ── Deterministic fixtures ──────────────────────────────────────────────────

const baseSkill = (extra: Partial<Skill> = {}): Skill => ({
    name: 'skill',
    description: 'skill description',
    indicators: [],
    confidenceWeight: 1,
    content: 'skill content',
    ...extra,
});

const CHART_TYPES: readonly SkillType[] = [
    'pattern',
    'indicator_guide',
    'strategy',
    'candlestick',
    'support_resistance',
];

// ── Tests ───────────────────────────────────────────────────────────────────

describe('isSkillAllowedInContext — technical axis', () => {
    it.each(CHART_TYPES)('accepts a skill typed "%s"', (type: SkillType) => {
        expect(isSkillAllowedInContext(baseSkill({ type }), 'technical')).toBe(
            true
        );
    });

    it.each(['fundamental', 'news', 'congress'] as const)(
        'rejects category "%s" even when a chart type is also present (defensive exclusion)',
        (category: SkillCategory) => {
            expect(
                isSkillAllowedInContext(
                    baseSkill({ type: 'strategy', category }),
                    'technical'
                )
            ).toBe(false);
        }
    );

    it.each(['fundamental', 'news', 'congress'] as const)(
        'rejects category "%s" when the skill carries no type at all',
        (category: SkillCategory) => {
            expect(
                isSkillAllowedInContext(
                    baseSkill({ type: undefined, category }),
                    'technical'
                )
            ).toBe(false);
        }
    );

    it('passes a typeless skill with no non-chart category (documented judgment call: chart-generic passthrough)', () => {
        expect(
            isSkillAllowedInContext(
                baseSkill({ type: undefined, category: undefined }),
                'technical'
            )
        ).toBe(true);
    });

    it('passes a typeless skill tagged with a chart-direction category (neutral/reversal/continuation are orthogonal, not exclusionary)', () => {
        expect(
            isSkillAllowedInContext(
                baseSkill({ type: undefined, category: 'neutral' }),
                'technical'
            )
        ).toBe(true);
    });

    it('rejects a skill whose type is not one of the 5 chart SkillTypes (worst case: a future non-chart SkillType member)', () => {
        // Cast through unknown since every current SkillType member is a chart
        // type — this simulates a hypothetical future addition to the union.
        const foreignType = 'future_type' as unknown as SkillType;
        expect(
            isSkillAllowedInContext(
                baseSkill({ type: foreignType }),
                'technical'
            )
        ).toBe(false);
    });
});

describe('isSkillAllowedInContext — fundamental axis', () => {
    it('accepts a skill categorized fundamental, with no type', () => {
        expect(
            isSkillAllowedInContext(
                baseSkill({ type: undefined, category: 'fundamental' }),
                'fundamental'
            )
        ).toBe(true);
    });

    it('accepts a skill categorized fundamental even if it also carries a chart type', () => {
        expect(
            isSkillAllowedInContext(
                baseSkill({ type: 'strategy', category: 'fundamental' }),
                'fundamental'
            )
        ).toBe(true);
    });

    it('rejects a skill with no category at all', () => {
        expect(
            isSkillAllowedInContext(
                baseSkill({ type: undefined, category: undefined }),
                'fundamental'
            )
        ).toBe(false);
    });

    it('rejects a skill categorized into any other axis value (news/congress/chart-direction)', () => {
        for (const category of [
            'news',
            'congress',
            'neutral',
            'reversal_bullish',
        ] as const) {
            expect(
                isSkillAllowedInContext(
                    baseSkill({ type: undefined, category }),
                    'fundamental'
                )
            ).toBe(false);
        }
    });
});

describe('isSkillAllowedInContext — news axis', () => {
    it('accepts a skill categorized news, with no type', () => {
        expect(
            isSkillAllowedInContext(
                baseSkill({ type: undefined, category: 'news' }),
                'news'
            )
        ).toBe(true);
    });

    it('accepts a skill categorized news even if it also carries a chart type', () => {
        expect(
            isSkillAllowedInContext(
                baseSkill({ type: 'pattern', category: 'news' }),
                'news'
            )
        ).toBe(true);
    });

    it('rejects a skill with no category at all', () => {
        expect(
            isSkillAllowedInContext(
                baseSkill({ type: undefined, category: undefined }),
                'news'
            )
        ).toBe(false);
    });

    it('rejects a skill categorized into any other axis value (fundamental/congress/chart-direction)', () => {
        for (const category of [
            'fundamental',
            'congress',
            'continuation_bearish',
        ] as const) {
            expect(
                isSkillAllowedInContext(
                    baseSkill({ type: undefined, category }),
                    'news'
                )
            ).toBe(false);
        }
    });
});

describe('SKILL_CONTEXT_WHITELIST', () => {
    it('defines exactly the 3 documented prompt contexts (options/overall/congress intentionally absent)', () => {
        expect(Object.keys(SKILL_CONTEXT_WHITELIST).sort()).toEqual([
            'fundamental',
            'news',
            'technical',
        ]);
    });

    it('every context resolves through isSkillAllowedInContext without throwing (worst case: an unrecognized context key)', () => {
        for (const context of Object.keys(
            SKILL_CONTEXT_WHITELIST
        ) as PromptSkillContext[]) {
            expect(() =>
                isSkillAllowedInContext(baseSkill(), context)
            ).not.toThrow();
        }
    });
});
