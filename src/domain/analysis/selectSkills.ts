import { isStateNotable } from '@/domain/analysis/skillGatingPredicates';
import type { Skill, SkillGating, SkillSelectionContext } from '@/domain/types';

/**
 * Whether a gated skill should be injected, given the chart context.
 *
 * - `always_on` → always.
 * - `event` → any `triggers` entry is a currently-detected signal or candle.
 * - `state` → the textbook `state` predicate is notable.
 * - any other / malformed `gated` shape → excluded (the validation CI in
 *   PR3 rejects unreachable skills; here we simply fail closed for gated).
 */
const isGatedSkillActive = (
    gating: SkillGating,
    ctx: SkillSelectionContext
): boolean => {
    if (gating.tier === 'always_on') return true;

    if (gating.signalKind === 'event') {
        const triggers = gating.triggers;
        if (triggers === undefined || triggers.length === 0) return false;
        // Event triggers match detected signal events OR detected candle
        // patterns — candle guides are gated on their appearance in the
        // detection list, which is the candle equivalent of a signal event.
        return triggers.some(
            trigger =>
                ctx.signals.some(signal => signal.type === trigger) ||
                ctx.detectedCandles.includes(trigger)
        );
    }

    if (gating.signalKind === 'state') {
        return gating.state !== undefined && isStateNotable(gating.state, ctx);
    }

    return false;
};

/**
 * Select which skills to inject into the chart prompt for the given context.
 *
 * Pure and deterministic: the result depends only on the inputs. Untagged
 * skills are included **fail-open** (never silently dropped) so a migration gap
 * degrades to "inject everything" rather than "inject nothing". The returned
 * array is a fresh, name-sorted copy — inputs are never mutated.
 *
 * @param skills - Candidate skills (already loaded, with frontmatter gating).
 * @param ctx - Read-only chart selection context (signals, indicators, …).
 * @returns Selected skills, sorted by `name` for a stable total order.
 */
export function selectSkills(
    skills: readonly Skill[],
    ctx: SkillSelectionContext
): Skill[] {
    const selected = skills.filter(skill => {
        // Fail-open: an untagged skill is always included.
        if (skill.gating === undefined) return true;
        return isGatedSkillActive(skill.gating, ctx);
    });
    return selected.toSorted((a, b) => a.name.localeCompare(b.name));
}
