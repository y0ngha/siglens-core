import type { AgentToolCostClass } from '@/domain/ports/agentProvider';
import type { Tier } from '@/domain/types';

type PerTier = Readonly<Record<Tier, number>>;

/**
 * Per-user daily quotas (spec §4-5). SIGLENS sets no daily analysis or
 * chatbot count limit (`TIER_CONFIG.limits` are `Infinity`), so the agent does
 * not invent one either: fresh analyses and web search are uncapped for every
 * tier, guests included, and so are signed-in turns. What still bounds cost
 * is structural — the per-turn caps (`AGENT_TURN_CAPS`), the shared Brave
 * budget (`AGENT_GLOBAL_LIMITS`, overridable via `RunAgentTurnDependencies.globalLimits`)
 * and the consumer's concurrency limits.
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

/** Shape of the service-wide caps; a consumer may pass its own through `RunAgentTurnDependencies.globalLimits`. */
export interface AgentGlobalLimits {
    webSearchPerDay: number;
    webSearchPerMonth: number;
}

/**
 * Service-wide caps independent of user (Brave free credits = 1,000/month). These are the
 * defaults; a consumer that buys more search capacity (e.g. for a measurement window) passes
 * `globalLimits` instead of patching this constant, so the change is visible at the call site.
 */
export const AGENT_GLOBAL_LIMITS: Readonly<AgentGlobalLimits> = {
    webSearchPerDay: 33,
    webSearchPerMonth: 1000,
};

export { AGENT_TURN_CAPS } from '@/domain/agent/turnCaps';

/**
 * Per-tool execution timeout by cost class. `expensive` ≥ measured 248s.
 *
 * Raised 2026-09-14 (free/cached 10s → 30s, external 8s → 15s) after a
 * production turn where `get_market_overview` timed out at 10,001ms on a cold
 * cache and its retry took 8,967ms. "Cached" tools still hit the provider on a
 * cache miss, and the consumer's FMP client backs off 10/15/20s on 429, so a
 * 10s cap turned one slow-but-successful lookup into a failed tool call plus a
 * wasted model step. These are ceilings, not targets: a fast tool returns as
 * soon as it resolves, and the turn deadline (`AGENT_TURN_CAPS.turnDeadlineMs`)
 * still bounds the whole turn.
 *
 * The FMP backoff applies to `free`/`cached` tools (quotes, bars, fundamentals,
 * market data). 30s covers the first retries but deliberately not the full
 * 10+15+20s ladder: a provider that is still rate-limiting after that is better
 * reported as a failed tool call the model can explain than held for 45s+.
 * `external` is `web_search` (Brave), which has no such backoff; 15s only
 * absorbs its slow tail.
 */
export const TOOL_TIMEOUT_MS: Readonly<Record<AgentToolCostClass, number>> = {
    free: 30_000,
    cached: 30_000,
    external: 15_000,
    expensive: 300_000,
};
