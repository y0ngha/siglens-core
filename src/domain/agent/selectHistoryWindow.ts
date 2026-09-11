import type { AgentMessage } from '@/domain/ports/agentProvider';

export interface HistoryWindowOptions {
    /** User turns to keep verbatim (spec: 8). */
    turns: number;
    /** Most recent turns whose tool results stay verbatim (spec: 2). */
    toolResultTurns: number;
    /** Input budget in estimated tokens (spec: 32_000). */
    budgetTokens: number;
}

/**
 * Conservative token estimate: ASCII text runs ~3 chars/token; non-ASCII
 * (Korean, CJK, etc.) tokenizes far denser, ~1.2 tokens/char, so counting
 * every char at 1/3 badly underestimates Korean-heavy transcripts.
 *
 * @param text - The text to estimate a token count for.
 * @returns The estimated token count.
 */
export function estimateTokens(text: string): number {
    const nonAscii = text.replace(/[\x00-\x7F]/g, '').length;
    const ascii = text.length - nonAscii;
    return Math.ceil(ascii / 3 + nonAscii * 1.2);
}

function messageTokens(m: AgentMessage): number {
    return (
        estimateTokens(m.content) +
        (m.toolCalls ? estimateTokens(JSON.stringify(m.toolCalls)) : 0)
    );
}

/** Split a transcript into turns; a turn starts at each user message. */
function splitTurns(history: readonly AgentMessage[]): AgentMessage[][] {
    const turns: AgentMessage[][] = [];
    for (const m of history) {
        if (m.role === 'user' || turns.length === 0) turns.push([]);
        turns[turns.length - 1].push(m);
    }
    return turns;
}

function omitToolResult(m: AgentMessage): AgentMessage {
    let symbol: unknown;
    try {
        const parsed = JSON.parse(m.content) as Record<string, unknown>;
        symbol = parsed.symbol;
    } catch {
        symbol = undefined;
    }
    return {
        ...m,
        content: JSON.stringify({
            omitted: true,
            tool: m.toolName,
            ...(typeof symbol === 'string' ? { symbol } : {}),
        }),
    };
}

/**
 * Pick the transcript slice sent to the model (spec §4-4): last `turns`
 * user turns verbatim, tool results outside the last `toolResultTurns` turns
 * replaced by an `omitted` marker (the assistant `toolCalls` stay so every
 * tool message keeps its pair), then drop oldest turns until under budget.
 * Pure; does not mutate input.
 *
 * ponytail: fixed window — replace with summarisation (P3) once a
 * conversation-length histogram shows long threads matter.
 *
 * @param history - The full transcript, oldest message first.
 * @param options - Window sizing: user turns kept, verbatim tool-result
 * turns, and the token budget.
 * @returns The trimmed transcript slice to send to the model.
 */
export function selectHistoryWindow(
    history: readonly AgentMessage[],
    options: HistoryWindowOptions
): AgentMessage[] {
    if (options.turns <= 0) return [];
    // Drop any leading fragment before the first user message (e.g. a
    // dangling tool exchange from a previous window) so `turns[0]` is always
    // a real user turn and `slice(-turns)` can't hand back everything.
    const turns = splitTurns(history)
        .filter(t => t[0]?.role === 'user')
        .slice(-options.turns);
    const verbatimFrom = Math.max(0, turns.length - options.toolResultTurns);
    const shaped = turns.map((turn, index) =>
        index >= verbatimFrom
            ? turn
            : turn.map(m => (m.role === 'tool' ? omitToolResult(m) : m))
    );
    let total = shaped.reduce(
        (sum, turn) => sum + turn.reduce((s, m) => s + messageTokens(m), 0),
        0
    );
    let start = 0;
    while (total > options.budgetTokens && start < shaped.length - 1) {
        total -= shaped[start].reduce((s, m) => s + messageTokens(m), 0);
        start += 1;
    }
    return shaped.slice(start).flat();
}
