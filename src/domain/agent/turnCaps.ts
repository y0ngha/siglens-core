/**
 * Per-turn hard caps. Ceilings, not targets: the model decides how
 * many lookups a question needs, so simple questions still end in one or two
 * steps. Sized so a "news + overall + options + technical +
 * fundamentals" question on a few symbols fits in one turn. `maxWebSearch`
 * stays low because the global Brave budget (`AGENT_GLOBAL_LIMITS` by default) is shared
 * by every user.
 *
 * Lives in `domain/` (re-exported from `application/agent/limits.ts`) because
 * the tool descriptions the model reads (`tools.ts`) quote these numbers, and
 * `domain/` cannot import `application/` — one source keeps them in step.
 */
export const AGENT_TURN_CAPS = {
    maxSteps: 10,
    maxToolCalls: 30,
    maxWebSearch: 4,
    maxFreshAnalysis: 3,
    maxDistinctSymbols: 5,
    turnDeadlineMs: 600_000,
} as const;
