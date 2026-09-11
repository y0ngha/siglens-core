import type {
    AgentMessage,
    AgentStreamEvent,
    AgentToolSpec,
    CallAgentProvider,
} from '@/domain/ports/agentProvider';
import type { CounterStore } from '@/domain/ports/counterStore';
import type { UsageLogRepository } from '@/domain/ports/usageLogRepository';
import type { AgentLocale } from '@/domain/agent/buildAgentSystemPrompt';
import type { ModelId, NormalizedUsage, Tier } from '@/domain/types';
import type { ProviderErrorCode } from '@/application/shared/providerError';

/**
 * Turn-level failure codes. `server_busy` also covers a fail-closed counter
 * store outage — an outage must not surface as an exhausted quota.
 */
export type AgentErrorCode =
    | 'turn_limit'
    | 'premium_turn_limit'
    | ProviderErrorCode
    | 'deadline'
    | 'aborted';

export interface RunAgentTurnParams {
    userId: string;
    tier: Tier;
    model: ModelId;
    locale: AgentLocale;
    /** Full stored transcript (the loop selects the window itself). */
    history: readonly AgentMessage[];
    userMessage: string;
    /** Tool names the consumer can execute right now (spec §4-2 step 2). */
    availableTools: ReadonlySet<string>;
    /** Symbols the user holds, for the system prompt (spec §4-3 item 6). */
    portfolioSymbols?: readonly string[];
    now?: Date;
    signal?: AbortSignal;
}

export interface ToolExecutionContext {
    userId: string;
    tier: Tier;
    locale: AgentLocale;
    signal: AbortSignal;
}

/** Executor contract: never throws for domain errors — return `{ error }`. */
export type ExecuteTool = (
    name: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext
) => Promise<unknown>;

export interface AgentCounters {
    turns: CounterStore;
    premiumTurns: CounterStore;
    freshAnalysis: CounterStore;
    webSearchUser: CounterStore;
    webSearchGlobalDay: CounterStore;
    webSearchGlobalMonth: CounterStore;
}

export interface RunAgentTurnDependencies {
    callAgentProvider: CallAgentProvider;
    executeTool: ExecuteTool;
    counters: AgentCounters;
    onEvent: (event: AgentTurnEvent) => void;
    usageLogs?: UsageLogRepository;
    /** Max output tokens per provider call (spec §5: 4,096 with reasoning off). */
    maxOutputTokens?: number;
}

export type AgentTurnEvent =
    | AgentStreamEvent
    | {
          type: 'tool_start';
          id: string;
          name: string;
          args: Record<string, unknown>;
          estimatedSeconds?: number;
      }
    | {
          type: 'tool_end';
          id: string;
          name: string;
          status: 'ok' | 'error';
          ms: number;
          summary: string;
      };

export interface AgentTurnUsage extends NormalizedUsage {
    steps: number;
    ms: number;
}

export interface AgentRemaining {
    turns: number;
    fresh: number;
    search: number;
}

export type RunAgentTurnResult =
    | {
          ok: true;
          assistant: AgentMessage;
          /** Interleaved assistant(toolCalls)+tool messages produced during the turn, in order, excluding the final assistant. */
          intermediate: AgentMessage[];
          usage: AgentTurnUsage;
          stopReason: 'end' | 'max_tokens';
          remaining: AgentRemaining;
          promptVersion: string;
          toolsUsed: string[];
      }
    | { ok: false; error: AgentErrorCode; partialText?: string };

export type { AgentToolSpec };
