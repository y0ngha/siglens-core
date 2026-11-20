import type { AgentMessage } from '@/domain/ports/agentProvider';

export interface HistoryWindowOptions {
    /** User turns to keep verbatim (design value: 8). */
    turns: number;
    /** Most recent turns whose tool results stay verbatim (design value: 2; see `toolResultStride`). */
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
    /**
     * Move the verbatim/`omitted` boundary of tool results in blocks of this
     * many turns instead of one per new turn (default `1`: today's rolling
     * boundary). With `toolResultStride = s`, between `toolResultTurns` and
     * `toolResultTurns + s - 1` recent turns keep their results verbatim, and
     * the boundary advances only every `s` turns — a turn's tool messages
     * change bytes (verbatim → `omitted`) once per `s` turns, not on every
     * turn, so the provider's cached prefix survives the turns in between.
     * Under budget pressure the window falls back to exactly
     * `toolResultTurns` verbatim turns (no worse than the rolling boundary).
     * Below 1 or non-integer is treated as 1.
     */
    toolResultStride?: number;
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

/** Window/boundary stride: below 1 (or non-integer) is treated as 1. */
function strideOf(raw: number | undefined): number {
    return Math.max(1, Math.floor(raw ?? 1));
}

/** Round `value` down to a multiple of `step`. */
function quantize(value: number, step: number): number {
    return Math.floor(value / step) * step;
}

/**
 * Index of the first turn the window keeps. Advances in multiples of `stride`
 * once there are more than `turns` turns, so it is constant across `stride`
 * consecutive turns. `stride` below 1 (or non-integer) is treated as 1.
 */
function windowStart(count: number, turns: number, stride: number): number {
    const step = strideOf(stride);
    if (count <= turns) return 0;
    return quantize(count - turns, step);
}

function turnTokens(turn: readonly AgentMessage[]): number {
    return turn.reduce((s, m) => s + messageTokens(m), 0);
}

/**
 * Pick the transcript slice sent to the model: last `turns`
 * user turns (up to `turns + stride - 1` with a `stride`, see
 * {@link HistoryWindowOptions.stride}) verbatim, tool results outside the
 * recent `toolResultTurns` turns (up to `toolResultTurns + toolResultStride - 1`,
 * see {@link HistoryWindowOptions.toolResultStride}) replaced by an `omitted`
 * marker (the assistant `toolCalls` stay so every tool message keeps its
 * pair), then drop oldest turns until under budget — in whole `stride` blocks
 * when `stride > 1`, so the head only moves where it already moves.
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
    const count = allTurns.length;
    const stride = strideOf(options.stride);
    const resultStride = strideOf(options.toolResultStride);
    const head = windowStart(count, options.turns, stride);
    const kept = allTurns.slice(head);
    /** Turns from absolute index `from` keep their tool results; older ones are omitted. */
    const shape = (verbatimFrom: number): AgentMessage[][] =>
        kept.map((turn, offset) =>
            head + offset >= verbatimFrom
                ? turn
                : turn.map(m => (m.role === 'tool' ? omitToolResult(m) : m))
        );
    const sumTokens = (turns: readonly AgentMessage[][]): number =>
        turns.reduce((sum, turn) => sum + turnTokens(turn), 0);
    const exactFrom = Math.max(head, count - options.toolResultTurns);
    const blockFrom = Math.max(
        head,
        quantize(Math.max(0, count - options.toolResultTurns), resultStride)
    );
    const blockShaped = shape(blockFrom);
    // Budget pressure: the extra verbatim turns the block boundary keeps are
    // the first thing to go, back to exactly `toolResultTurns`.
    const fallBack =
        resultStride > 1 && sumTokens(blockShaped) > options.budgetTokens;
    const shaped = fallBack ? shape(exactFrom) : blockShaped;
    let total = sumTokens(shaped);
    let start = 0;
    while (total > options.budgetTokens && start < shaped.length - 1) {
        // Whole stride blocks: `head` is already a multiple of `stride`, so
        // the next kept head lands on the next multiple (never past the last turn).
        const next =
            stride > 1
                ? Math.min(
                      shaped.length - 1,
                      quantize(head + start, stride) + stride - head
                  )
                : start + 1;
        total -= sumTokens(shaped.slice(start, next));
        start = next;
    }
    return shaped.slice(start).flat();
}
