import {
    AGENT_PROMPT_VERSION,
    buildAgentSystemPrompt,
    buildAgentTurnContext,
    composeAgentUserMessage,
} from '@/domain/agent/buildAgentSystemPrompt';
import { selectHistoryWindow } from '@/domain/agent/selectHistoryWindow';
import {
    findToolSpec,
    isFreshAnalysisKind,
    selectTools,
    type FreshAnalysisKind,
} from '@/domain/agent/tools';
import {
    localizeTimestamps,
    resolveAgentTimeZone,
} from '@/domain/agent/userTimeZone';
import { validateArgs } from '@/domain/agent/validateArgs';
import type { AgentMessage, AgentToolCall } from '@/domain/ports/agentProvider';
import {
    CounterStoreUnavailableError,
    type CounterStore,
} from '@/domain/ports/counterStore';
import { isPremiumModel } from '@/domain/tier';
import type { NormalizedUsage } from '@/domain/types';
import { getEtSessionStatus } from '@/domain/utils';
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
} from './types';

const DEFAULT_MAX_OUTPUT_TOKENS = 4_096;
const HISTORY_WINDOW = {
    turns: 8,
    toolResultTurns: 2,
    budgetTokens: 32_000,
    // Drop old turns 4 at a time instead of 1 per turn, so the window's head —
    // and with it the cached prefix — holds still for 4 turns at a stretch.
    stride: 4,
} as const;
/** Measured medians (spec §4-2) surfaced to the UI as a progress hint. */
const FRESH_ANALYSIS_ESTIMATED_SECONDS: Record<FreshAnalysisKind, number> = {
    technical: 40,
    overall: 120,
    news: 90,
    options: 60,
};
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

/** Per-turn budget: caps from `AGENT_TURN_CAPS`, all pure and local to one turn. */
class TurnBudget {
    private toolCalls = 0;
    private webSearches = 0;
    private freshRuns = 0;
    private readonly symbols = new Set<string>();

    /** Returns a quota scope when the call must be refused, else null. */
    reserve(name: string, args: Record<string, unknown>): string | null {
        if (this.toolCalls >= AGENT_TURN_CAPS.maxToolCalls)
            return 'per_turn_tools';
        if (
            name === 'web_search' &&
            this.webSearches >= AGENT_TURN_CAPS.maxWebSearch
        )
            return 'per_turn';
        if (
            name === 'run_fresh_analysis' &&
            this.freshRuns >= AGENT_TURN_CAPS.maxFreshAnalysis
        )
            return 'per_turn';
        const next = new Set(this.symbols);
        for (const s of symbolsOf(args)) next.add(s);
        if (next.size > AGENT_TURN_CAPS.maxDistinctSymbols)
            return 'per_turn_symbols';
        this.toolCalls += 1;
        if (name === 'web_search') this.webSearches += 1;
        if (name === 'run_fresh_analysis') this.freshRuns += 1;
        for (const s of next) this.symbols.add(s);
        return null;
    }
}

/**
 * One agent turn (spec §4-2): consume quota → build prompt/window → loop
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
    const tools = selectTools(params.availableTools);
    const timeZone = resolveAgentTimeZone(params.timeZone, params.locale);
    // Prefix-cache layout (DeepSeek caches the longest byte-identical request
    // prefix): system prompt → tool defs → history are stable across turns;
    // everything that changes per turn (the clock, the session status) rides
    // on the latest user message only. The consumer persists the plain
    // `userMessage`, so next turn this message is history without the note.
    const system = buildAgentSystemPrompt({
        locale: params.locale,
        tools,
        portfolioSymbols: params.portfolioSymbols,
        guest: tier === 'free',
    });
    const turnContext = buildAgentTurnContext({
        locale: params.locale,
        now,
        timeZone,
        etSessionStatus: getEtSessionStatus(now),
    });
    const historyWindow = selectHistoryWindow(params.history, HISTORY_WINDOW);
    const messages: AgentMessage[] = [
        ...historyWindow,
        {
            role: 'user',
            content: composeAgentUserMessage(turnContext, params.userMessage),
        },
    ];
    // Earlier answers with no tool results behind them (guest transcripts carry
    // text only): left to choose, the model re-quotes or invents figures for a
    // "tell me more" instead of fetching. The prompt rule alone did not hold in
    // production, so the first step must call a tool.
    const requireToolFirst =
        tools.length > 0 &&
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
        ...(partialText !== '' ? { partialText } : {}),
    });
    /** Caller abort wins over the deadline when both have fired. */
    const stopped = (): RunAgentTurnResult =>
        failure(params.signal?.aborted ? 'aborted' : 'deadline');

    /**
     * Daily/global counters for metered tools. Counters already consumed in
     * this gate are refunded when a later one refuses or the store is down.
     */
    const consumeToolQuota = async (name: string): Promise<ToolQuotaResult> => {
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
        // shared Brave budget (`AGENT_GLOBAL_LIMITS`) is still enforced here.
        try {
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
            if (name === 'web_search') {
                if (
                    !(await claim(
                        counters.webSearchUser,
                        userId,
                        agentLimit(tier, 'webSearchPerDay')
                    ))
                )
                    return refuse({ error: 'quota', scope: 'daily' });
                if (
                    !(await claim(
                        counters.webSearchGlobalDay,
                        GLOBAL_SUBJECT,
                        AGENT_GLOBAL_LIMITS.webSearchPerDay
                    ))
                ) {
                    console.warn(WEB_SEARCH_BUDGET_EXHAUSTED_LOG, {
                        scope: 'global_day',
                        limit: AGENT_GLOBAL_LIMITS.webSearchPerDay,
                    });
                    return refuse({ error: 'quota', scope: 'global_day' });
                }
                if (
                    !(await claim(
                        counters.webSearchGlobalMonth,
                        GLOBAL_SUBJECT,
                        AGENT_GLOBAL_LIMITS.webSearchPerMonth
                    ))
                ) {
                    console.warn(WEB_SEARCH_BUDGET_EXHAUSTED_LOG, {
                        scope: 'global_month',
                        limit: AGENT_GLOBAL_LIMITS.webSearchPerMonth,
                    });
                    return refuse({ error: 'quota', scope: 'global_month' });
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

    /** Returns the serialized tool message content. */
    const executeOne = async (call: AgentToolCall): Promise<string> => {
        const spec = findToolSpec(call.name);
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
        const scope = budget.reserve(call.name, validated.value);
        if (scope !== null) return serialize({ error: 'quota', scope });
        const quota = await consumeToolQuota(call.name);
        if ('refusal' in quota) return serialize(quota.refusal);
        // The turn may have stopped while the counters were being claimed:
        // give the daily units back and never start the executor.
        if (turnSignal.aborted) {
            for (const store of quota.perUser) await safeRefund(store, userId);
            return serialize({ error: 'aborted' });
        }

        const kind = validated.value.kind;
        const estimatedSeconds =
            call.name === 'run_fresh_analysis' && isFreshAnalysisKind(kind)
                ? FRESH_ANALYSIS_ESTIMATED_SECONDS[kind]
                : undefined;
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
                    // Key resolution (server vs BYOK) belongs to the consumer's router (spec §5).
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
