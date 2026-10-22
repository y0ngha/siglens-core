import type { AgentMessage } from '@/domain/ports/agentProvider';

export interface HistoryWindowOptions {
    /** User turns to keep verbatim (design value: 8). */
    turns: number;
    /** Most recent turns whose tool results stay verbatim (design value: 2). */
    toolResultTurns: number;
    /** Input budget in estimated tokens (design value: 32_000). */
    budgetTokens: number;
    /**
     * Drop old turns in blocks of this many instead of one per new turn
     * (default `1`: the window is exactly the last `turns` turns). With a
     * stride `s`, the window keeps between `turns` and `turns + s - 1` turns
     * and its oldest turn moves only every `s` turns — so the history prefix
     * stays byte-identical for `s` turns at a time and the provider's prefix
     * cache keeps hitting, instead of shifting (and missing) on every turn.
     */
    stride?: number;
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
 * Index of the first turn the window keeps. Advances in multiples of `stride`
 * once there are more than `turns` turns, so it is constant across `stride`
 * consecutive turns. `stride` below 1 (or non-integer) is treated as 1.
 */
function windowStart(count: number, turns: number, stride: number): number {
    const step = Math.max(1, Math.floor(stride));
    if (count <= turns) return 0;
    return Math.floor((count - turns) / step) * step;
}

/**
 * Pick the transcript slice sent to the model: last `turns`
 * user turns (up to `turns + stride - 1` with a `stride`, see
 * {@link HistoryWindowOptions.stride}) verbatim, tool results outside the
 * last `toolResultTurns` turns replaced by an `omitted` marker (the assistant `toolCalls` stay so every
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
    const allTurns = splitTurns(history).filter(t => t[0]?.role === 'user');
    const turns = allTurns.slice(
        windowStart(allTurns.length, options.turns, options.stride ?? 1)
    );
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
