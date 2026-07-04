import { isStateNotable } from '@/domain/analysis/skillGatingPredicates';
import {
    isSkillAllowedInContext,
    type PromptSkillContext,
} from '@/domain/analysis/skillWhitelist';
import { EMPTY_INDICATOR_RESULT } from '@/domain/indicators/constants';
import type { Skill, SkillGating, SkillSelectionContext } from '@/domain/types';

/**
 * @internal
 * Result of {@link selectSkills}, split along the stable/dynamic prompt
 * boundary (spec §3.2 / §3.4):
 *
 * - `core` — `always_on` skills, name-sorted (locale-pinned). Depends only on
 *   the catalog, never on the chart, so it can serve as a byte-stable prompt
 *   prefix for provider-side prompt caching in the later assembly phase.
 * - `selected` — gated skills whose gate fired for this chart, ordered by
 *   relevance (trigger-match count desc, then name asc). Chart-dependent by
 *   construction.
 */
export interface SkillSelection {
    core: Skill[];
    selected: Skill[];
}

/**
 * @internal
 * Neutral selection context for prompt builders that have no chart in scope
 * (fundamental / financials / news). `always_on` skills still land in `core`;
 * gated skills can never fire against it (no signals, no candles, degenerate
 * price/indicators), which is the intended semantics — an event/state gate is
 * a *chart* condition, and a chartless prompt has no chart state to satisfy it.
 *
 * Public-API consequence: a `tier: 'gated'` skill tagged `category:
 * 'fundamental'` or `category: 'news'` is a contradiction in terms — it can
 * never be selected into those prompts, because this context has no signals/
 * candles/state to satisfy any gate. Skills in these two categories must
 * therefore be `always_on`; the current catalog's 6 fundamental/news skills
 * all are.
 */
export const NO_CHART_SELECTION_CONTEXT: SkillSelectionContext = Object.freeze({
    indicators: EMPTY_INDICATOR_RESULT,
    signals: [],
    timeframe: '1Day',
    detectedCandles: [],
    patternCandidates: [],
    price: 0,
    atrPercent: 0,
});

/**
 * Deterministic relevance score of a *gated* skill for the given chart.
 *
 * - gated `event` → the number of currently-detected signals plus detected
 *   candle patterns plus pattern-screener candidates that match any of the
 *   skill's `triggers`. Event triggers match signal events OR candle patterns
 *   OR chart-pattern-screener candidates — candle guides and pattern skills
 *   are gated on their appearance in the detection/candidate list, both the
 *   candle/pattern equivalent of a signal event.
 * - gated `state` → `1` when the textbook `state` predicate is notable, else `0`.
 *
 * A score of `0` means the gate did not fire; a higher score ranks the skill
 * closer to the data sections in the assembled prompt (ordering only — there
 * is no inclusion cap).
 *
 * `SkillGating` is a discriminated union (the loader only ever produces a
 * valid variant or `undefined`), so narrowing on `signalKind` is exhaustive.
 */
const relevanceScore = (
    gating: Exclude<SkillGating, { tier: 'always_on' }>,
    ctx: SkillSelectionContext
): number => {
    if (gating.signalKind === 'event') {
        if (gating.triggers.length === 0) return 0;
        const triggers = new Set<string>(gating.triggers);
        let score = 0;
        for (const signal of ctx.signals) {
            if (triggers.has(signal.type)) score += 1;
        }
        for (const candle of ctx.detectedCandles) {
            if (triggers.has(candle)) score += 1;
        }
        for (const patternId of ctx.patternCandidates) {
            if (triggers.has(patternId)) score += 1;
        }
        return score;
    }
    // The only remaining gated variant is `signalKind: 'state'`.
    return isStateNotable(gating.state, ctx) ? 1 : 0;
};

/** Locale-pinned name comparator — a locale-free `localeCompare` is environment-dependent, which would break determinism. */
const byNameEn = (a: Skill, b: Skill): number =>
    a.name.localeCompare(b.name, 'en');

/**
 * @internal
 * Select which skills to inject into a prompt for the given chart context and
 * prompt family.
 *
 * Pure and deterministic: the result depends only on the inputs, inputs are
 * never mutated, and both output arrays are fresh copies.
 *
 * Pipeline:
 * 1. **Whitelist** — drop every skill not allowed in `promptContext`
 *    ({@link isSkillAllowedInContext}), so cross-domain content (e.g. a news
 *    framework in the TECHNICAL prompt) is excluded before gating is even
 *    consulted. Untagged skills outside the context are therefore filtered,
 *    not thrown on — they belong to some other prompt's contract.
 * 2. **Fail-closed gating** — a whitelisted skill with `gating === undefined`
 *    throws. The catalog-side validator and loader tagging make this
 *    unreachable for shipped catalogs; throwing (rather than the previous
 *    fail-open include) makes the contract explicit and surfaces a migration
 *    gap loudly instead of silently re-inflating the prompt.
 * 3. **Split & order** — `always_on` → `core` (name-sorted, stable);
 *    fired gated skills → `selected` (relevance desc, name-asc tie-break).
 *
 * @param skills - Candidate skills (already loaded, with frontmatter gating).
 * @param ctx - Read-only chart selection context (signals, indicators, …).
 *   Chartless builders pass {@link NO_CHART_SELECTION_CONTEXT}.
 * @param promptContext - Which prompt family is selecting (technical /
 *   fundamental / news); drives the category/type whitelist.
 * @returns `{ core, selected }` — see {@link SkillSelection}.
 * @throws {Error} when a whitelisted skill carries no `gating` metadata.
 */
export function selectSkills(
    skills: readonly Skill[],
    ctx: SkillSelectionContext,
    promptContext: PromptSkillContext
): SkillSelection {
    const core: Skill[] = [];
    const fired: { skill: Skill; score: number }[] = [];

    for (const skill of skills) {
        if (!isSkillAllowedInContext(skill, promptContext)) continue;

        const { gating } = skill;
        if (gating === undefined) {
            throw new Error(
                `selectSkills: skill "${skill.name}" has no gating metadata — ` +
                    `selection is fail-closed (tag the skill's frontmatter with a ` +
                    `gating block; see docs/SKILL_GATING.md)`
            );
        }

        if (gating.tier === 'always_on') {
            core.push(skill);
            continue;
        }

        const score = relevanceScore(gating, ctx);
        if (score > 0) fired.push({ skill, score });
    }

    core.sort(byNameEn);
    // Relevance desc, then name asc — a deterministic total order.
    fired.sort((a, b) => b.score - a.score || byNameEn(a.skill, b.skill));

    return { core, selected: fired.map(f => f.skill) };
}
