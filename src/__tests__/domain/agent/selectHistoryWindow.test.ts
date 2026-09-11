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
});
