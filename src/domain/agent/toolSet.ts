import type { AgentToolSpec } from '@/domain/ports/agentProvider';

/** Arguments of one tool call, after schema validation. */
export type AgentToolArgs = Readonly<Record<string, unknown>>;

/**
 * Per-turn cap of one tool. `runAgentTurn` refuses a call with
 * `{ error: 'quota', scope: 'per_turn' }` once `max` calls that `counts` accepts
 * were reserved in the turn.
 */
export interface AgentToolPerTurnCap {
    /** Calls of this tool one turn may make. */
    max: number;
    /**
     * Whether a call uses the cap. Omitted: every call does. A tool whose
     * cheap calls are free (a listing) and whose expensive calls are capped
     * (a read) decides here; the check runs synchronously at reservation, so
     * parallel calls of one step are counted in model order.
     */
    counts?: (args: AgentToolArgs) => boolean;
}

/**
 * One tool the consumer offers: the provider-facing spec plus what the loop
 * needs to budget it. The extra fields never reach a provider: the loop sends
 * the {@link AgentToolSpec} part only (see {@link toAgentToolSpec}).
 */
export interface AgentToolDefinition extends AgentToolSpec {
    /** Per-turn cap for this tool. Omitted: only the global `maxToolCalls` applies. */
    perTurn?: AgentToolPerTurnCap;
    /**
     * `'webSearch'`: every call draws on the per-user web-search quota and the
     * shared web-search budget (`AGENT_GLOBAL_LIMITS`; in `webSearchMetering:
     * 'executor'` the executor claims the shared units through
     * `ToolExecutionContext.claimWebSearchUnit`).
     */
    meter?: 'webSearch';
    /**
     * Per-user daily quota every call of this tool draws on. `'freshAnalysis'`:
     * `AgentCounters.freshAnalysis` under the caller tier's
     * `AGENT_LIMITS.freshAnalysisPerDay` (uncapped today, so no counter is touched);
     * a refused call gets `{ error: 'quota', scope: 'daily' }`.
     *
     * Omitted: a tool named `run_fresh_analysis` still draws on that quota (the
     * loop's behaviour before this field existed, kept so a consumer set written
     * without it is metered as before); any other tool has no per-user daily quota.
     */
    dailyQuota?: 'freshAnalysis';
    /**
     * Seconds shown in `tool_start` while the call runs. Omitted, or
     * `undefined` for these arguments: the event carries no estimate.
     */
    estimatedSeconds?: (args: AgentToolArgs) => number | undefined;
}

/**
 * One question type → the tools it needs. A row is emitted only when every
 * tool it names is available this turn, so the table never points the model
 * at a tool it cannot call. Per-tool detail (what it returns, arguments)
 * lives in the tool descriptions; rows here only decide *which* tools a
 * question type needs, including combinations and exclusions.
 */
export interface AgentRoutingRow {
    /** Tool names that must all be available for the row to render. */
    requires: readonly string[];
    /**
     * A function when the row's wording depends on WHICH of several tools are
     * available: it receives the available set and returns the line, or an
     * empty string when no wording applies and the row should be dropped.
     */
    text: string | ((available: ReadonlySet<string>) => string);
}

/**
 * Every fragment of the system prompt that names a tool or a tool field and
 * is spliced into tool-agnostic text. Each one renders inside a sentence the
 * frame owns, so the frame stays free of tool names.
 */
export interface AgentToolSetFragments {
    /** Field names inside the parentheses of the "Computed figures" rule. */
    computedFigureExamples: string;
    /**
     * What a not-logged-in visitor can still use, as the comma-separated list
     * inside "everything else (...) works without it". Ends with the last
     * item; the frame adds no trailing separator.
     */
    guestCapabilities: (available: ReadonlySet<string>) => string;
    /** The tool that returns the signed-in user's holdings, named in the "currently holds" line. */
    portfolioTool: string;
    /**
     * Extra example inside the "call again after seeing results" clause: the
     * text placed before `a period the first call did not cover`, ending in
     * `, ` when not empty. Empty when no example applies.
     */
    recallExamples: (available: ReadonlySet<string>) => string;
    /** Internal tool names quoted in the "never write internal tool names" rule. */
    internalToolNameExamples: string;
    /** The public names to use instead, written after the service name. */
    toolDisplayNames: string;
}

/**
 * Everything in the agent prompt and the loop that belongs to the consumer's
 * tools: the tool definitions, the routing rows and tool rules the prompt
 * lists for them, and the loop's per-tool caps (carried by the definitions).
 * `runAgentTurn` and `buildAgentSystemPrompt` take one as an opt-in
 * `toolSet`; omitted, they use `BUILT_IN_AGENT_TOOL_SET`.
 */
export interface AgentToolSet {
    /** Version of the tool text, for the consumer's own logs (core logs `AGENT_PROMPT_VERSION`). */
    version: string;
    /** The tool catalog, in the order the provider receives it. */
    tools: readonly AgentToolDefinition[];
    /** Routing table rows, in order; rows whose `requires` are not all available are dropped. */
    routingRows: readonly AgentRoutingRow[];
    /**
     * Tool rule lines, inserted between the frame's generic head lines and tail
     * lines in this order. A `false` entry (a rule gated on an unavailable
     * tool) leaves no line at all.
     */
    ruleLines: (available: ReadonlySet<string>) => readonly (string | false)[];
    /** Every other tool-dependent fragment the frame splices in. */
    fragments: AgentToolSetFragments;
}

/**
 * The provider-facing part of a definition: the spec fields in their original
 * order, without the loop-only metadata. Sending the definition itself would
 * change the tool bytes a provider (and its prefix cache) sees.
 *
 * @param definition - A tool definition.
 * @returns A new object holding every field except `perTurn`, `meter`, `dailyQuota` and `estimatedSeconds`.
 */
export function toAgentToolSpec(
    definition: AgentToolDefinition
): AgentToolSpec {
    const { perTurn, meter, dailyQuota, estimatedSeconds, ...spec } =
        definition;
    void perTurn;
    void meter;
    void dailyQuota;
    void estimatedSeconds;
    return spec;
}

/**
 * Filter a tool set to the tools the consumer can execute right now.
 * Mirrors `selectTools` for a caller-supplied set.
 *
 * @param toolSet - The consumer's tool set.
 * @param available - Names of tools the consumer can currently execute.
 * @returns The provider-facing specs of the available tools, in catalog order.
 */
export function selectToolSetSpecs(
    toolSet: AgentToolSet,
    available: ReadonlySet<string>
): AgentToolSpec[] {
    return toolSet.tools
        .filter(t => available.has(t.name))
        .map(toAgentToolSpec);
}
