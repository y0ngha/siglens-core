import type { AgentToolCostClass } from '@/domain/ports/agentProvider';
import type { Tier } from '@/domain/types';

type PerTier = Readonly<Record<Tier, number>>;

/**
 * Per-user daily quotas (spec §4-5). `free` = anonymous visitor, counted per
 * IP by the consumer: a few plain turns to try the assistant, and every
 * metered tool at 0 — `runAgentTurn` turns a 0 guest quota into
 * `{"error":"login_required"}` so the answer offers sign-in instead of
 * "come back tomorrow".
 */
export const AGENT_LIMITS = {
    turnsPerDay: { free: 10, member: 60, pro: 200 } satisfies PerTier,
    premiumModelTurnsPerDay: { free: 0, member: 10, pro: 20 } satisfies PerTier,
    freshAnalysisPerDay: { free: 0, member: 6, pro: 20 } satisfies PerTier,
    webSearchPerDay: { free: 0, member: 5, pro: 10 } satisfies PerTier,
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

/** Per-turn hard caps (spec §4-2). */
export const AGENT_TURN_CAPS = {
    maxSteps: 6,
    maxToolCalls: 8,
    maxWebSearch: 2,
    maxFreshAnalysis: 1,
    maxDistinctSymbols: 3,
    turnDeadlineMs: 600_000,
} as const;

/** Per-tool execution timeout by cost class. `expensive` ≥ measured 248s. */
export const TOOL_TIMEOUT_MS: Readonly<Record<AgentToolCostClass, number>> = {
    free: 10_000,
    cached: 10_000,
    external: 8_000,
    expensive: 300_000,
};
