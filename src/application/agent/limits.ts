import type { AgentToolCostClass } from '@/domain/ports/agentProvider';
import type { Tier } from '@/domain/types';

type PerTier = Readonly<Record<Tier, number>>;

/**
 * Per-user daily quotas (spec §4-5). SIGLENS sets no daily analysis or
 * chatbot count limit (`TIER_CONFIG.limits` are `Infinity`), so the agent does
 * not invent one either: fresh analyses and web search are uncapped for every
 * tier, guests included, and so are signed-in turns. What still bounds cost
 * is structural — the per-turn caps (`AGENT_TURN_CAPS`), the shared Brave
 * budget (`AGENT_GLOBAL_LIMITS`) and the consumer's concurrency limits.
 * `free` = anonymous visitor: a small daily turn allowance (counted per guest
 * by the consumer). `runAgentTurn` skips the counter for an `Infinity` quota
 * and still answers `{"error":"login_required"}` for a guest quota set to 0.
 */
export const AGENT_LIMITS = {
    turnsPerDay: {
        free: 10,
        member: Infinity,
        pro: Infinity,
    } satisfies PerTier,
    premiumModelTurnsPerDay: { free: 0, member: 10, pro: 20 } satisfies PerTier,
    freshAnalysisPerDay: {
        free: Infinity,
        member: Infinity,
        pro: Infinity,
    } satisfies PerTier,
    webSearchPerDay: {
        free: Infinity,
        member: Infinity,
        pro: Infinity,
    } satisfies PerTier,
    conversationsMax: { free: 0, member: 100, pro: 300 } satisfies PerTier,
    messagesPerConversation: 200,
} as const;

export type AgentPerTierLimit = Exclude<
    keyof typeof AGENT_LIMITS,
    'messagesPerConversation'
>;

/**
 * Look up a per-tier daily quota from {@link AGENT_LIMITS}.
 *
 * @param tier - The caller's tier (`free`/`member`/`pro`).
 * @param feature - Which `AGENT_LIMITS` quota to read.
 * @returns The numeric quota for that tier/feature pair.
 */
export function agentLimit(tier: Tier, feature: AgentPerTierLimit): number {
    return AGENT_LIMITS[feature][tier];
}

/** Service-wide caps independent of user (Brave free credits = 1,000/month). */
export const AGENT_GLOBAL_LIMITS = {
    webSearchPerDay: 33,
    webSearchPerMonth: 1000,
} as const;

/**
 * Per-turn hard caps (spec §4-2). Ceilings, not targets: the model decides how
 * many lookups a question needs, so simple questions still end in one or two
 * steps. Raised 2026-09-13 so a "news + overall + options + technical +
 * fundamentals" question on a few symbols fits in one turn. `maxWebSearch`
 * stays well below the daily quotas because the global Brave budget
 * (`AGENT_GLOBAL_LIMITS`) is shared by every user.
 */
export const AGENT_TURN_CAPS = {
    maxSteps: 10,
    maxToolCalls: 30,
    maxWebSearch: 4,
    maxFreshAnalysis: 3,
    maxDistinctSymbols: 5,
    turnDeadlineMs: 600_000,
} as const;

/** Per-tool execution timeout by cost class. `expensive` ≥ measured 248s. */
export const TOOL_TIMEOUT_MS: Readonly<Record<AgentToolCostClass, number>> = {
    free: 10_000,
    cached: 10_000,
    external: 8_000,
    expensive: 300_000,
};
