import type { ModelId, NormalizedUsage } from '@/domain/types';

/** Speaker role in the agent transcript. `tool` carries a tool result. */
export type AgentRole = 'user' | 'assistant' | 'tool';

/** A tool invocation the model asked for. `id` is the provider's own id. */
export interface AgentToolCall {
    /** The provider's own id for this call, echoed back in the tool result. */
    id: string;
    /** Tool name; matches `AgentToolSpec.name`. */
    name: string;
    /** Arguments the model supplied, validated against the tool's `inputSchema`. */
    args: Record<string, unknown>;
}

/**
 * Provider-neutral transcript entry. Adapters map this to each SDK's wire
 * shape and back; nothing provider-specific is stored here (P3 adds
 * `providerMeta` when reasoning is enabled).
 */
export interface AgentMessage {
    /** Who produced this message. */
    role: AgentRole;
    /** user/assistant text; for `tool`, the executor-truncated result JSON. */
    content: string;
    /** Present on assistant messages that requested tools. */
    toolCalls?: AgentToolCall[];
    /** Present on `tool` messages — the `AgentToolCall.id` being answered. */
    toolCallId?: string;
    /** Present on `tool` messages — the tool name that produced `content`. */
    toolName?: string;
}

/** JSON Schema (draft-07 subset) accepted by every provider we ship. */
export interface JsonSchemaProperty {
    /** JSON Schema primitive/array type for this property. */
    type: 'string' | 'number' | 'integer' | 'boolean' | 'array';
    /** Human-readable description surfaced to the model. */
    description?: string;
    /** Allowed literal values, when the property is a closed enum. */
    enum?: readonly string[];
    /** Minimum numeric value, for `number`/`integer` properties. */
    minimum?: number;
    /** Maximum numeric value, for `number`/`integer` properties. */
    maximum?: number;
    /** Schema of each element, when `type` is `'array'`. */
    items?: JsonSchemaProperty;
}

export interface JsonSchemaObject {
    /** Always `'object'` — the root of a tool's input schema. */
    type: 'object';
    /** Property definitions keyed by argument name. */
    properties: Record<string, JsonSchemaProperty>;
    /** Names of properties the model must supply. */
    required?: readonly string[];
    /** Always `false` — rejects arguments outside `properties`. */
    additionalProperties: false;
}

export type AgentToolCostClass = 'free' | 'cached' | 'expensive' | 'external';

export interface AgentToolSpec {
    /** Tool name the model calls by. */
    name: string;
    /** Instructions the model reads to decide when/how to call this tool. */
    description: string;
    /** JSON Schema for the tool's arguments. */
    inputSchema: JsonSchemaObject;
    /** Billing/quota bucket this tool's calls draw from. */
    costClass: AgentToolCostClass;
}

export type AgentStopReason = 'end' | 'tool_use' | 'max_tokens' | 'other';

export type AgentStreamEvent =
    | { type: 'text'; delta: string }
    | { type: 'tool_call'; call: AgentToolCall }
    | { type: 'usage'; usage: NormalizedUsage }
    | { type: 'stop'; reason: AgentStopReason };

export interface CallAgentProviderOptions {
    /**
     * Core's own `runAgentTurn` does not know about keys and always passes
     * `''` — key resolution (BYOK vs server key) is the consumer's router's
     * job, not core's. Consumer adapters extend this options type with the
     * effective key before calling their provider SDK; do not rely on this
     * field being populated by anything inside core.
     */
    apiKey: string;
    /** Internal model key; the adapter maps it to the provider's apiModelId. */
    model: ModelId;
    /** System prompt for this call. */
    system: string;
    /** Transcript so far, oldest first, to send as conversation context. */
    messages: AgentMessage[];
    /** Tool catalog the model may call this step; empty on the final step. */
    tools: AgentToolSpec[];
    /** Output-token cap for this call. */
    maxOutputTokens: number;
    /** Aborts the in-flight call when the turn is stopped or times out. */
    signal: AbortSignal;
    /** Sink for streamed text/tool-call/usage/stop events as they arrive. */
    onEvent: (event: AgentStreamEvent) => void;
}

export interface AgentProviderResult {
    /** Full assistant text accumulated from streamed `text` deltas. */
    text: string;
    /** Tool calls the model requested this step, if any. */
    toolCalls: AgentToolCall[];
    /** Why the model stopped generating. */
    stopReason: AgentStopReason;
    /** Token usage for this call. */
    usage: NormalizedUsage;
}

/**
 * @port
 * Streaming, tool-capable provider call. Adapters live in the consumer
 * (siglens `entities/llm-provider/api/agent/*`). Must resolve with the
 * aggregated result even though deltas were already emitted via `onEvent`.
 * Upstream errors propagate; the application layer maps them.
 */
export type CallAgentProvider = (
    options: CallAgentProviderOptions
) => Promise<AgentProviderResult>;
