import type { AgentLocale } from '@/domain/agent/buildAgentSystemPrompt';
import type {
    AgentImage,
    AgentMessage,
    AgentStreamEvent,
    CallAgentProvider,
} from '@/domain/ports/agentProvider';
import type { AgentToolSet } from '@/domain/agent/toolSet';
import type { CounterStore } from '@/domain/ports/counterStore';
import type { UsageLogRepository } from '@/domain/ports/usageLogRepository';
import type {
    MarketSessionSpec,
    ModelId,
    NormalizedUsage,
    Tier,
} from '@/domain/types';
import type { ProviderErrorCode } from '@/application/shared/providerError';
import type { AgentGlobalLimits } from '@/application/agent/limits';

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
    /** The new user message for this turn. May be empty when `userImages` is not. */
    userMessage: string;
    /**
     * Images attached to this turn's message. Sent to the provider with the message; only the first
     * `AGENT_IMAGES_PER_MESSAGE_MAX` are kept. History never carries images (see `formatAttachedImagesMarker`).
     */
    userImages?: readonly AgentImage[];
    /** Tool names the consumer can execute right now. */
    availableTools: ReadonlySet<string>;
    /**
     * The consumer's tool set: the catalog the model may call, the prompt text
     * for it and each tool's per-turn cap, web-search meter and daily quota.
     * Core ships no tools. `availableTools` still decides which of its tools
     * are offered this turn.
     */
    toolSet: AgentToolSet;
    /** Symbols the user holds, for the system prompt. */
    portfolioSymbols?: readonly string[];
    /**
     * The Korean exchange's session spec (hours and holiday list), for the KRX
     * line of the turn note. Core carries no KRX calendar: the consumer composes
     * the per-date open and close minutes into the spec (`openMinuteFor`,
     * `closeMinuteFor`) and passes it; omitted, the note has no KRX line.
     */
    krSession?: MarketSessionSpec;
    /** Injectable clock for tests; defaults to `new Date()`. */
    now?: Date;
    /**
     * The reader's IANA time zone (e.g. the browser's
     * `Intl.DateTimeFormat().resolvedOptions().timeZone`). Untrusted: invalid
     * or missing values fall back to the locale's zone. Every ISO instant in
     * tool results is rewritten to this zone before the model reads it.
     */
    timeZone?: string;
    /** Caller-side abort signal; combined with the internal turn deadline. */
    signal?: AbortSignal;
}

/** Result of `ToolExecutionContext.claimWebSearchUnit`. */
export type WebSearchClaim =
    | { ok: true }
    | {
          ok: false;
          /** Return this as the tool result; it is the same shape the gate emits. */
          refusal:
              | { error: 'quota'; scope: 'global_day' | 'global_month' }
              | { error: 'unavailable' };
      };

export interface ToolExecutionContext {
    /** The requesting user's id, forwarded to the executor. */
    userId: string;
    /** The user's pricing tier, forwarded to the executor. */
    tier: Tier;
    /** Response language, forwarded to the executor. */
    locale: AgentLocale;
    /** Combined caller/deadline abort signal for the in-flight tool call. */
    signal: AbortSignal;
    /**
     * Present only for calls of a `meter: 'webSearch'` tool when
     * `RunAgentTurnDependencies.webSearchMetering === 'executor'`. Claims one
     * unit of the service-wide budget: call it immediately before the billed
     * upstream request, never for a cache hit or a provider that is not
     * billed. Idempotent per tool call: the first call decides, later calls
     * return the same result without charging again. On `ok: false` the
     * executor returns `refusal` as its result.
     */
    claimWebSearchUnit?: () => Promise<WebSearchClaim>;
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
    /** Per-user daily fresh-analysis quota (tools with `dailyQuota: 'freshAnalysis'`). */
    freshAnalysis: CounterStore;
    /** Per-user daily web-search quota (tools with `meter: 'webSearch'`). */
    webSearchUser: CounterStore;
    /** Site-wide daily web-search quota, shared across all users. */
    webSearchGlobalDay: CounterStore;
    /** Site-wide monthly web-search quota, shared across all users. */
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
    /** Max output tokens per provider call. */
    maxOutputTokens?: number;
    /** Service-wide web-search caps; defaults to `AGENT_GLOBAL_LIMITS`. */
    globalLimits?: AgentGlobalLimits;
    /**
     * Where the service-wide web-search budget is charged. `'gate'` (default)
     * charges it before the executor runs, for every call. `'executor'` leaves
     * it to the executor, which claims one unit per billed request through
     * `ToolExecutionContext.claimWebSearchUnit`.
     */
    webSearchMetering?: 'gate' | 'executor';
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

/** Daily allowance left; `null` means the tier has no daily limit for it (never `Infinity`, so it serializes as-is). */
export interface AgentRemaining {
    /** Turns left in the user's daily turn quota, or `null` when uncapped. */
    turns: number | null;
    /** Fresh-analysis calls left today, or `null` when uncapped. */
    fresh: number | null;
    /** Web-search calls left today, or `null` when uncapped. */
    search: number | null;
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
          /**
           * The instant (`toISOString()`, UTC, millisecond precision) this
           * turn's "## Now" note was built from. Persist it with the user
           * message (`AgentMessage.turnAt`); the next turn rebuilds the same
           * note from it, so the provider's prefix cache keeps hitting.
           */
          turnAt?: string;
      }
    | {
          /** Discriminant: the turn was refused, stopped, or failed. */
          ok: false;
          /** Why the turn did not complete. */
          error: AgentErrorCode;
          /** Text streamed before the failure, when any was produced. */
          partialText?: string;
          /**
           * The turn's instant (persist it like the `ok` variant's). Absent
           * when the turn was refused before the prompt was built:
           * `turn_limit`, `premium_turn_limit` and `server_busy` at the gate.
           */
          turnAt?: string;
      };
