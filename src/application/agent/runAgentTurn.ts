import {
    AGENT_IMAGES_PER_MESSAGE_MAX,
    formatAttachedImagesMarker,
} from '@/domain/agent/attachedImages';
import {
    AGENT_PROMPT_VERSION,
    buildAgentSystemPrompt,
    buildAgentTurnContext,
    composeAgentUserMessage,
} from '@/domain/agent/buildAgentSystemPrompt';
import { selectHistoryWindow } from '@/domain/agent/selectHistoryWindow';
import { isSmallTalkMessage } from '@/domain/agent/smallTalk';
import { BUILT_IN_AGENT_TOOL_SET } from '@/domain/agent/builtInToolSet';
import {
    selectToolSetSpecs,
    type AgentToolPerTurnCap,
    type AgentToolSet,
} from '@/domain/agent/toolSet';
import {
    localizeTimestamps,
    resolveAgentTimeZone,
} from '@/domain/agent/userTimeZone';
import { validateArgs } from '@/domain/agent/validateArgs';
import type {
    AgentImage,
    AgentImageMediaType,
    AgentMessage,
    AgentToolCall,
} from '@/domain/ports/agentProvider';
import {
    CounterStoreUnavailableError,
    type CounterStore,
} from '@/domain/ports/counterStore';
import { isPremiumModel } from '@/domain/tier';
import type { NormalizedUsage } from '@/domain/types';
import { classifyProviderError } from '@/application/shared/providerError';
import { PREMIUM_MODEL_USAGE_ACTION } from '@/application/shared/usageActions';
import {
    AGENT_GLOBAL_LIMITS,
    AGENT_TURN_CAPS,
    TOOL_TIMEOUT_MS,
    agentLimit,
    type AgentPerTierLimit,
} from './limits';
import type {
    AgentErrorCode,
    AgentRemaining,
    AgentTurnUsage,
    RunAgentTurnDependencies,
    RunAgentTurnParams,
    RunAgentTurnResult,
    WebSearchClaim,
} from './types';

const DEFAULT_MAX_OUTPUT_TOKENS = 4_096;
const HISTORY_WINDOW = {
    turns: 8,
    toolResultTurns: 2,
    budgetTokens: 32_000,
    // Drop old turns 4 at a time instead of 1 per turn, so the window's head —
    // and with it the cached prefix — holds still for 4 turns at a stretch.
    stride: 4,
    // Tool results flip to `omitted` 2 turns at a time instead of 1 per turn:
    // each flip changes bytes mid-history and ends the cached prefix there.
    // 2 (not 4) keeps heavy turns inside the budget. The boundary moves at
    // turn counts 4, 6, 8, 10…, the window head at 12, 16…: the prefix breaks
    // once per `toolResultStride` turns (the flip turns), by design.
    toolResultStride: 2,
    // Small old tool results (quotes, short lists) stay readable instead of
    // turning into markers. The per-turn cap reads only that turn's rows, so
    // it adds no cache break point; over budget they revert before any turn
    // is dropped.
    keepSmallToolResults: { maxChars: 1_400, perTurnChars: 3_000 },
} as const;
const GLOBAL_SUBJECT = 'global';
const MAX_SUMMARY_LENGTH = 120;

/**
 * Sentinels for outcomes core produced itself, so an executor that returns
 * its own `{ error: 'timeout' }` is still an executor refusal (refunded)
 * rather than a core timeout.
 */
const TOOL_TIMEOUT: unique symbol = Symbol('tool_timeout');
const TURN_STOPPED: unique symbol = Symbol('turn_stopped');

type GateRefusal = Record<string, unknown>;
type ToolQuotaResult =
    | { refusal: GateRefusal }
    /** Per-user counters claimed for this call (global counters excluded). */
    | { perUser: CounterStore[] };

function addUsage(a: NormalizedUsage, b: NormalizedUsage): NormalizedUsage {
    return {
        promptTokens: a.promptTokens + b.promptTokens,
        cachedTokens: a.cachedTokens + b.cachedTokens,
        cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
        outputTokens: a.outputTokens + b.outputTokens,
    };
}

function withTimeout<T>(
    work: Promise<T>,
    ms: number
): Promise<T | typeof TOOL_TIMEOUT> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<typeof TOOL_TIMEOUT>(resolve => {
        timer = setTimeout(() => resolve(TOOL_TIMEOUT), ms);
    });
    return Promise.race([work, timeout]).finally(() => {
        clearTimeout(timer);
    });
}

/**
 * Settles with {@link TURN_STOPPED} as soon as `signal` aborts, even when
 * `work` ignores the signal (siglens' `run_fresh_analysis` deliberately
 * does, and a provider adapter might hang). The abandoned promise keeps a
 * race handler attached, so a late rejection is not unhandled.
 */
function untilStopped<T>(
    work: Promise<T>,
    signal: AbortSignal
): Promise<T | typeof TURN_STOPPED> {
    let onAbort: () => void = () => {};
    const stopped = new Promise<typeof TURN_STOPPED>(resolve => {
        onAbort = () => resolve(TURN_STOPPED);
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
    });
    return Promise.race([work, stopped]).finally(() => {
        signal.removeEventListener('abort', onAbort);
    });
}

function symbolsOf(args: Record<string, unknown>): string[] {
    const out: string[] = [];
    if (typeof args.symbol === 'string') out.push(args.symbol.toUpperCase());
    if (Array.isArray(args.symbols)) {
        for (const s of args.symbols)
            if (typeof s === 'string') out.push(s.toUpperCase());
    }
    return out;
}

/**
 * Tool messages must carry a string. `JSON.stringify(undefined)` returns
 * `undefined` and circular/BigInt payloads throw, either of which would
 * corrupt the transcript or escape as a provider failure (refunding a turn
 * that actually ran).
 */
function serialize(payload: unknown): string {
    try {
        return JSON.stringify(payload) ?? 'null';
    } catch {
        return JSON.stringify({ error: 'unserializable_result' });
    }
}

function summarize(content: string): string {
    return content.length > MAX_SUMMARY_LENGTH
        ? `${content.slice(0, MAX_SUMMARY_LENGTH)}…`
        : content;
}

/**
 * @internal Log marker for the shared web-search budget running out. Consumers
 * alarm on the literal string (siglens `infra/aws/07-alarms.sh`) — it is the
 * operator's cue to move the search provider to a paid plan. Renaming it
 * silently kills that alarm.
 */
export const WEB_SEARCH_BUDGET_EXHAUSTED_LOG =
    '[agent] web search budget exhausted';

/** Refunds are best-effort: a failed refund must not turn into a turn error. */
async function safeRefund(store: CounterStore, subject: string): Promise<void> {
    try {
        await store.refund(subject);
    } catch (error) {
        console.warn('[runAgentTurn] refund failed', { subject, error });
    }
}

const SENDABLE_IMAGE_TYPES: ReadonlySet<string> = new Set<AgentImageMediaType>([
    'image/webp',
    'image/jpeg',
    'image/png',
]);

/**
 * An image a provider can take: a known format and some data. Types are erased at the consumer's JSON boundary, so
 * an empty or unknown entry is dropped here instead of failing the whole provider call (and refunding the turn).
 */
function isSendableImage(image: AgentImage): boolean {
    return (
        SENDABLE_IMAGE_TYPES.has(image.mediaType) &&
        typeof image.data === 'string' &&
        image.data !== ''
    );
}

/**
 * History never re-sends images (they would be billed again every turn). A stored message that still carries images
 * loses them here, and gets the {@link formatAttachedImagesMarker} line when the consumer did not add it, so the model
 * still knows the user showed something it can no longer see.
 */
function withoutImages(message: AgentMessage): AgentMessage {
    const { images, ...rest } = message;
    if (images === undefined || images.length === 0) return rest;
    const marker = formatAttachedImagesMarker(images.length);
    return rest.content.includes(marker)
        ? rest
        : { ...rest, content: `${rest.content}\n${marker}` };
}

/** What `Date.prototype.toISOString` writes: UTC, `T`, milliseconds, `Z`. */
const TURN_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** The instant a stored `turnAt` names, or `null` when it is malformed. */
function parseTurnAt(turnAt: string | undefined): Date | null {
    if (turnAt === undefined || !TURN_AT_RE.test(turnAt)) return null;
    const at = new Date(turnAt);
    return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * A stored user message that carries a `turnAt` is sent as it was on its own
 * turn: its note is rebuilt with the live builder at that instant (and the
 * current request's zone, locale and `krSession`), then composed with the
 * user's words. The field is dropped: a provider only ever sees the composed
 * `content`. A missing or malformed `turnAt` replays the message without a
 * note. Messages without the field are returned as the same object, so
 * history passes through untouched.
 */
function withTurnNote(
    message: AgentMessage,
    noteAt: (at: Date) => string
): AgentMessage {
    if (!('turnAt' in message)) return message;
    const { turnAt, ...rest } = message;
    const at = message.role === 'user' ? parseTurnAt(turnAt) : null;
    return at === null
        ? rest
        : {
              ...rest,
              content: composeAgentUserMessage(noteAt(at), rest.content),
          };
}

/**
 * Per-turn budget, pure and local to one turn: the global caps from
 * `AGENT_TURN_CAPS` (`maxToolCalls`, `maxDistinctSymbols`) and each tool's own
 * `perTurn` cap from its definition. Counted here rather than in the consumer
 * executor because the executor has no turn identity and a step's calls run in
 * parallel — this reservation is synchronous, so they are counted in model
 * order.
 */
class TurnBudget {
    private toolCalls = 0;
    private readonly capped = new Map<string, number>();
    private readonly symbols = new Set<string>();

    /** Returns a quota scope when the call must be refused, else null. */
    reserve(
        name: string,
        perTurn: AgentToolPerTurnCap | undefined,
        args: Record<string, unknown>
    ): string | null {
        if (this.toolCalls >= AGENT_TURN_CAPS.maxToolCalls)
            return 'per_turn_tools';
        const capCounted =
            perTurn !== undefined &&
            (perTurn.counts === undefined || perTurn.counts(args));
        if (capCounted && (this.capped.get(name) ?? 0) >= perTurn.max)
            return 'per_turn';
        const next = new Set(this.symbols);
        for (const s of symbolsOf(args)) next.add(s);
        if (next.size > AGENT_TURN_CAPS.maxDistinctSymbols)
            return 'per_turn_symbols';
        this.toolCalls += 1;
        if (capCounted) this.capped.set(name, (this.capped.get(name) ?? 0) + 1);
        for (const s of next) this.symbols.add(s);
        return null;
    }
}

/**
 * One agent turn: consume quota → build prompt/window → loop
 * provider ⇄ tools up to `maxSteps` → return the final assistant message
 * plus every intermediate message the consumer must persist.
 *
 * Never throws for provider/tool/counter failures; maps them to
 * `AgentErrorCode`. A counter store outage (`CounterStoreUnavailableError`)
 * is `server_busy` at the turn gate and `{ error: 'unavailable' }` at a tool
 * gate — never a quota refusal.
 *
 * The turn deadline is a hard timer: when it fires (or the caller aborts)
 * the in-flight provider call or tool wait is abandoned immediately. Neither
 * `aborted` nor `deadline` refunds the turn — the work was already spent.
 *
 * @param params - Per-call inputs: user/tier identity, model, message, history,
 * available tools, locale, and optional `signal`/`now` overrides.
 * @param deps - Injected collaborators: the provider call, tool executor,
 * per-user/global counters, event sink, and optional usage-log writer.
 * @returns The turn result — either `{ ok: true, ... }` with the assistant
 * message and updated quota/usage counters, or `{ ok: false, error }` with
 * an `AgentErrorCode` (and any streamed `partialText`) when the turn was
 * refused, stopped, or the provider/tool chain failed.
 */
export async function runAgentTurn(
    params: RunAgentTurnParams,
    deps: RunAgentTurnDependencies
): Promise<RunAgentTurnResult> {
    const startedAt = Date.now();
    const now = params.now ?? new Date();
    const { counters } = deps;
    const globalLimits = deps.globalLimits ?? AGENT_GLOBAL_LIMITS;
    const executorMetering = deps.webSearchMetering === 'executor';
    const { userId, tier } = params;

    // 1. Daily quotas. An uncapped (`Infinity`) quota is not counted at all:
    // there is nothing to enforce, so a counter-store outage must not turn it
    // into `server_busy`, and there is no unit to refund later.
    const premium = isPremiumModel(params.model);
    const turnLimit = agentLimit(tier, 'turnsPerDay');
    const turnCounted = turnLimit !== Infinity;
    if (turnCounted) {
        try {
            if (!(await counters.turns.consume(userId, turnLimit))) {
                return { ok: false, error: 'turn_limit' };
            }
        } catch {
            return { ok: false, error: 'server_busy' };
        }
    }
    const refundTurnUnit = async (): Promise<void> => {
        if (turnCounted) await safeRefund(counters.turns, userId);
    };
    if (premium) {
        let allowed: boolean;
        try {
            allowed = await counters.premiumTurns.consume(
                userId,
                agentLimit(tier, 'premiumModelTurnsPerDay')
            );
        } catch {
            await refundTurnUnit();
            return { ok: false, error: 'server_busy' };
        }
        if (!allowed) {
            await refundTurnUnit();
            return { ok: false, error: 'premium_turn_limit' };
        }
    }
    const refundTurn = async (): Promise<void> => {
        await refundTurnUnit();
        if (premium) await safeRefund(counters.premiumTurns, userId);
    };

    const deadline = new AbortController();
    const turnSignal = params.signal
        ? AbortSignal.any([params.signal, deadline.signal])
        : deadline.signal;

    // 2–3. Prompt and window.
    const toolSet: AgentToolSet = params.toolSet ?? BUILT_IN_AGENT_TOOL_SET;
    const tools = selectToolSetSpecs(toolSet, params.availableTools);
    const timeZone = resolveAgentTimeZone(params.timeZone, params.locale);
    // Prefix-cache layout (DeepSeek caches the longest byte-identical request
    // prefix): system prompt → tool defs → history are stable across turns;
    // everything that changes per turn (the clock, the session status) rides
    // on the latest user message only. The consumer persists the turn's
    // instant (`result.turnAt`) with the message and sends it back in
    // history, where `withTurnNote` rebuilds the note from it with the same
    // builder, so the message replays with the same bytes. The note is a pure
    // function of (instant, time zone, locale, krSession). Known exceptions to
    // the byte-prefix guarantee: image turns (the attachment marker is
    // appended on replay), the flip turns (a tool result changes to `omitted`
    // every `toolResultStride` turns), and a rebuilt note that differs from
    // the original because the user's zone or locale or the passed session
    // spec changed between turns, or a core version changed the note format
    // (each costs one cache miss, never an error).
    const system = buildAgentSystemPrompt({
        locale: params.locale,
        tools,
        toolSet,
        portfolioSymbols: params.portfolioSymbols,
        guest: tier === 'free',
    });
    const noteAt = (at: Date): string =>
        buildAgentTurnContext({
            locale: params.locale,
            now: at,
            timeZone,
            krSession: params.krSession,
        });
    const turnNote = noteAt(now);
    // Millisecond precision matters: the note's "in 21m" lead reads the
    // instant's milliseconds, so a rebuild from this string is byte-identical.
    const turnAt = now.toISOString();
    // Earlier user messages are re-sent WITH the note they were sent with
    // (rebuilt from their `turnAt`), so they stay byte-identical to the
    // previous request.
    const historyWindow = selectHistoryWindow(
        params.history.some(m => 'turnAt' in m)
            ? params.history.map(m => withTurnNote(m, noteAt))
            : params.history,
        HISTORY_WINDOW
    ).map(withoutImages);
    const userImages = (params.userImages ?? [])
        .filter(isSendableImage)
        .slice(0, AGENT_IMAGES_PER_MESSAGE_MAX);
    const messages: AgentMessage[] = [
        ...historyWindow,
        {
            role: 'user',
            content: composeAgentUserMessage(turnNote, params.userMessage),
            ...(userImages.length > 0 ? { images: userImages } : {}),
        },
    ];
    // Earlier answers with no tool results behind them (guest transcripts carry
    // text only): left to choose, the model re-quotes or invents figures for a
    // "tell me more" instead of fetching. The prompt rule alone did not hold in
    // production, so the first step must call a tool. Small talk ("고마워",
    // "아 그렇구나") has nothing to fetch, so it is exempt: forcing a call there
    // only added a tool round-trip before a one-line reply. A message with images is NOT exempt: "이거 기준으로 더
    // 알려줘" with a screenshot is still a follow-up whose figures must come from a tool, not from the image or memory.
    const requireToolFirst =
        tools.length > 0 &&
        !isSmallTalkMessage(params.userMessage) &&
        historyWindow.some(m => m.role === 'assistant') &&
        !historyWindow.some(m => m.role === 'tool');

    const intermediate: AgentMessage[] = [];
    const toolsUsed: string[] = [];
    const budget = new TurnBudget();
    let usage: NormalizedUsage = {
        promptTokens: 0,
        cachedTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
    };
    let steps = 0;
    let partialText = '';

    const failure = (error: AgentErrorCode): RunAgentTurnResult => ({
        ok: false,
        error,
        turnAt,
        ...(partialText !== '' ? { partialText } : {}),
    });
    /** Caller abort wins over the deadline when both have fired. */
    const stopped = (): RunAgentTurnResult =>
        failure(params.signal?.aborted ? 'aborted' : 'deadline');

    /**
     * Daily/global counters for metered tools. Counters already consumed in
     * this gate are refunded when a later one refuses or the store is down.
     */
    const consumeToolQuota = async (
        name: string,
        metered: boolean
    ): Promise<ToolQuotaResult> => {
        const claimed: Array<[CounterStore, string]> = [];
        const claim = async (
            store: CounterStore,
            subject: string,
            limit: number
        ): Promise<boolean> => {
            // An uncapped quota needs no counter — and must not fail closed on
            // a counter-store outage for a feature that has no limit to enforce.
            if (limit === Infinity) return true;
            const ok = await store.consume(subject, limit);
            if (ok) claimed.push([store, subject]);
            return ok;
        };
        const release = async (): Promise<void> => {
            for (const [store, subject] of claimed)
                await safeRefund(store, subject);
        };
        const refuse = async (
            refusal: GateRefusal
        ): Promise<ToolQuotaResult> => {
            await release();
            return { refusal };
        };
        // Per-user daily fresh-analysis / web-search quotas are uncapped for
        // every tier today (`AGENT_LIMITS`), so `claim` returns before touching
        // those counters and the `daily` refusals below cannot fire. They stay
        // on purpose: a finite tier limit can come back by changing one number
        // in `limits.ts`, without re-plumbing counters or refusal shapes. The
        // shared Brave budget (`deps.globalLimits`, default `AGENT_GLOBAL_LIMITS`)
        // is still enforced here.
        try {
            // Deliberately keyed by tool name, not by definition metadata: the
            // per-user fresh-analysis counter is a no-op while `freshAnalysisPerDay`
            // is `Infinity`, and it moves into the tool definition in the major that
            // removes the built-in tool set.
            if (name === 'run_fresh_analysis') {
                if (
                    !(await claim(
                        counters.freshAnalysis,
                        userId,
                        agentLimit(tier, 'freshAnalysisPerDay')
                    ))
                )
                    return refuse({ error: 'quota', scope: 'daily' });
            }
            if (metered) {
                if (
                    !(await claim(
                        counters.webSearchUser,
                        userId,
                        agentLimit(tier, 'webSearchPerDay')
                    ))
                )
                    return refuse({ error: 'quota', scope: 'daily' });
                // In executor metering the shared budget is charged by the
                // executor, per billed request, not per tool call.
                if (!executorMetering) {
                    if (
                        !(await claim(
                            counters.webSearchGlobalDay,
                            GLOBAL_SUBJECT,
                            globalLimits.webSearchPerDay
                        ))
                    ) {
                        console.warn(WEB_SEARCH_BUDGET_EXHAUSTED_LOG, {
                            scope: 'global_day',
                            limit: globalLimits.webSearchPerDay,
                        });
                        return refuse({ error: 'quota', scope: 'global_day' });
                    }
                    if (
                        !(await claim(
                            counters.webSearchGlobalMonth,
                            GLOBAL_SUBJECT,
                            globalLimits.webSearchPerMonth
                        ))
                    ) {
                        console.warn(WEB_SEARCH_BUDGET_EXHAUSTED_LOG, {
                            scope: 'global_month',
                            limit: globalLimits.webSearchPerMonth,
                        });
                        return refuse({
                            error: 'quota',
                            scope: 'global_month',
                        });
                    }
                }
            }
            return {
                perUser: claimed
                    .filter(([, subject]) => subject !== GLOBAL_SUBJECT)
                    .map(([store]) => store),
            };
        } catch (error) {
            if (!(error instanceof CounterStoreUnavailableError)) {
                console.warn('[runAgentTurn] tool quota check failed', {
                    name,
                    error,
                });
            }
            return refuse({ error: 'unavailable' });
        }
    };

    /**
     * One-call claim closure for `webSearchMetering: 'executor'`. Day then
     * month, like the gate; the day unit is given back when the month refuses.
     * A unit that was claimed is never refunded afterwards (the upstream
     * request may already have been billed). The first call decides; later
     * calls replay its result so a retrying executor cannot charge twice.
     */
    const createWebSearchClaim = (
        toolName: string
    ): (() => Promise<WebSearchClaim>) => {
        let decided: Promise<WebSearchClaim> | undefined;
        const decide = async (): Promise<WebSearchClaim> => {
            if (turnSignal.aborted) {
                return { ok: false, refusal: { error: 'unavailable' } };
            }
            const claimedDay: boolean[] = [];
            try {
                if (globalLimits.webSearchPerDay !== Infinity) {
                    if (
                        !(await counters.webSearchGlobalDay.consume(
                            GLOBAL_SUBJECT,
                            globalLimits.webSearchPerDay
                        ))
                    ) {
                        console.warn(WEB_SEARCH_BUDGET_EXHAUSTED_LOG, {
                            scope: 'global_day',
                            limit: globalLimits.webSearchPerDay,
                        });
                        return {
                            ok: false,
                            refusal: { error: 'quota', scope: 'global_day' },
                        };
                    }
                    claimedDay.push(true);
                }
                if (
                    globalLimits.webSearchPerMonth !== Infinity &&
                    !(await counters.webSearchGlobalMonth.consume(
                        GLOBAL_SUBJECT,
                        globalLimits.webSearchPerMonth
                    ))
                ) {
                    if (claimedDay.length > 0) {
                        await safeRefund(
                            counters.webSearchGlobalDay,
                            GLOBAL_SUBJECT
                        );
                    }
                    console.warn(WEB_SEARCH_BUDGET_EXHAUSTED_LOG, {
                        scope: 'global_month',
                        limit: globalLimits.webSearchPerMonth,
                    });
                    return {
                        ok: false,
                        refusal: { error: 'quota', scope: 'global_month' },
                    };
                }
                return { ok: true };
            } catch (error) {
                if (!(error instanceof CounterStoreUnavailableError)) {
                    // The consumer's own name for its `meter: 'webSearch'` tool,
                    // not a hard-coded 'web_search'.
                    console.warn('[runAgentTurn] tool quota check failed', {
                        name: toolName,
                        error,
                    });
                }
                if (claimedDay.length > 0) {
                    await safeRefund(
                        counters.webSearchGlobalDay,
                        GLOBAL_SUBJECT
                    );
                }
                return { ok: false, refusal: { error: 'unavailable' } };
            }
        };
        return () => (decided ??= decide());
    };

    /** Returns the serialized tool message content. */
    const executeOne = async (call: AgentToolCall): Promise<string> => {
        const spec = toolSet.tools.find(t => t.name === call.name);
        if (spec === undefined || !params.availableTools.has(call.name)) {
            return serialize({ error: 'unknown_tool' });
        }
        const validated = validateArgs(spec.inputSchema, call.args);
        if (!validated.ok) {
            return serialize({
                error: 'invalid_args',
                issues: validated.issues,
            });
        }
        // Synchronous up to here, so parallel calls reserve in model order.
        const scope = budget.reserve(call.name, spec.perTurn, validated.value);
        if (scope !== null) return serialize({ error: 'quota', scope });
        const metered = spec.meter === 'webSearch';
        const quota = await consumeToolQuota(call.name, metered);
        if ('refusal' in quota) return serialize(quota.refusal);
        // The turn may have stopped while the counters were being claimed:
        // give the daily units back and never start the executor.
        if (turnSignal.aborted) {
            for (const store of quota.perUser) await safeRefund(store, userId);
            return serialize({ error: 'aborted' });
        }

        const estimatedSeconds = spec.estimatedSeconds?.(validated.value);
        deps.onEvent({
            type: 'tool_start',
            id: call.id,
            name: call.name,
            args: validated.value,
            ...(estimatedSeconds !== undefined ? { estimatedSeconds } : {}),
        });
        const t0 = Date.now();
        let raw: unknown;
        try {
            // Stop settles the inner race, so the outer finally clears the
            // (up to 300s) tool timer instead of leaving it armed.
            raw = await withTimeout(
                untilStopped(
                    deps.executeTool(call.name, validated.value, {
                        userId,
                        tier,
                        locale: params.locale,
                        signal: turnSignal,
                        ...(executorMetering && metered
                            ? {
                                  claimWebSearchUnit: createWebSearchClaim(
                                      call.name
                                  ),
                              }
                            : {}),
                    }),
                    turnSignal
                ),
                TOOL_TIMEOUT_MS[spec.costClass]
            );
        } catch (error) {
            raw = {
                error: 'tool_failed',
                message: error instanceof Error ? error.message : String(error),
            };
        }
        const coreStop = raw === TOOL_TIMEOUT || raw === TURN_STOPPED;
        const payload: unknown =
            raw === TOOL_TIMEOUT
                ? { error: 'timeout' }
                : raw === TURN_STOPPED
                  ? { error: 'aborted' }
                  : raw;
        const failed =
            typeof payload === 'object' &&
            payload !== null &&
            'error' in payload;
        // Executor refusals (busy, search_failed, thrown errors) give back the
        // user's daily unit. Core timeouts and turn stops keep it (the work may
        // still be running); global Brave counters are never refunded because
        // the upstream request may already have been billed.
        if (failed && !coreStop && !turnSignal.aborted) {
            for (const store of quota.perUser) await safeRefund(store, userId);
        }
        const content = serialize(localizeTimestamps(payload, timeZone));
        deps.onEvent({
            type: 'tool_end',
            id: call.id,
            name: call.name,
            status: failed ? 'error' : 'ok',
            ms: Date.now() - t0,
            summary: summarize(content),
        });
        if (!failed) toolsUsed.push(call.name);
        return content;
    };

    const deadlineTimer = setTimeout(
        () => deadline.abort(),
        AGENT_TURN_CAPS.turnDeadlineMs
    );
    try {
        for (;;) {
            if (turnSignal.aborted) return stopped();
            steps += 1;
            const lastStep = steps >= AGENT_TURN_CAPS.maxSteps;
            let stepText = '';
            const result = await untilStopped(
                deps.callAgentProvider({
                    // Key resolution (server vs BYOK) belongs to the consumer's router.
                    apiKey: '',
                    model: params.model,
                    system,
                    // Copy: the loop keeps appending after the call returns.
                    messages: [...messages],
                    tools: lastStep ? [] : tools,
                    ...(requireToolFirst && steps === 1 && !lastStep
                        ? { toolChoice: 'required' as const }
                        : {}),
                    maxOutputTokens:
                        deps.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
                    signal: turnSignal,
                    onEvent: event => {
                        // A provider that ignores the signal must not stream
                        // into a turn that has already returned.
                        if (turnSignal.aborted) return;
                        if (event.type === 'text') {
                            stepText += event.delta;
                            partialText += event.delta;
                        }
                        deps.onEvent(event);
                    },
                }),
                turnSignal
            );
            if (result === TURN_STOPPED) return stopped();
            usage = addUsage(usage, result.usage);

            if (
                result.stopReason !== 'tool_use' ||
                result.toolCalls.length === 0 ||
                lastStep
            ) {
                if (premium && deps.usageLogs !== undefined) {
                    try {
                        await deps.usageLogs.recordUsage({
                            userId,
                            // Deliberate: the agent premium quota lives in the premiumTurns counter and a UUID never collides with IP-hash counts; revisit when premium models are enabled.
                            ipHash: userId,
                            actionType: PREMIUM_MODEL_USAGE_ACTION,
                            modelUsed: params.model,
                            date: now.toISOString().slice(0, 10),
                        });
                    } catch (error) {
                        console.warn('[runAgentTurn] usage log failed', error);
                    }
                }
                const remainingOf = (
                    store: CounterStore,
                    feature: AgentPerTierLimit
                ): Promise<number | null> => {
                    const limit = agentLimit(tier, feature);
                    // `null` = uncapped. Not `Infinity`: it would serialize as
                    // `null` anyway, but only after lying in the type.
                    return limit === Infinity
                        ? Promise.resolve(null)
                        : store.remaining(userId, limit);
                };
                const [turns, fresh, search] = await Promise.all([
                    remainingOf(counters.turns, 'turnsPerDay'),
                    remainingOf(counters.freshAnalysis, 'freshAnalysisPerDay'),
                    remainingOf(counters.webSearchUser, 'webSearchPerDay'),
                ]);
                const remaining: AgentRemaining = { turns, fresh, search };
                const turnUsage: AgentTurnUsage = {
                    ...usage,
                    steps,
                    ms: Date.now() - startedAt,
                };
                return {
                    ok: true,
                    assistant: {
                        role: 'assistant',
                        content: result.text || stepText,
                    },
                    intermediate,
                    usage: turnUsage,
                    stopReason:
                        result.stopReason === 'max_tokens'
                            ? 'max_tokens'
                            : 'end',
                    remaining,
                    promptVersion: AGENT_PROMPT_VERSION,
                    toolsUsed,
                    turnAt,
                };
            }

            const assistantMessage: AgentMessage = {
                role: 'assistant',
                content: result.text,
                toolCalls: result.toolCalls,
            };
            messages.push(assistantMessage);
            intermediate.push(assistantMessage);
            const contents = await Promise.all(
                result.toolCalls.map(executeOne)
            );
            result.toolCalls.forEach((call, index) => {
                const toolMessage: AgentMessage = {
                    role: 'tool',
                    content: contents[index]!,
                    toolCallId: call.id,
                    toolName: call.name,
                };
                messages.push(toolMessage);
                intermediate.push(toolMessage);
            });
        }
    } catch (error) {
        // Only our own signal means "stopped"; an SDK AbortError without it
        // is an upstream failure and refunds like any other provider error.
        if (turnSignal.aborted) return stopped();
        const code = classifyProviderError(error);
        console.warn('[runAgentTurn] provider failed', {
            model: params.model,
            code,
            error,
        });
        await refundTurn();
        return failure(code);
    } finally {
        clearTimeout(deadlineTimer);
    }
}
