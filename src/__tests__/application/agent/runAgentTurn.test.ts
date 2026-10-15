import { afterEach, describe, expect, it, vi } from 'vitest';
import { AGENT_TURN_CAPS, TOOL_TIMEOUT_MS } from '@/application/agent/limits';
import {
    runAgentTurn,
    WEB_SEARCH_BUDGET_EXHAUSTED_LOG,
} from '@/application/agent/runAgentTurn';
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
        // Signed-in turns, fresh analyses and web search are uncapped: nothing
        // is counted and every allowance reads null (JSON-safe "no limit").
        expect(r.remaining).toEqual({ turns: null, fresh: null, search: null });
        expect(d.counters.turns.count).toBe(0);
        expect(d.events.map(e => e.type)).toEqual(['text', 'usage', 'stop']);
        expect(p.calls[0]!.messages.at(-1)).toEqual({
            role: 'user',
            content: expect.stringMatching(
                /^## Now\n[\s\S]*\n\n## Message\nAAPL 지금 얼마야\?$/
            ),
        });
        expect(p.calls[0]!.system).toContain('Answer in Korean');
    });

    /**
     * DeepSeek 컨텍스트 캐시는 바이트가 같은 접두사만 재사용한다. 시각처럼 턴마다
     * 바뀌는 값이 시스템 프롬프트에 있으면 시스템과 그 뒤 히스토리 전부가 매 턴
     * 캐시를 놓친다 — 바뀌는 값은 최신 사용자 메시지에만 실린다.
     */
    it('시스템 프롬프트와 히스토리는 턴(시각)이 바뀌어도 바이트 동일하다 — 시각은 최신 사용자 메시지에만', async () => {
        const history = [
            { role: 'user' as const, content: '엔비디아 어때?' },
            { role: 'assistant' as const, content: 'RSI 54로 중립입니다.' },
        ];
        const run = async (now: Date) => {
            const p = scriptedProvider([
                { text: 'ok', toolCalls: [], stopReason: 'end', usage: USAGE },
            ]);
            await runAgentTurn(params({ history, now }), deps(p));
            return p.calls[0]!;
        };
        const a = await run(new Date('2026-09-14T15:00:00Z')); // 월 11:00 ET
        const b = await run(new Date('2026-09-14T21:37:00Z')); // 월 17:37 ET

        expect(a.system).toBe(b.system);
        expect(a.system).not.toContain("User's local time:");
        expect(a.messages.slice(0, -1)).toEqual(history);
        expect(b.messages.slice(0, -1)).toEqual(history);
        expect(a.messages.at(-1)!.content).toContain(
            "User's local time: 2026-09-15 00:00 KST"
        );
        expect(a.messages.at(-1)!.content).toContain(
            'US regular session: open'
        );
        expect(b.messages.at(-1)!.content).toContain(
            'US regular session: closed'
        );
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

    it('도구 결과 없는 이전 답변이 있으면(게스트 이어 묻기) 첫 스텝만 도구 호출을 강제한다', async () => {
        const p = scriptedProvider([
            {
                text: '',
                toolCalls: [quoteCall],
                stopReason: 'tool_use',
                usage: USAGE,
            },
            { text: '답', toolCalls: [], stopReason: 'end', usage: USAGE },
        ]);
        await runAgentTurn(
            params({
                history: [
                    { role: 'user', content: '엔비디아 어때?' },
                    { role: 'assistant', content: 'RSI 54로 중립입니다.' },
                ],
                userMessage: '지표별 근거 자세히 알려줘',
            }),
            deps(p)
        );
        expect(p.calls.map(c => c.toolChoice)).toEqual(['required', undefined]);
    });

    it('도구 결과가 이미 있으면 도구 호출을 강제하지 않는다', async () => {
        const withTools = scriptedProvider([
            { text: '답', toolCalls: [], stopReason: 'end', usage: USAGE },
        ]);
        await runAgentTurn(
            params({
                history: [
                    { role: 'user', content: '엔비디아 어때?' },
                    {
                        role: 'assistant',
                        content: '',
                        toolCalls: [quoteCall],
                    },
                    {
                        role: 'tool',
                        content: '{"price":1}',
                        toolCallId: 'c1',
                        toolName: 'get_quote',
                    },
                    { role: 'assistant', content: '1달러입니다.' },
                ],
            }),
            deps(withTools)
        );
        expect(withTools.calls[0].toolChoice).toBeUndefined();
    });

    it('첫 질문이면 도구 호출을 강제하지 않는다', async () => {
        const first = scriptedProvider([
            { text: '답', toolCalls: [], stopReason: 'end', usage: USAGE },
        ]);
        await runAgentTurn(params(), deps(first));
        expect(first.calls[0].toolChoice).toBeUndefined();
    });

    it('도구가 없으면 첫 스텝도 도구 호출을 강제하지 않는다', async () => {
        const noTools = scriptedProvider([
            { text: '답', toolCalls: [], stopReason: 'end', usage: USAGE },
        ]);
        await runAgentTurn(
            params({
                availableTools: new Set(),
                history: [
                    { role: 'user', content: '엔비디아 어때?' },
                    { role: 'assistant', content: 'RSI 54로 중립입니다.' },
                ],
                userMessage: '지표별 근거 자세히 알려줘',
            }),
            deps(noTools)
        );
        expect(noTools.calls[0].toolChoice).toBeUndefined();
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
            {
                role: 'user',
                content: expect.stringMatching(
                    /## Message\nAAPL 지금 얼마야\?$/
                ),
            },
            ...r.intermediate,
        ]);
        // 같은 턴의 두 번째 호출도 첫 호출과 접두사가 같다(같은 노트, 같은 시스템).
        expect(p.calls[1]!.messages[0]).toEqual(p.calls[0]!.messages[0]);
        expect(p.calls[1]!.system).toBe(p.calls[0]!.system);
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

    it('run_fresh_analysis는 턴당 상한까지 실행·일일 한도 소비, 초과분은 quota 오류', async () => {
        const cap = AGENT_TURN_CAPS.maxFreshAnalysis;
        const fresh = (id: string) => ({
            id,
            name: 'run_fresh_analysis',
            args: { symbol: 'AAPL', kind: 'technical' },
        });
        const p = scriptedProvider([
            {
                text: '',
                toolCalls: Array.from({ length: cap + 1 }, (_, i) =>
                    fresh(`f${i}`)
                ),
                stopReason: 'tool_use',
                usage: USAGE,
            },
            { text: 'ok', toolCalls: [], stopReason: 'end', usage: USAGE },
        ]);
        const d = deps(p);
        await runAgentTurn(params(), d);
        expect(d.executeTool).toHaveBeenCalledTimes(cap);
        // Uncapped daily quota: no counter is touched at all.
        expect(d.counters.freshAnalysis.count).toBe(0);
        expect(toolResults(p.calls[1]!)[cap]).toEqual({
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

    it('게스트(free): 턴은 하루 한도로 세고, 새 분석·웹 검색은 제한 없이 실행한다', async () => {
        const p = scriptedProvider([
            {
                text: '',
                toolCalls: [
                    {
                        id: 'f1',
                        name: 'run_fresh_analysis',
                        args: { symbol: 'AAPL', kind: 'technical' },
                    },
                    { id: 'w1', name: 'web_search', args: { query: 'x' } },
                ],
                stopReason: 'tool_use',
                usage: USAGE,
            },
            { text: 'ok', toolCalls: [], stopReason: 'end', usage: USAGE },
        ]);
        const d = deps(p);
        const r = await runAgentTurn(params({ tier: 'free' }), d);
        expect(r.ok).toBe(true);
        expect(d.executeTool).toHaveBeenCalledTimes(2);
        expect(d.counters.turns.count).toBe(1);
        expect(r.ok && r.remaining.turns).toBe(9);
        // Only the shared Brave budget is still counted.
        expect(d.counters.webSearchGlobalDay.count).toBe(1);
        expect(p.calls[0]!.system).toContain('The user is not logged in');
        expect(p.calls[0]!.system).toContain(
            'Their own holdings need logging in'
        );
    });

    it.each([
        ['webSearchGlobalDay', 'global_day'],
        ['webSearchGlobalMonth', 'global_month'],
    ] as const)(
        '공용 검색 예산(%s) 소진 → 운영자 알람용 마커를 남긴다',
        async (counter, scope) => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
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
            d.counters[counter] = memoryCounter(0);
            await runAgentTurn(params(), d);
            expect(toolResults(p.calls[1]!)).toEqual([
                { error: 'quota', scope },
            ]);
            expect(warn).toHaveBeenCalledWith(
                WEB_SEARCH_BUDGET_EXHAUSTED_LOG,
                expect.objectContaining({ scope })
            );
        }
    );

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
    });

    it('신선 분석은 일일 한도가 없어 카운터 장애와 무관하게 실행된다', async () => {
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
        expect(d.executeTool).toHaveBeenCalledTimes(1);
    });

    it('턴당 심볼 상한 초과 → quota per_turn_symbols', async () => {
        const cap = AGENT_TURN_CAPS.maxDistinctSymbols;
        const letters = Array.from({ length: cap + 1 }, (_, i) =>
            String.fromCharCode(65 + i)
        );
        const many = letters.map((s, i) => ({
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
        expect(d.executeTool).toHaveBeenCalledTimes(cap);
        expect(d.executeTool).not.toHaveBeenCalledWith(
            'get_options_summary',
            { symbol: letters[cap] },
            expect.anything()
        );
        expect(toolResults(p.calls[1]!)[cap]).toEqual({
            error: 'quota',
            scope: 'per_turn_symbols',
        });
    });

    it('턴당 툴 호출 상한 초과 → quota per_turn_tools', async () => {
        const cap = AGENT_TURN_CAPS.maxToolCalls;
        const nine = Array.from({ length: cap + 1 }, (_, i) => ({
            ...quoteCall,
            id: `q${i}`,
        }));
        const p = scriptedProvider([
            { text: '', toolCalls: nine, stopReason: 'tool_use', usage: USAGE },
            { text: 'ok', toolCalls: [], stopReason: 'end', usage: USAGE },
        ]);
        const d = deps(p);
        await runAgentTurn(params(), d);
        expect(d.executeTool).toHaveBeenCalledTimes(cap);
        expect(toolResults(p.calls[1]!)[cap]).toEqual({
            error: 'quota',
            scope: 'per_turn_tools',
        });
    });

    it('툴 결과의 ISO 시각은 사용자 시간대로 바뀐 채 모델에 전달된다', async () => {
        const p = scriptedProvider([
            {
                text: '',
                toolCalls: [quoteCall],
                stopReason: 'tool_use',
                usage: USAGE,
            },
            { text: 'ok', toolCalls: [], stopReason: 'end', usage: USAGE },
        ]);
        const d = deps(p, {
            executeTool: vi.fn(async () => ({
                price: 332.27,
                asOf: '2026-09-11T21:42:00.000Z',
            })),
        });
        await runAgentTurn(params({ timeZone: 'America/Los_Angeles' }), d);
        expect(toolResults(p.calls[1]!)).toEqual([
            { price: 332.27, asOf: '2026-09-11 14:42 PDT' },
        ]);
        expect(p.calls[0]!.messages.at(-1)!.content).toContain(
            "User's local time: 2026-"
        );
        expect(p.calls[0]!.messages.at(-1)!.content).toMatch(/ P[DS]T\n/);
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

    it('한 스텝에서 web_search 상한+1회 → 초과분은 per_turn quota, 실행기는 상한까지만', async () => {
        const cap = AGENT_TURN_CAPS.maxWebSearch;
        const search = (id: string) => ({
            id,
            name: 'web_search',
            args: { query: 'x' },
        });
        const p = scriptedProvider([
            {
                text: '',
                toolCalls: Array.from({ length: cap + 1 }, (_, i) =>
                    search(`w${i}`)
                ),
                stopReason: 'tool_use',
                usage: USAGE,
            },
            { text: 'ok', toolCalls: [], stopReason: 'end', usage: USAGE },
        ]);
        const d = deps(p);
        await runAgentTurn(params(), d);
        expect(d.executeTool).toHaveBeenCalledTimes(cap);
        expect(toolResults(p.calls[1]!)[cap]).toEqual({
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
        const steps = AGENT_TURN_CAPS.maxSteps;
        const p = scriptedProvider(
            Array.from({ length: steps + 1 }, () => ({ ...loop }))
        );
        const d = deps(p);
        const r = await runAgentTurn(params(), d);
        expect(r.ok).toBe(true);
        expect(r.ok && r.stopReason).toBe('end');
        expect(p.call).toHaveBeenCalledTimes(steps);
        expect(p.calls[0]!.tools.length).toBeGreaterThan(0);
        expect(p.calls[steps - 1]!.tools).toEqual([]);
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
        // get_quote is costClass 'free' — advance past that class's ceiling.
        await vi.advanceTimersByTimeAsync(TOOL_TIMEOUT_MS.free + 1);
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
        const r = await runAgentTurn(params({ tier: 'free' }), d);
        expect(r).toEqual({ ok: false, error: 'turn_limit' });
        expect(p.call).not.toHaveBeenCalled();
    });

    it('무제한 턴(member)은 턴 카운터 장애와 무관하게 정상 완료된다 — 세지 않으므로 server_busy가 아니다', async () => {
        const p = scriptedProvider([
            { text: 'ok', toolCalls: [], stopReason: 'end', usage: USAGE },
        ]);
        const d = deps(p);
        d.counters.turns = unavailableCounter();
        d.counters.freshAnalysis = unavailableCounter();
        d.counters.webSearchUser = unavailableCounter();
        const r = await runAgentTurn(params({ tier: 'member' }), d);
        expect(r.ok).toBe(true);
        expect(r.ok && r.remaining).toEqual({
            turns: null,
            fresh: null,
            search: null,
        });
        expect(p.call).toHaveBeenCalledTimes(1);
    });

    it('턴 카운터 장애 → server_busy, 프로바이더 미호출', async () => {
        const p = scriptedProvider([]);
        const d = deps(p);
        d.counters.turns = unavailableCounter();
        const r = await runAgentTurn(params({ tier: 'free' }), d);
        expect(r).toEqual({ ok: false, error: 'server_busy' });
        expect(p.call).not.toHaveBeenCalled();
    });

    it('회원 모델은 premium 카운터도 소비, 초과 시 turns를 되돌린다', async () => {
        const p = scriptedProvider([]);
        const d = deps(p);
        d.counters.premiumTurns = memoryCounter(0);
        const r = await runAgentTurn(
            params({ tier: 'free', model: 'claude-sonnet-5-5' }),
            d
        );
        expect(r).toEqual({ ok: false, error: 'premium_turn_limit' });
        expect(d.counters.turns.count).toBe(0);
    });

    it('premium 카운터 장애 → server_busy, turns 환불', async () => {
        const p = scriptedProvider([]);
        const d = deps(p);
        d.counters.premiumTurns = unavailableCounter();
        const r = await runAgentTurn(
            params({ tier: 'free', model: 'claude-sonnet-5-5' }),
            d
        );
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
        const r = await runAgentTurn(params({ model: 'claude-sonnet-5-5' }), d);
        expect(r.ok).toBe(true);
        expect(recordUsage).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 'u1',
                actionType: 'premium_model',
                modelUsed: 'claude-sonnet-5-5',
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
        const r = await runAgentTurn(params({ model: 'claude-sonnet-5-5' }), d);
        expect(r.ok).toBe(true);
    });

    it('프로바이더 429 → rate_limited + 턴 환불', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const p = failingProvider(
            Object.assign(new Error('rl'), { status: 429 })
        );
        const d = deps(p);
        // `free` so the turn is actually counted and the refund is observable.
        const r = await runAgentTurn(params({ tier: 'free' }), d);
        expect(r).toEqual({ ok: false, error: 'rate_limited' });
        expect(d.counters.turns.count).toBe(0);
    });

    it('프리미엄 모델 턴의 프로바이더 실패 → premium 카운터 환불(pro: 턴은 무제한, premium은 유한)', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const p = failingProvider(
            Object.assign(new Error('rl'), { status: 429 })
        );
        const d = deps(p);
        const r = await runAgentTurn(
            params({ tier: 'pro', model: 'claude-sonnet-5-5' }),
            d
        );
        expect(r).toEqual({ ok: false, error: 'rate_limited' });
        expect(d.counters.premiumTurns.count).toBe(0);
        expect(d.counters.turns.count).toBe(0);
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
        const r = await runAgentTurn(
            params({ tier: 'free', signal: controller.signal }),
            d
        );
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
        const r = await runAgentTurn(
            params({ tier: 'free', signal: controller.signal }),
            d
        );
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
        const pending = runAgentTurn(params({ tier: 'free' }), d);
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
        const r = await runAgentTurn(
            params({ tier: 'free', signal: controller.signal }),
            d
        );
        expect(r).toEqual({ ok: false, error: 'aborted' });
        expect(p.call).toHaveBeenCalledTimes(1);
        expect(d.counters.turns.count).toBe(1);
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

    it('쿼터 소비 중 abort → 실행기 미호출, 유저 일일 카운터 환불', async () => {
        const controller = new AbortController();
        const p = scriptedProvider([
            {
                text: '',
                toolCalls: [
                    { id: 'w1', name: 'web_search', args: { query: 'x' } },
                ],
                stopReason: 'tool_use',
                usage: USAGE,
            },
        ]);
        const d = deps(p);
        const month = d.counters.webSearchGlobalMonth;
        const consume = month.consume.bind(month);
        month.consume = async (subject, limit) => {
            const ok = await consume(subject, limit);
            controller.abort();
            return ok;
        };
        const r = await runAgentTurn(params({ signal: controller.signal }), d);
        expect(r).toEqual({ ok: false, error: 'aborted' });
        expect(d.executeTool).not.toHaveBeenCalled();
        expect(d.counters.webSearchUser.count).toBe(0);
        expect(d.events.some(e => e.type === 'tool_start')).toBe(false);
    });

    it('우리 시그널이 abort되지 않은 SDK AbortError → server_error + 턴 환불', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const p = failingProvider(
            Object.assign(new Error('aborted'), { name: 'AbortError' })
        );
        const d = deps(p);
        const r = await runAgentTurn(params({ tier: 'free' }), d);
        expect(r).toEqual({ ok: false, error: 'server_error' });
        expect(d.counters.turns.count).toBe(0);
    });

    it('web_search 실행 실패 → 유저 일일 한도는 무제한이라 소비되지 않고, 전역 카운터는 유지', async () => {
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

    it('웹 검색 타임아웃 → 공용 검색 예산은 소비된 채 유지(요청이 이미 나갔을 수 있음)', async () => {
        vi.useFakeTimers();
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
        const d = deps(p, { executeTool: () => new Promise(() => {}) });
        const pending = runAgentTurn(params(), d);
        await vi.advanceTimersByTimeAsync(TOOL_TIMEOUT_MS.external + 1);
        const r = await pending;
        expect(r.ok).toBe(true);
        expect(toolResults(p.calls[1]!)).toEqual([{ error: 'timeout' }]);
        expect(d.counters.webSearchGlobalDay.count).toBe(1);
        expect(d.counters.webSearchGlobalMonth.count).toBe(1);
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
