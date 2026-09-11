import type { AgentLocale } from '@/domain/agent/buildAgentSystemPrompt';
import type {
    AgentMessage,
    AgentStreamEvent,
    CallAgentProvider,
} from '@/domain/ports/agentProvider';
import type { CounterStore } from '@/domain/ports/counterStore';
import type { UsageLogRepository } from '@/domain/ports/usageLogRepository';
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
    /** The requesting user's id, used for per-user quota subjects. */
    userId: string;
    /** The user's pricing tier, for quota limits and premium-model gating. */
    tier: Tier;
    /** Model to call for this turn. */
    model: ModelId;
    /** Response language for the system prompt. */
    locale: AgentLocale;
    /** Full stored transcript (the loop selects the window itself). */
    history: readonly AgentMessage[];
    /** The new user message for this turn. */
    userMessage: string;
    /** Tool names the consumer can execute right now (spec §4-2 step 2). */
    availableTools: ReadonlySet<string>;
    /** Symbols the user holds, for the system prompt (spec §4-3 item 6). */
    portfolioSymbols?: readonly string[];
    /** Injectable clock for tests; defaults to `new Date()`. */
    now?: Date;
    /** Caller-side abort signal; combined with the internal turn deadline. */
    signal?: AbortSignal;
}

export interface ToolExecutionContext {
    /** The requesting user's id, forwarded to the executor. */
    userId: string;
    /** The user's pricing tier, forwarded to the executor. */
    tier: Tier;
    /** Response language, forwarded to the executor. */
    locale: AgentLocale;
    /** Combined caller/deadline abort signal for the in-flight tool call. */
    signal: AbortSignal;
}

/** Executor contract: never throws for domain errors — return `{ error }`. */
export type ExecuteTool = (
    name: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext
) => Promise<unknown>;

export interface AgentCounters {
    /** Per-user daily turn quota. */
    turns: CounterStore;
    /** Per-user daily premium-model turn quota. */
    premiumTurns: CounterStore;
    /** Per-user daily `run_fresh_analysis` quota. */
    freshAnalysis: CounterStore;
    /** Per-user daily `web_search` quota. */
    webSearchUser: CounterStore;
    /** Site-wide daily `web_search` quota, shared across all users. */
    webSearchGlobalDay: CounterStore;
    /** Site-wide monthly `web_search` quota, shared across all users. */
    webSearchGlobalMonth: CounterStore;
}

export interface RunAgentTurnDependencies {
    /** Streaming provider call injected by the consumer's router. */
    callAgentProvider: CallAgentProvider;
    /** Tool executor injected by the consumer. */
    executeTool: ExecuteTool;
    /** Quota counters for this turn's user/global limits. */
    counters: AgentCounters;
    /** Sink for streamed provider events plus tool lifecycle events. */
    onEvent: (event: AgentTurnEvent) => void;
    /** Optional premium-model usage log writer; omitted turns are not tracked. */
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
    /** Number of provider round-trips (loop iterations) in this turn. */
    steps: number;
    /** Wall-clock duration of the turn in milliseconds. */
    ms: number;
}

export interface AgentRemaining {
    /** Turns left in the user's daily turn quota. */
    turns: number;
    /** `run_fresh_analysis` calls left in the user's daily quota. */
    fresh: number;
    /** `web_search` calls left in the user's daily quota. */
    search: number;
}

export type RunAgentTurnResult =
    | {
          /** Discriminant: the turn completed and produced an assistant reply. */
          ok: true;
          /** The final assistant message to append to the stored transcript. */
          assistant: AgentMessage;
          /** Interleaved assistant(toolCalls)+tool messages produced during the turn, in order, excluding the final assistant. */
          intermediate: AgentMessage[];
          /** Aggregated token usage and timing across every step of the turn. */
          usage: AgentTurnUsage;
          /** Why the loop stopped: the model finished, or the output-token cap was hit. */
          stopReason: 'end' | 'max_tokens';
          /** Quota units left after this turn, for the UI's remaining-count display. */
          remaining: AgentRemaining;
          /** System-prompt version used for this turn, for telemetry/debugging. */
          promptVersion: string;
          /** Names of tools that executed successfully during the turn, in call order. */
          toolsUsed: string[];
      }
    | {
          /** Discriminant: the turn was refused, stopped, or failed. */
          ok: false;
          /** Why the turn did not complete. */
          error: AgentErrorCode;
          /** Text streamed before the failure, when any was produced. */
          partialText?: string;
      };
