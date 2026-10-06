import { describe, expect, it } from 'vitest';
import {
    estimateTokens,
    selectHistoryWindow,
} from '@/domain/agent/selectHistoryWindow';
import type { AgentMessage } from '@/domain/ports/agentProvider';

function turn(i: number, withTool = false): AgentMessage[] {
    const msgs: AgentMessage[] = [{ role: 'user', content: `q${i}` }];
    if (withTool) {
        msgs.push({
            role: 'assistant',
            content: '',
            toolCalls: [
                { id: `c${i}`, name: 'get_quote', args: { symbols: ['AAPL'] } },
            ],
        });
        msgs.push({
            role: 'tool',
            content: JSON.stringify({ symbol: 'AAPL', price: 1 }),
            toolCallId: `c${i}`,
            toolName: 'get_quote',
        });
    }
    msgs.push({ role: 'assistant', content: `a${i}` });
    return msgs;
}

describe('selectHistoryWindow', () => {
    it('최근 8턴만 남긴다', () => {
        const history = Array.from({ length: 12 }, (_, i) => turn(i)).flat();
        const out = selectHistoryWindow(history, {
            turns: 8,
            toolResultTurns: 2,
            budgetTokens: 32_000,
        });
        expect(out[0]).toEqual({ role: 'user', content: 'q4' });
        expect(out.filter(m => m.role === 'user')).toHaveLength(8);
    });

    it('툴 결과는 최근 2턴만 원문, 그 이전은 omitted 마커', () => {
        const history = Array.from({ length: 4 }, (_, i) =>
            turn(i, true)
        ).flat();
        const out = selectHistoryWindow(history, {
            turns: 8,
            toolResultTurns: 2,
            budgetTokens: 32_000,
        });
        const tools = out.filter(m => m.role === 'tool');
        expect(tools).toHaveLength(4);
        expect(JSON.parse(tools[0].content)).toEqual({
            omitted: true,
            tool: 'get_quote',
            symbol: 'AAPL',
        });
        expect(JSON.parse(tools[3].content)).toEqual({
            symbol: 'AAPL',
            price: 1,
        });
        // tool_call/tool 쌍은 유지된다(프로바이더가 짝 없는 tool 메시지를 거부)
        expect(out.some(m => m.toolCalls?.[0]?.id === 'c0')).toBe(true);
    });

    it('오래된 턴의 툴 결과가 JSON이 아니면 symbol 없이 omitted 마커만 남긴다', () => {
        const history: AgentMessage[] = [
            { role: 'user', content: 'q0' },
            {
                role: 'assistant',
                content: '',
                toolCalls: [
                    {
                        id: 'c0',
                        name: 'get_quote',
                        args: { symbols: ['AAPL'] },
                    },
                ],
            },
            {
                role: 'tool',
                content: 'not json',
                toolCallId: 'c0',
                toolName: 'get_quote',
            },
            { role: 'assistant', content: 'a0' },
            ...turn(1, true),
            ...turn(2, true),
        ];
        const out = selectHistoryWindow(history, {
            turns: 8,
            toolResultTurns: 2,
            budgetTokens: 32_000,
        });
        const tools = out.filter(m => m.role === 'tool');
        const marker = JSON.parse(tools[0].content) as Record<string, unknown>;
        expect(marker).toEqual({ omitted: true, tool: 'get_quote' });
        expect('symbol' in marker).toBe(false);
    });

    it('토큰 예산 초과 시 오래된 턴부터 탈락', () => {
        const big = 'x'.repeat(3_000);
        const history = Array.from({ length: 6 }, (_, i) => [
            { role: 'user' as const, content: `${big}${i}` },
            { role: 'assistant' as const, content: 'a' },
        ]).flat();
        const out = selectHistoryWindow(history, {
            turns: 8,
            toolResultTurns: 2,
            budgetTokens: 2_500,
        });
        expect(out.filter(m => m.role === 'user')).toHaveLength(2);
        expect(out[0].content.endsWith('4')).toBe(true);
    });

    it('estimateTokens는 ASCII는 chars/3, 비ASCII는 1.2/char로 올림', () => {
        expect(estimateTokens('abcdef')).toBe(2);
        expect(estimateTokens('')).toBe(0);
        expect(estimateTokens('삼성전자')).toBe(5);
    });

    it('첫 유저 메시지 이전의 고아 조각(툴 응답 등)은 버린다', () => {
        const leading: AgentMessage[] = [
            {
                role: 'assistant',
                content: '',
                toolCalls: [
                    { id: 'x', name: 'get_quote', args: { symbols: ['AAPL'] } },
                ],
            },
            {
                role: 'tool',
                content: JSON.stringify({ symbol: 'AAPL', price: 1 }),
                toolCallId: 'x',
                toolName: 'get_quote',
            },
            { role: 'assistant', content: 'orphan-reply' },
        ];
        const history = [...leading, ...turn(0)];
        const out = selectHistoryWindow(history, {
            turns: 8,
            toolResultTurns: 2,
            budgetTokens: 32_000,
        });
        expect(out[0].role).toBe('user');
        expect(out.some(m => m.content === 'orphan-reply')).toBe(false);
        expect(out.some(m => m.role === 'tool' && m.toolCallId === 'x')).toBe(
            false
        );
    });

    it('turns:0이면 빈 배열', () => {
        const history = turn(0);
        const out = selectHistoryWindow(history, {
            turns: 0,
            toolResultTurns: 2,
            budgetTokens: 32_000,
        });
        expect(out).toEqual([]);
    });

    describe('stride — 오래된 턴을 묶음으로 떨군다(접두사 캐시 보존)', () => {
        const opts = {
            turns: 8,
            toolResultTurns: 2,
            budgetTokens: 32_000,
            stride: 4,
        };
        const firstUser = (count: number) =>
            selectHistoryWindow(
                Array.from({ length: count }, (_, i) => turn(i)).flat(),
                opts
            )[0];

        it('turns 이하일 때는 전부 남긴다', () => {
            expect(firstUser(8)).toEqual({ role: 'user', content: 'q0' });
        });

        it('창의 첫 턴은 stride 턴 동안 고정되고, 그다음 stride만큼 한 번에 넘어간다', () => {
            for (const count of [9, 10, 11]) {
                expect(firstUser(count)).toEqual({
                    role: 'user',
                    content: 'q0',
                });
            }
            for (const count of [12, 13, 14, 15]) {
                expect(firstUser(count)).toEqual({
                    role: 'user',
                    content: 'q4',
                });
            }
            expect(firstUser(16)).toEqual({ role: 'user', content: 'q8' });
        });

        it('남는 턴 수는 turns 이상 turns + stride - 1 이하다', () => {
            for (let count = 8; count <= 20; count++) {
                const kept = selectHistoryWindow(
                    Array.from({ length: count }, (_, i) => turn(i)).flat(),
                    opts
                ).filter(m => m.role === 'user').length;
                expect(kept).toBeGreaterThanOrEqual(8);
                expect(kept).toBeLessThanOrEqual(11);
            }
        });

        it('턴이 늘어도 stride 구간 안에서는 앞쪽 메시지가 바이트 동일하다', () => {
            const at = (count: number) =>
                selectHistoryWindow(
                    Array.from({ length: count }, (_, i) =>
                        turn(i, true)
                    ).flat(),
                    opts
                );
            const before = at(9);
            const after = at(10);
            // 도구 결과는 최근 2턴만 원문 — 그 앞(q0..q6)은 두 창에서 같다.
            const stableUntil = before.findIndex(m => m.content === 'q7');
            expect(after.slice(0, stableUntil)).toEqual(
                before.slice(0, stableUntil)
            );
        });

        it('stride가 1 미만이면 1로 취급한다(기존 동작)', () => {
            const history = Array.from({ length: 12 }, (_, i) =>
                turn(i)
            ).flat();
            const out = selectHistoryWindow(history, { ...opts, stride: 0 });
            expect(out[0]).toEqual({ role: 'user', content: 'q4' });
        });
    });
});
