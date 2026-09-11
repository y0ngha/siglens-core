import type { ModelId, NormalizedUsage } from '@/domain/types';

/** Speaker role in the agent transcript. `tool` carries a tool result. */
export type AgentRole = 'user' | 'assistant' | 'tool';

/** A tool invocation the model asked for. `id` is the provider's own id. */
export interface AgentToolCall {
    id: string;
    name: string;
    args: Record<string, unknown>;
}

/**
 * Provider-neutral transcript entry. Adapters map this to each SDK's wire
 * shape and back; nothing provider-specific is stored here (P3 adds
 * `providerMeta` when reasoning is enabled).
 */
export interface AgentMessage {
    role: AgentRole;
    /** user/assistant text; for `tool`, the executor-truncated result JSON. */
    content: string;
    /** Present on assistant messages that requested tools. */
    toolCalls?: AgentToolCall[];
    /** Present on `tool` messages — the `AgentToolCall.id` being answered. */
    toolCallId?: string;
    toolName?: string;
}

/** JSON Schema (draft-07 subset) accepted by every provider we ship. */
export interface JsonSchemaProperty {
    type: 'string' | 'number' | 'integer' | 'boolean' | 'array';
    description?: string;
    enum?: readonly string[];
    minimum?: number;
    maximum?: number;
    items?: JsonSchemaProperty;
}

export interface JsonSchemaObject {
    type: 'object';
    properties: Record<string, JsonSchemaProperty>;
    required?: readonly string[];
    additionalProperties: false;
}

export type AgentToolCostClass = 'free' | 'cached' | 'expensive' | 'external';

export interface AgentToolSpec {
    name: string;
    description: string;
    inputSchema: JsonSchemaObject;
    costClass: AgentToolCostClass;
}

export type AgentStopReason = 'end' | 'tool_use' | 'max_tokens' | 'other';

export type AgentStreamEvent =
    | { type: 'text'; delta: string }
    | { type: 'tool_call'; call: AgentToolCall }
    | { type: 'usage'; usage: NormalizedUsage }
    | { type: 'stop'; reason: AgentStopReason };

export interface CallAgentProviderOptions {
    /** Single effective key — the consumer resolves BYOK vs server key. */
    apiKey: string;
    /** Internal model key; the adapter maps it to the provider's apiModelId. */
    model: ModelId;
    system: string;
    messages: AgentMessage[];
    tools: AgentToolSpec[];
    maxOutputTokens: number;
    signal: AbortSignal;
    onEvent: (event: AgentStreamEvent) => void;
}

export interface AgentProviderResult {
    text: string;
    toolCalls: AgentToolCall[];
    stopReason: AgentStopReason;
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
