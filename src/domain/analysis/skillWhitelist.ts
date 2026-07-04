import type { Skill, SkillCategory, SkillType } from '@/domain/types';

/**
 * @internal
 * Which prompt family a skill selection is being made for. Each prompt builder
 * passes its own context so cross-domain skill content can never leak into an
 * unrelated prompt (spec §3.2 invariant: e.g. a fundamental framework must not
 * be injected into the TECHNICAL chart prompt).
 *
 * OPTIONS / OVERALL / CONGRESS are intentionally absent: the options and
 * overall builders consume no skills, and the congress builder keeps its own
 * private category filter (no congress skill files exist yet).
 */
export type PromptSkillContext = 'technical' | 'fundamental' | 'news';

/**
 * Chart-prompt skill types. Every `SkillType` value is a chart type today, so
 * this list mirrors the full union — kept as an explicit allowlist so a future
 * non-chart `SkillType` member is excluded from TECHNICAL by default rather
 * than leaking in.
 */
const TECHNICAL_SKILL_TYPES: readonly SkillType[] = [
    'pattern',
    'indicator_guide',
    'strategy',
    'candlestick',
    'support_resistance',
];

/**
 * Categories that mark a skill as belonging to a non-chart analysis domain.
 * A skill carrying one of these is never allowed into the TECHNICAL prompt,
 * even if it also declares a chart `type` — the category is the stronger
 * signal of domain ownership.
 */
const NON_CHART_CATEGORIES: readonly SkillCategory[] = [
    'fundamental',
    'news',
    'congress',
];

/**
 * @internal
 * A per-context whitelist rule: which axis of a {@link Skill} to filter on
 * (`type` or `category`), and the allowed values on that axis.
 */
type WhitelistRule =
    | { readonly axis: 'type'; readonly allow: readonly SkillType[] }
    | { readonly axis: 'category'; readonly allow: readonly SkillCategory[] };

/**
 * @internal
 * Per-context whitelist rule. The two axes reflect how the catalog is actually
 * tagged (the design doc's original folder-name table has no runtime
 * counterpart — folder location is never stored on {@link Skill}):
 *
 * - `technical` filters on the **`type` axis**: all 75 chart skills declare a
 *   chart `SkillType`, while the 37 indicator skills carry no `category` at
 *   all — so a category-axis filter would wrongly drop the entire indicator
 *   guide set. The chart direction categories (`reversal_*`, `continuation_*`,
 *   `neutral`) remain orthogonal metadata.
 * - `fundamental` / `news` filter on the **`category` axis**: their skills
 *   declare no `type` (no `SkillType` value fits them) and are tagged solely
 *   by `category`, exactly as the existing prompt-builder filters did.
 */
export const SKILL_CONTEXT_WHITELIST: Readonly<
    Record<PromptSkillContext, WhitelistRule>
> = {
    technical: { axis: 'type', allow: TECHNICAL_SKILL_TYPES },
    fundamental: { axis: 'category', allow: ['fundamental'] },
    news: { axis: 'category', allow: ['news'] },
};

/**
 * @internal
 * Whether a skill is allowed into the given prompt context.
 *
 * `technical` additionally rejects any skill categorized into a non-chart
 * domain ({@link NON_CHART_CATEGORIES}), regardless of its `type` — this is
 * the spec's cross-domain invariant made defensive: a mis-tagged skill that
 * declares both a chart `type` and `category: fundamental` must still stay
 * out of the chart prompt.
 *
 * A skill with **no `type`** is treated as chart-generic and allowed into
 * `technical` (it lands in the builder's `regular` bucket, the long-standing
 * behavior for untyped skills); exclusion of non-chart content is owned by
 * the category clause. All shipped chart skills declare a `type`, so this
 * passthrough only affects legacy/untyped entries.
 */
export function isSkillAllowedInContext(
    skill: Skill,
    promptContext: PromptSkillContext
): boolean {
    const rule = SKILL_CONTEXT_WHITELIST[promptContext];
    if (rule.axis === 'category') {
        return (
            skill.category !== undefined && rule.allow.includes(skill.category)
        );
    }
    // type axis (technical): non-chart category always wins as an exclusion.
    if (
        skill.category !== undefined &&
        NON_CHART_CATEGORIES.includes(skill.category)
    ) {
        return false;
    }
    return skill.type === undefined || rule.allow.includes(skill.type);
}
