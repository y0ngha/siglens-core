import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAgentTurn } from '@/application/agent/runAgentTurn';
import type {
    AgentCounters,
    AgentTurnEvent,
    RunAgentTurnDependencies,
    RunAgentTurnParams,
} from '@/application/agent/types';
import type {
    AgentProviderResult,
    CallAgentProviderOptions,
} from '@/domain/ports/agentProvider';
import type { CounterStore } from '@/domain/ports/counterStore';
import { CounterStoreUnavailableError } from '@/domain/ports/counterStore';
import { AGENT_PROMPT_VERSION } from '@/domain/agent/buildAgentSystemPrompt';

const USAGE = {
    promptTokens: 10,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 5,
};

type MemoryCounter = CounterStore & { count: number };

function memoryCounter(limit = Infinity): MemoryCounter {
    const store = {
        count: 0,
        async consume(_s: string, l: number) {
            if (store.count + 1 > Math.min(l, limit)) return false;
            store.count += 1;
            return true;
        },
        async refund() {
            // No clamp: a double refund must surface as a negative count.
            store.count -= 1;
        },
        async remaining(_s: string, l: number) {
            return Math.max(0, Math.min(l, limit) - store.count);
        },
    };
    return store;
}

/** Counter whose `consume` rejects like a fail-closed store during an outage. */
function unavailableCounter(): MemoryCounter {
    const store = memoryCounter();
    store.consume = async () => {
        throw new CounterStoreUnavailableError('test');
    };
    return store;
}

type MemoryCounters = { [K in keyof AgentCounters]: MemoryCounter };

function counters(): MemoryCounters {
    return {
        turns: memoryCounter(),
        premiumTurns: memoryCounter(),
        freshAnalysis: memoryCounter(),
        webSearchUser: memoryCounter(),
        webSearchGlobalDay: memoryCounter(),
        webSearchGlobalMonth: memoryCounter(),
    };
}

/** Scripted provider: each call pops the next result; emits text deltas for `.text`. */
function scriptedProvider(script: AgentProviderResult[]) {
    const calls: CallAgentProviderOptions[] = [];
    const call = vi.fn(async (o: CallAgentProviderOptions) => {
        calls.push(o);
        const next = script.shift();
        if (!next) throw new Error('script exhausted');
        if (next.text) o.onEvent({ type: 'text', delta: next.text });
        for (const c of next.toolCalls)
            o.onEvent({ type: 'tool_call', call: c });
        o.onEvent({ type: 'usage', usage: next.usage });
        o.onEvent({ type: 'stop', reason: next.stopReason });
        return next;
    });
    return { call, calls };
}

const quoteCall = { id: 'c1', name: 'get_quote', args: { symbols: ['AAPL'] } };

function params(
    overrides: Partial<RunAgentTurnParams> = {}
): RunAgentTurnParams {
    return {
        userId: 'u1',
        tier: 'member',
        model: 'deepseek-v4.1-flash',
        locale: 'ko',
        history: [],
        userMessage: 'AAPL 지금 얼마야?',
        availableTools: new Set([
            'search_ticker',
            'get_quote',
            'get_bars_indicators',
            'get_cached_analysis',
            'get_news',
            'get_options_summary',
            'get_my_portfolio',
            'run_fresh_analysis',
            'web_search',
        ]),
        now: new Date('2026-09-12T14:30:00Z'),
        ...overrides,
    };
}

function deps(
    provider: Pick<ReturnType<typeof scriptedProvider>, 'call'>,
    overrides: Partial<Omit<RunAgentTurnDependencies, 'counters'>> = {}
): RunAgentTurnDependencies & {
    events: AgentTurnEvent[];
    counters: MemoryCounters;
} {
    const events: AgentTurnEvent[] = [];
    return {
        callAgentProvider: provider.call,
        executeTool: vi.fn(async (name: string) => ({
            tool: name,
            price: 231.42,
            symbol: 'AAPL',
        })),
        counters: counters(),
        onEvent: e => events.push(e),
        events,
        ...overrides,
    };
}

function toolResults(options: CallAgentProviderOptions): unknown[] {
    return options.messages
        .filter(m => m.role === 'tool')
        .map(m => JSON.parse(m.content));
}

function failingProvider(error: unknown) {
    return {
        call: vi.fn(async (): Promise<AgentProviderResult> => {
            throw error;
        }),
    };
}

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('runAgentTurn', () => {
    it('툴 없이 끝나는 턴: 1 호출, 텍스트 스트림, 턴 1 소비, 잔여 계산', async () => {
        const p = scriptedProvider([
            { text: '안녕', toolCalls: [], stopReason: 'end', usage: USAGE },
        ]);
        const d = deps(p);
        const r = await runAgentTurn(params(), d);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.assistant).toEqual({ role: 'assistant', content: '안녕' });
        expect(r.intermediate).toEqual([]);
        expect(r.usage.steps).toBe(1);
        expect(r.promptVersion).toBe(AGENT_PROMPT_VERSION);
        expect(r.remaining).toEqual({ turns: 59, fresh: 6, search: 5 });
        expect(d.counters.turns.count).toBe(1);
        expect(d.events.map(e => e.type)).toEqual(['text', 'usage', 'stop']);
        expect(p.calls[0]!.messages.at(-1)).toEqual({
            role: 'user',
            content: 'AAPL 지금 얼마야?',
        });
        expect(p.calls[0]!.system).toContain('Answer in Korean');
    });

    it('portfolioSymbols는 시스템 프롬프트에 들어간다', async () => {
        const p = scriptedProvider([
            { text: 'ok', toolCalls: [], stopReason: 'end', usage: USAGE },
        ]);
        await runAgentTurn(
            params({ portfolioSymbols: ['MSFT', '005930.KS'] }),
            deps(p)
        );
        expect(p.calls[0]!.system).toContain('MSFT, 005930.KS');
    });

    it('툴 1회 왕복: 실행 결과가 tool 메시지로 다음 호출에 들어간다', async () => {
        const p = scriptedProvider([
            {
                text: '',
                toolCalls: [quoteCall],
                stopReason: 'tool_use',
                usage: USAGE,
            },
            {
                text: '231.42달러입니다',
                toolCalls: [],
                stopReason: 'end',
                usage: USAGE,
            },
        ]);
        const d = deps(p);
        const r = await runAgentTurn(params(), d);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(d.executeTool).toHaveBeenCalledWith(
            'get_quote',
            { symbols: ['AAPL'] },
            expect.objectContaining({ userId: 'u1' })
        );
        expect(r.intermediate).toEqual([
            { role: 'assistant', content: '', toolCalls: [quoteCall] },
            {
                role: 'tool',
                content: JSON.stringify({
                    tool: 'get_quote',
                    price: 231.42,
                    symbol: 'AAPL',
                }),
                toolCallId: 'c1',
                toolName: 'get_quote',
            },
        ]);
        expect(p.calls[1]!.messages.slice(-3)).toEqual([
            { role: 'user', content: 'AAPL 지금 얼마야?' },
            ...r.intermediate,
        ]);
        expect(r.usage.steps).toBe(2);
        expect(r.usage.promptTokens).toBe(20);
        expect(r.toolsUsed).toEqual(['get_quote']);
        const types = d.events.map(e => e.type);
        expect(types).toContain('tool_start');
        expect(types).toContain('tool_end');
    });

    it('스키마 위반 인자는 실행하지 않고 오류를 tool 결과로 돌려준다', async () => {
        const bad = { id: 'c1', name: 'get_quote', args: { symbol: 'AAPL' } };
        const p = scriptedProvider([
            {
                text: '',
                toolCalls: [bad],
                stopReason: 'tool_use',
                usage: USAGE,
            },
            { text: 'ok', toolCalls: [], stopReason: 'end', usage: USAGE },
        ]);
        const d = deps(p);
        const r = await runAgentTurn(params(), d);
        expect(r.ok).toBe(true);
        expect(d.executeTool).not.toHaveBeenCalled();
        expect(toolResults(p.calls[1]!)[0]).toMatchObject({
            error: 'invalid_args',
        });
    });

    it('미지 툴 이름 → unknown_tool', async () => {
        const p = scriptedProvider([
            {
                text: '',
                toolCalls: [{ id: 'c1', name: 'nope', args: {} }],
                stopReason: 'tool_use',
                usage: USAGE,
            },
            { text: 'ok', toolCalls: [], stopReason: 'end', usage: USAGE },
        ]);
        await runAgentTurn(params(), deps(p));
        expect(toolResults(p.calls[1]!)).toEqual([{ error: 'unknown_tool' }]);
    });

    it('병렬 툴 호출은 동시에 실행되고 순서대로 append', async () => {
        const calls = [
            quoteCall,
            { id: 'c2', name: 'get_news', args: { symbol: 'AAPL' } },
        ];
        const p = scriptedProvider([
            {
                text: '',
                toolCalls: calls,
                stopReason: 'tool_use',
                usage: USAGE,
            },
            { text: 'ok', toolCalls: [], stopReason: 'end', usage: USAGE },
        ]);
        let inFlight = 0;
        let maxInFlight = 0;
        // The first call finishes last, so append order can't come from completion order.
        const d = deps(p, {
            executeTool: vi.fn(async (name: string) => {
                inFlight += 1;
                maxInFlight = Math.max(maxInFlight, inFlight);
                await new Promise(resolve =>
                    setTimeout(resolve, name === 'get_quote' ? 20 : 1)
                );
                inFlight -= 1;
                return { tool: name };
            }),
        });
        const r = await runAgentTurn(params(), d);
        if (!r.ok) throw new Error('expected ok');
        expect(maxInFlight).toBe(2);
        expect(
            r.intermediate.filter(m => m.role === 'tool').map(m => m.toolCallId)
        ).toEqual(['c1', 'c2']);
    });

    it('run_fresh_analysis는 턴당 1회·일일 한도 소비, 두 번째는 quota 오류', async () => {
        const fresh = (id: string) => ({
            id,
            name: 'run_fresh_analysis',
            args: { symbol: 'AAPL', kind: 'technical' },
        });
        const p = scriptedProvider([
            {
                text: '',
                toolCalls: [fresh('f1'), fresh('f2')],
                stopReason: 'tool_use',
                usage: USAGE,
            },
            { text: 'ok', toolCalls: [], stopReason: 'end', usage: USAGE },
        ]);
        const d = deps(p);
        await runAgentTurn(params(), d);
        expect(d.executeTool).toHaveBeenCalledTimes(1);
        expect(d.counters.freshAnalysis.count).toBe(1);
        expect(toolResults(p.calls[1]!)[1]).toEqual({
            error: 'quota',
            scope: 'per_turn',
        });
        const start = d.events.find(
            e => e.type === 'tool_start' && e.name === 'run_fresh_analysis'
        );
        expect(
            start && 'estimatedSeconds' in start ? start.estimatedSeconds : 0
        ).toBeGreaterThan(0);
    });

    it('web_search는 유저·전역 일·전역 월 카운터를 모두 소비하고 하나라도 막히면 quota', async () => {
        const p = scriptedProvider([
            {
                text: '',
                toolCalls: [
                    { id: 'w1', name: 'web_search', args: { query: 'x' } },
                ],
                stopReason: 'tool_use',
                usage: USAGE,
            },
            { text: 'ok', toolCalls: [], stopReason: 'end', usage: USAGE },
        ]);
        const d = deps(p);
        d.counters.webSearchGlobalMonth = memoryCounter(0);
        await runAgentTurn(params(), d);
        expect(d.executeTool).not.toHaveBeenCalled();
        expect(toolResults(p.calls[1]!)).toEqual([
            { error: 'quota', scope: 'global_month' },
        ]);
        expect(d.counters.webSearchUser.count).toBe(0);
        expect(d.counters.webSearchGlobalDay.count).toBe(0);
    });

    it('web_search 전역 카운터 장애 → unavailable, 유저 카운터 환불, 턴은 계속', async () => {
        const p = scriptedProvider([
            {
                text: '',
                toolCalls: [
                    { id: 'w1', name: 'web_search', args: { query: 'x' } },
                ],
                stopReason: 'tool_use',
                usage: USAGE,
            },
            { text: 'ok', toolCalls: [], stopReason: 'end', usage: USAGE },
        ]);
        const d = deps(p);
        d.counters.webSearchGlobalDay = unavailableCounter();
        const r = await runAgentTurn(params(), d);
        expect(r.ok).toBe(true);
        expect(d.executeTool).not.toHaveBeenCalled();
        expect(toolResults(p.calls[1]!)).toEqual([{ error: 'unavailable' }]);
        expect(d.counters.webSearchUser.count).toBe(0);
        expect(d.counters.turns.count).toBe(1);
    });

    it('신선 분석 일일 카운터 장애 → unavailable', async () => {
        const p = scriptedProvider([
            {
                text: '',
                toolCalls: [
                    {
                        id: 'f1',
                        name: 'run_fresh_analysis',
                        args: { symbol: 'AAPL', kind: 'news' },
                    },
                ],
                stopReason: 'tool_use',
                usage: USAGE,
            },
            { text: 'ok', toolCalls: [], stopReason: 'end', usage: USAGE },
        ]);
        const d = deps(p);
        d.counters.freshAnalysis = unavailableCounter();
        const r = await runAgentTurn(params(), d);
        expect(r.ok).toBe(true);
        expect(d.executeTool).not.toHaveBeenCalled();
        expect(toolResults(p.calls[1]!)).toEqual([{ error: 'unavailable' }]);
    });

    it('턴당 심볼 3개 초과 → quota per_turn_symbols', async () => {
        const many = ['A', 'B', 'C', 'D'].map((s, i) => ({
            id: `q${i}`,
            name: 'get_options_summary',
            args: { symbol: s },
        }));
        const p = scriptedProvider([
            { text: '', toolCalls: many, stopReason: 'tool_use', usage: USAGE },
            { text: 'ok', toolCalls: [], stopReason: 'end', usage: USAGE },
        ]);
        const d = deps(p);
        await runAgentTurn(params(), d);
        expect(d.executeTool).toHaveBeenCalledTimes(3);
        expect(d.executeTool).not.toHaveBeenCalledWith(
            'get_options_summary',
            { symbol: 'D' },
            expect.anything()
        );
        expect(toolResults(p.calls[1]!)[3]).toEqual({
            error: 'quota',
            scope: 'per_turn_symbols',
        });
    });

    it('턴당 툴 호출 8회 초과 → quota per_turn_tools', async () => {
        const nine = Array.from({ length: 9 }, (_, i) => ({
            ...quoteCall,
            id: `q${i}`,
        }));
        const p = scriptedProvider([
            { text: '', toolCalls: nine, stopReason: 'tool_use', usage: USAGE },
            { text: 'ok', toolCalls: [], stopReason: 'end', usage: USAGE },
        ]);
        const d = deps(p);
        await runAgentTurn(params(), d);
        expect(d.executeTool).toHaveBeenCalledTimes(8);
        expect(toolResults(p.calls[1]!)[8]).toEqual({
            error: 'quota',
            scope: 'per_turn_tools',
        });
    });

    it('실행 결과가 순환 참조/BigInt면 직렬화 실패를 unserializable_result로 돌려준다', async () => {
        const p = scriptedProvider([
            {
                text: '',
                toolCalls: [quoteCall],
                stopReason: 'tool_use',
                usage: USAGE,
            },
            { text: 'ok', toolCalls: [], stopReason: 'end', usage: USAGE },
        ]);
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        const d = deps(p, {
            executeTool: vi.fn(async () => circular),
        });
        await runAgentTurn(params(), d);
        expect(toolResults(p.calls[1]!)).toEqual([
            { error: 'unserializable_result' },
        ]);
    });

    it('한 스텝에서 web_search 3회 → 세 번째는 per_turn quota, 실행기는 최대 2회', async () => {
        const search = (id: string) => ({
            id,
            name: 'web_search',
            args: { query: 'x' },
        });
        const p = scriptedProvider([
            {
                text: '',
                toolCalls: [search('w1'), search('w2'), search('w3')],
                stopReason: 'tool_use',
                usage: USAGE,
            },
            { text: 'ok', toolCalls: [], stopReason: 'end', usage: USAGE },
        ]);
        const d = deps(p);
        await runAgentTurn(params(), d);
        expect(d.executeTool).toHaveBeenCalledTimes(2);
        expect(toolResults(p.calls[1]!)[2]).toEqual({
            error: 'quota',
            scope: 'per_turn',
        });
    });

    it('MAX_STEPS 초과 시 마지막 스텝은 tools 없이 호출되고 종료(stopReason end)', async () => {
        const loop = {
            text: '',
            toolCalls: [quoteCall],
            stopReason: 'tool_use' as const,
            usage: USAGE,
        };
        const p = scriptedProvider(
            Array.from({ length: 7 }, () => ({ ...loop }))
        );
        const d = deps(p);
        const r = await runAgentTurn(params(), d);
        expect(r.ok).toBe(true);
        expect(r.ok && r.stopReason).toBe('end');
        expect(p.call).toHaveBeenCalledTimes(6);
        expect(p.calls[0]!.tools.length).toBeGreaterThan(0);
        expect(p.calls[5]!.tools).toEqual([]);
    });

    it('툴 타임아웃 → {error:"timeout"}', async () => {
        vi.useFakeTimers();
        const p = scriptedProvider([
            {
                text: '',
                toolCalls: [quoteCall],
                stopReason: 'tool_use',
                usage: USAGE,
            },
            { text: 'ok', toolCalls: [], stopReason: 'end', usage: USAGE },
        ]);
        const d = deps(p, { executeTool: () => new Promise(() => {}) });
        const pending = runAgentTurn(params(), d);
        await vi.advanceTimersByTimeAsync(10_001);
        const r = await pending;
        expect(r.ok).toBe(true);
        expect(toolResults(p.calls[1]!)).toEqual([{ error: 'timeout' }]);
    });

    it('executeTool이 undefined를 반환해도 tool 메시지 content는 문자열', async () => {
        const p = scriptedProvider([
            {
                text: '',
                toolCalls: [quoteCall],
                stopReason: 'tool_use',
                usage: USAGE,
            },
            { text: 'ok', toolCalls: [], stopReason: 'end', usage: USAGE },
        ]);
        const d = deps(p, { executeTool: vi.fn(async () => undefined) });
        const r = await runAgentTurn(params(), d);
        if (!r.ok) throw new Error('expected ok');
        expect(r.intermediate[1]!.content).toBe('null');
    });

    it('일일 턴 한도 초과 → turn_limit, 프로바이더 미호출', async () => {
        const p = scriptedProvider([]);
        const d = deps(p);
        d.counters.turns = memoryCounter(0);
        const r = await runAgentTurn(params(), d);
        expect(r).toEqual({ ok: false, error: 'turn_limit' });
        expect(p.call).not.toHaveBeenCalled();
    });

    it('턴 카운터 장애 → server_busy, 프로바이더 미호출', async () => {
        const p = scriptedProvider([]);
        const d = deps(p);
        d.counters.turns = unavailableCounter();
        const r = await runAgentTurn(params(), d);
        expect(r).toEqual({ ok: false, error: 'server_busy' });
        expect(p.call).not.toHaveBeenCalled();
    });

    it('회원 모델은 premium 카운터도 소비, 초과 시 turns를 되돌린다', async () => {
        const p = scriptedProvider([]);
        const d = deps(p);
        d.counters.premiumTurns = memoryCounter(0);
        const r = await runAgentTurn(params({ model: 'claude-sonnet-5' }), d);
        expect(r).toEqual({ ok: false, error: 'premium_turn_limit' });
        expect(d.counters.turns.count).toBe(0);
    });

    it('premium 카운터 장애 → server_busy, turns 환불', async () => {
        const p = scriptedProvider([]);
        const d = deps(p);
        d.counters.premiumTurns = unavailableCounter();
        const r = await runAgentTurn(params({ model: 'claude-sonnet-5' }), d);
        expect(r).toEqual({ ok: false, error: 'server_busy' });
        expect(d.counters.turns.count).toBe(0);
        expect(p.call).not.toHaveBeenCalled();
    });

    it('회원 모델 턴은 premium_model 사용 로그를 남기고, 로그 실패는 무시한다', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const p = scriptedProvider([
            { text: 'ok', toolCalls: [], stopReason: 'end', usage: USAGE },
        ]);
        const recordUsage = vi.fn(async () => {
            throw new Error('db down');
        });
        const d = deps(p, { usageLogs: { recordUsage } });
        const r = await runAgentTurn(params({ model: 'claude-sonnet-5' }), d);
        expect(r.ok).toBe(true);
        expect(recordUsage).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 'u1',
                actionType: 'premium_model',
                modelUsed: 'claude-sonnet-5',
                date: '2026-09-12',
            })
        );
        expect(d.counters.premiumTurns.count).toBe(1);
    });

    it('deps.maxOutputTokens가 프로바이더 호출에 그대로 전달된다', async () => {
        const p = scriptedProvider([
            { text: 'ok', toolCalls: [], stopReason: 'end', usage: USAGE },
        ]);
        const d = deps(p, { maxOutputTokens: 1234 });
        await runAgentTurn(params(), d);
        expect(p.calls[0]!.maxOutputTokens).toBe(1234);
    });

    it('회원 모델 성공 + usageLogs 미주입 → ok, 예외 없음', async () => {
        const p = scriptedProvider([
            { text: 'ok', toolCalls: [], stopReason: 'end', usage: USAGE },
        ]);
        const d = deps(p, { usageLogs: undefined });
        const r = await runAgentTurn(params({ model: 'claude-sonnet-5' }), d);
        expect(r.ok).toBe(true);
    });

    it('프로바이더 429 → rate_limited + 턴 환불', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const p = failingProvider(
            Object.assign(new Error('rl'), { status: 429 })
        );
        const d = deps(p);
        const r = await runAgentTurn(params({ model: 'claude-sonnet-5' }), d);
        expect(r).toEqual({ ok: false, error: 'rate_limited' });
        expect(d.counters.turns.count).toBe(0);
        expect(d.counters.premiumTurns.count).toBe(0);
    });

    it('abort → aborted, 부분 텍스트 반환, 환불 없음', async () => {
        const controller = new AbortController();
        const p = {
            call: vi.fn(
                async (
                    o: CallAgentProviderOptions
                ): Promise<AgentProviderResult> => {
                    o.onEvent({ type: 'text', delta: '부분' });
                    controller.abort();
                    throw Object.assign(new Error('aborted'), {
                        name: 'AbortError',
                    });
                }
            ),
        };
        const d = deps(p);
        const r = await runAgentTurn(params({ signal: controller.signal }), d);
        expect(r).toEqual({ ok: false, error: 'aborted', partialText: '부분' });
        expect(d.counters.turns.count).toBe(1);
    });

    it('툴 실행 중 abort → 다음 프로바이더 호출 없이 aborted', async () => {
        const controller = new AbortController();
        const p = scriptedProvider([
            {
                text: '확인 중',
                toolCalls: [quoteCall],
                stopReason: 'tool_use',
                usage: USAGE,
            },
            { text: 'ok', toolCalls: [], stopReason: 'end', usage: USAGE },
        ]);
        const d = deps(p, {
            executeTool: vi.fn(async () => {
                controller.abort();
                return { error: 'aborted' };
            }),
        });
        const r = await runAgentTurn(params({ signal: controller.signal }), d);
        expect(r).toEqual({
            ok: false,
            error: 'aborted',
            partialText: '확인 중',
        });
        expect(p.call).toHaveBeenCalledTimes(1);
        expect(d.counters.turns.count).toBe(1);
    });

    it('턴 마감 타이머: 응답 없는 프로바이더 → deadline, 환불 없음', async () => {
        vi.useFakeTimers();
        let providerSignal: AbortSignal | undefined;
        const p = {
            call: vi.fn((o: CallAgentProviderOptions) => {
                providerSignal = o.signal;
                return new Promise<AgentProviderResult>(() => {});
            }),
        };
        const d = deps(p);
        const pending = runAgentTurn(params(), d);
        await vi.advanceTimersByTimeAsync(600_001);
        const r = await pending;
        expect(r).toEqual({ ok: false, error: 'deadline' });
        expect(providerSignal?.aborted).toBe(true);
        expect(d.counters.turns.count).toBe(1);
    });

    it('시그널을 무시하는 툴 실행 중 abort → 300초를 기다리지 않고 aborted', async () => {
        const controller = new AbortController();
        const p = scriptedProvider([
            {
                text: '',
                toolCalls: [
                    {
                        id: 'f1',
                        name: 'run_fresh_analysis',
                        args: { symbol: 'AAPL', kind: 'overall' },
                    },
                ],
                stopReason: 'tool_use',
                usage: USAGE,
            },
            { text: 'ok', toolCalls: [], stopReason: 'end', usage: USAGE },
        ]);
        const d = deps(p, {
            executeTool: vi.fn(() => {
                setTimeout(() => controller.abort(), 5);
                return new Promise<unknown>(() => {});
            }),
        });
        const r = await runAgentTurn(params({ signal: controller.signal }), d);
        expect(r).toEqual({ ok: false, error: 'aborted' });
        expect(p.call).toHaveBeenCalledTimes(1);
        expect(d.counters.turns.count).toBe(1);
        expect(d.counters.freshAnalysis.count).toBe(1);
    });

    it('시그널을 무시하는 프로바이더가 abort 후 보낸 이벤트는 전달되지 않는다', async () => {
        const controller = new AbortController();
        let lateEmitted = false;
        const p = {
            call: vi.fn((o: CallAgentProviderOptions) => {
                setTimeout(() => controller.abort(), 1);
                setTimeout(() => {
                    o.onEvent({ type: 'text', delta: 'late' });
                    lateEmitted = true;
                }, 10);
                return new Promise<AgentProviderResult>(() => {});
            }),
        };
        const d = deps(p);
        const r = await runAgentTurn(params({ signal: controller.signal }), d);
        expect(r).toEqual({ ok: false, error: 'aborted' });
        await vi.waitFor(() => expect(lateEmitted).toBe(true));
        expect(d.events).toEqual([]);
    });

    it('쿼터 소비 중 abort → 실행기 미호출, 신선 분석 카운터 환불', async () => {
        const controller = new AbortController();
        const p = scriptedProvider([
            {
                text: '',
                toolCalls: [
                    {
                        id: 'f1',
                        name: 'run_fresh_analysis',
                        args: { symbol: 'AAPL', kind: 'technical' },
                    },
                ],
                stopReason: 'tool_use',
                usage: USAGE,
            },
        ]);
        const d = deps(p);
        const fresh = d.counters.freshAnalysis;
        const consume = fresh.consume.bind(fresh);
        fresh.consume = async (subject, limit) => {
            const ok = await consume(subject, limit);
            controller.abort();
            return ok;
        };
        const r = await runAgentTurn(params({ signal: controller.signal }), d);
        expect(r).toEqual({ ok: false, error: 'aborted' });
        expect(d.executeTool).not.toHaveBeenCalled();
        expect(fresh.count).toBe(0);
        expect(d.events.some(e => e.type === 'tool_start')).toBe(false);
    });

    it('우리 시그널이 abort되지 않은 SDK AbortError → server_error + 턴 환불', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const p = failingProvider(
            Object.assign(new Error('aborted'), { name: 'AbortError' })
        );
        const d = deps(p);
        const r = await runAgentTurn(params(), d);
        expect(r).toEqual({ ok: false, error: 'server_error' });
        expect(d.counters.turns.count).toBe(0);
    });

    it('실행기 거절(run_fresh_analysis busy) → 신선 분석 일일 카운터 환불', async () => {
        const p = scriptedProvider([
            {
                text: '',
                toolCalls: [
                    {
                        id: 'f1',
                        name: 'run_fresh_analysis',
                        args: { symbol: 'AAPL', kind: 'technical' },
                    },
                ],
                stopReason: 'tool_use',
                usage: USAGE,
            },
            { text: 'ok', toolCalls: [], stopReason: 'end', usage: USAGE },
        ]);
        const d = deps(p, {
            executeTool: vi.fn(async () => ({ error: 'busy' })),
        });
        await runAgentTurn(params(), d);
        expect(d.counters.freshAnalysis.count).toBe(0);
    });

    it('web_search 실행 실패 → 유저 카운터만 환불, 전역 카운터는 유지', async () => {
        const p = scriptedProvider([
            {
                text: '',
                toolCalls: [
                    { id: 'w1', name: 'web_search', args: { query: 'x' } },
                ],
                stopReason: 'tool_use',
                usage: USAGE,
            },
            { text: 'ok', toolCalls: [], stopReason: 'end', usage: USAGE },
        ]);
        const d = deps(p, {
            executeTool: vi.fn(async () => ({ error: 'search_failed' })),
        });
        await runAgentTurn(params(), d);
        expect(d.counters.webSearchUser.count).toBe(0);
        expect(d.counters.webSearchGlobalDay.count).toBe(1);
        expect(d.counters.webSearchGlobalMonth.count).toBe(1);
    });

    it('신선 분석 타임아웃 → 일일 카운터는 소비된 채 유지', async () => {
        vi.useFakeTimers();
        const p = scriptedProvider([
            {
                text: '',
                toolCalls: [
                    {
                        id: 'f1',
                        name: 'run_fresh_analysis',
                        args: { symbol: 'AAPL', kind: 'overall' },
                    },
                ],
                stopReason: 'tool_use',
                usage: USAGE,
            },
            { text: 'ok', toolCalls: [], stopReason: 'end', usage: USAGE },
        ]);
        const d = deps(p, { executeTool: () => new Promise(() => {}) });
        const pending = runAgentTurn(params(), d);
        await vi.advanceTimersByTimeAsync(300_001);
        const r = await pending;
        expect(r.ok).toBe(true);
        expect(toolResults(p.calls[1]!)).toEqual([{ error: 'timeout' }]);
        expect(d.counters.freshAnalysis.count).toBe(1);
    });

    it('max_tokens 종료는 ok + stopReason max_tokens', async () => {
        const p = scriptedProvider([
            {
                text: '잘린',
                toolCalls: [],
                stopReason: 'max_tokens',
                usage: USAGE,
            },
        ]);
        const r = await runAgentTurn(params(), deps(p));
        expect(r.ok && r.stopReason).toBe('max_tokens');
    });
});
