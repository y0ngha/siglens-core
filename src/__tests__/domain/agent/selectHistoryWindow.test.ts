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

describe('selectHistoryWindow — toolResultStride', () => {
    const BASE = { turns: 8, toolResultTurns: 2, budgetTokens: 32_000 };
    const fullHistory = (count: number): AgentMessage[] =>
        Array.from({ length: count }, (_, i) => turn(i, true)).flat();

    /** Verbatim tool results of one window, as the turn numbers that keep them. */
    const verbatimTurns = (out: readonly AgentMessage[]): number[] =>
        out
            .filter(
                m =>
                    m.role === 'tool' &&
                    !(JSON.parse(m.content) as { omitted?: boolean }).omitted
            )
            .map(m => Number(m.toolCallId?.slice(1)));

    it('toolResultStride 2: 2 or 3 turns stay verbatim, and the boundary moves only at even turn counts', () => {
        const firstVerbatim = Array.from({ length: 7 }, (_, k) => k + 2).map(
            count => {
                const out = selectHistoryWindow(fullHistory(count), {
                    ...BASE,
                    toolResultStride: 2,
                });
                const verbatim = verbatimTurns(out);
                expect(verbatim.at(-1)).toBe(count - 1);
                expect([2, 3]).toContain(verbatim.length);
                return verbatim[0];
            }
        );
        // counts 2..8: boundary = floor((count - 2) / 2) * 2
        expect(firstVerbatim).toEqual([0, 0, 2, 2, 4, 4, 6]);
    });

    it("toolResultStride 1 keeps today's rolling boundary", () => {
        const out = selectHistoryWindow(fullHistory(5), BASE);
        expect(verbatimTurns(out)).toEqual([3, 4]);
    });

    it('a turn that already flipped to omitted never turns verbatim again as turns are added', () => {
        const flipped = (count: number): number[] => {
            const out = selectHistoryWindow(fullHistory(count), {
                ...BASE,
                toolResultStride: 2,
            });
            return out
                .filter(
                    m =>
                        m.role === 'tool' &&
                        (JSON.parse(m.content) as { omitted?: boolean }).omitted
                )
                .map(m => Number(m.toolCallId?.slice(1)));
        };
        // Turn 0 flips when the count reaches 4; each later count only adds to the set.
        expect(flipped(3)).toEqual([]);
        expect(flipped(4)).toEqual([0, 1]);
        expect(flipped(5)).toEqual([0, 1]);
        expect(flipped(6)).toEqual([0, 1, 2, 3]);
    });

    const bigTool = (i: number): AgentMessage[] => [
        { role: 'user', content: `q${i}` },
        {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: `c${i}`, name: 'get_quote', args: {} }],
        },
        {
            role: 'tool',
            content: JSON.stringify({
                symbol: 'AAPL',
                text: 'x'.repeat(2_900),
            }),
            toolCallId: `c${i}`,
            toolName: 'get_quote',
        },
        { role: 'assistant', content: `a${i}` },
    ];

    it('under budget pressure the window falls back to exactly toolResultTurns verbatim turns', () => {
        const history = Array.from({ length: 5 }, (_, i) => bigTool(i)).flat();
        const roomy = selectHistoryWindow(history, {
            ...BASE,
            toolResultStride: 2,
        });
        expect(verbatimTurns(roomy)).toEqual([2, 3, 4]);
        // Three verbatim results (~1000 tokens each) do not fit, two do.
        const tight = selectHistoryWindow(history, {
            ...BASE,
            budgetTokens: 2_500,
            toolResultStride: 2,
        });
        expect(verbatimTurns(tight)).toEqual([3, 4]);
        expect(tight.filter(m => m.role === 'user')).toHaveLength(5);
    });

    describe('block drop with a window stride', () => {
        /** ~970 tokens per turn whatever the tool-result shape. */
        const bigText = (i: number): AgentMessage[] => [
            { role: 'user', content: `q${i}` },
            { role: 'assistant', content: 'x'.repeat(2_900) },
        ];
        const turnsOf = (count: number): AgentMessage[] =>
            Array.from({ length: count }, (_, i) => bigText(i)).flat();
        const windowed = {
            turns: 4,
            toolResultTurns: 2,
            stride: 2,
            toolResultStride: 2,
        };
        const firstQuestion = (
            out: readonly AgentMessage[]
        ): string | undefined => out.find(m => m.role === 'user')?.content;

        it('drops whole stride blocks, so the head stays on a stride multiple', () => {
            // Window head 6 (turns 6..9, ~3,900 tokens): one drop is needed and
            // it removes a block of two (head 8), not a single turn.
            const out = selectHistoryWindow(turnsOf(10), {
                ...windowed,
                budgetTokens: 3_500,
            });
            expect(firstQuestion(out)).toBe('q8');
        });

        it('a rolling window (stride 1) drops one turn at a time instead', () => {
            const out = selectHistoryWindow(turnsOf(10), {
                ...windowed,
                stride: 1,
                budgetTokens: 3_500,
            });
            expect(firstQuestion(out)).toBe('q7');
        });

        it('always keeps the last turn, even over budget', () => {
            const out = selectHistoryWindow(turnsOf(10), {
                ...windowed,
                budgetTokens: 10,
            });
            expect(firstQuestion(out)).toBe('q9');
            expect(out.filter(m => m.role === 'user')).toHaveLength(1);
        });

        it('an odd turn count still drops to the next stride multiple', () => {
            // 11 turns, turns 4, stride 2: head 6, kept 6..10 (~4,850 tokens).
            const out = selectHistoryWindow(turnsOf(11), {
                ...windowed,
                budgetTokens: 3_500,
            });
            expect(firstQuestion(out)).toBe('q8');
        });
    });

    it.each([0, -3, 1.5])(
        'stride and toolResultStride %s behave as 1',
        value => {
            const history = fullHistory(12);
            const reference = selectHistoryWindow(history, {
                ...BASE,
                stride: 1,
                toolResultStride: 1,
            });
            expect(
                selectHistoryWindow(history, {
                    ...BASE,
                    stride: value,
                    toolResultStride: value,
                })
            ).toEqual(reference);
        }
    );
});

describe('selectHistoryWindow — keepSmallToolResults', () => {
    const BASE = { turns: 8, toolResultTurns: 2, budgetTokens: 32_000 };
    const KEEP = { maxChars: 1_400, perTurnChars: 3_000 };

    /** A turn with one tool row per entry of `sizes` (content length in chars). */
    const sizedTurn = (i: number, sizes: readonly number[]): AgentMessage[] => [
        { role: 'user', content: `q${i}` },
        {
            role: 'assistant',
            content: '',
            toolCalls: sizes.map((_, k) => ({
                id: `c${i}_${k}`,
                name: 'get_quote',
                args: {},
            })),
        },
        ...sizes.map((size, k): AgentMessage => ({
            role: 'tool',
            content: JSON.stringify({
                symbol: 'AAPL',
                pad: 'x'.repeat(size - 26),
            }),
            toolCallId: `c${i}_${k}`,
            toolName: 'get_quote',
        })),
        { role: 'assistant', content: `a${i}` },
    ];
    const transcript = (
        count: number,
        sizes: (i: number) => readonly number[]
    ): AgentMessage[] =>
        Array.from({ length: count }, (_, i) => sizedTurn(i, sizes(i))).flat();
    const isOmitted = (m: AgentMessage): boolean =>
        (JSON.parse(m.content) as { omitted?: boolean }).omitted === true;
    const toolRows = (out: readonly AgentMessage[]): AgentMessage[] =>
        out.filter(m => m.role === 'tool');

    it('small rows stay verbatim for every transcript length 1..16', () => {
        for (let n = 1; n <= 16; n++) {
            const history = transcript(n, () => [500]);
            const out = selectHistoryWindow(history, {
                ...BASE,
                keepSmallToolResults: KEEP,
            });
            const rows = toolRows(out);
            expect(rows.length).toBeGreaterThan(0);
            expect(rows.some(isOmitted)).toBe(false);
            // Verbatim means the very same message as in the transcript.
            for (const row of rows) {
                expect(history).toContainEqual(row);
            }
        }
    });

    it('without the option small old rows are still markers', () => {
        const out = selectHistoryWindow(
            transcript(6, () => [500]),
            BASE
        );
        expect(toolRows(out).filter(isOmitted)).toHaveLength(4);
    });

    it('a row over maxChars becomes a marker, the exact limit stays', () => {
        const out = selectHistoryWindow(
            transcript(5, i => (i === 0 ? [1_400] : i === 1 ? [1_401] : [100])),
            { ...BASE, keepSmallToolResults: KEEP }
        );
        const rows = toolRows(out);
        expect(rows.map(isOmitted)).toEqual([false, true, false, false, false]);
    });

    it('the per-turn cap is applied in transcript order and a later smaller row can still fit', () => {
        // 1400 + 1400 = 2800 fits; the third 1400 would make 4200 > 3000 -> marker;
        // the trailing 200 still fits (3000 total exactly).
        const out = selectHistoryWindow(
            transcript(5, i => (i === 0 ? [1_400, 1_400, 1_400, 200] : [100])),
            { ...BASE, keepSmallToolResults: KEEP }
        );
        const first = toolRows(out).slice(0, 4);
        expect(first.map(isOmitted)).toEqual([false, false, true, false]);
        // The kept rows total at most perTurnChars.
        expect(
            first
                .filter(m => !isOmitted(m))
                .reduce((s, m) => s + m.content.length, 0)
        ).toBeLessThanOrEqual(KEEP.perTurnChars);
    });

    it('a turn decides from its own rows only: appending later turns never changes an earlier turn', () => {
        // Deterministic pseudo-random sizes, so the property runs over many shapes.
        let seed = 7;
        const rand = (): number => {
            seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
            return seed / 2_147_483_648;
        };
        for (let trial = 0; trial < 25; trial++) {
            const sizeTable = Array.from({ length: 16 }, () =>
                Array.from({ length: 1 + Math.floor(rand() * 4) }, () =>
                    Math.floor(100 + rand() * 1_500)
                )
            );
            const history = transcript(16, i => sizeTable[i]);
            for (let n = 1; n < 16; n++) {
                // Wide window and a big budget: only the omit rule differs.
                const opts = {
                    turns: 16,
                    toolResultTurns: 1,
                    budgetTokens: 1_000_000,
                    keepSmallToolResults: KEEP,
                };
                const shortOut = selectHistoryWindow(
                    transcript(n, i => sizeTable[i]),
                    opts
                );
                const longOut = selectHistoryWindow(history, opts);
                // Turns 0..n-2 are old in both runs; their bytes must agree.
                const cut = shortOut.findIndex(m => m.content === `q${n - 1}`);
                expect(longOut.slice(0, cut)).toEqual(shortOut.slice(0, cut));
            }
        }
    });

    it('adds no cache break point: the prefix breaks only at turns where it already broke without the option', () => {
        const opts = {
            turns: 8,
            toolResultTurns: 2,
            budgetTokens: 1_000_000,
            stride: 4,
            toolResultStride: 2,
        };
        const sizes = (i: number): number[] => [300 + (i % 3) * 600, 900];
        const breaks = (keep: boolean): number[] => {
            const result: number[] = [];
            for (let n = 1; n < 20; n++) {
                const run = (count: number): AgentMessage[] =>
                    selectHistoryWindow(transcript(count, sizes), {
                        ...opts,
                        ...(keep ? { keepSmallToolResults: KEEP } : {}),
                    });
                const prev = run(n);
                const next = run(n + 1);
                const preserved = prev.every(
                    (m, k) => JSON.stringify(m) === JSON.stringify(next[k])
                );
                if (!preserved) result.push(n + 1);
            }
            return result;
        };
        const withKeep = breaks(true);
        // The documented flip turns: the boundary moves at even turn counts only.
        expect(withKeep.every(count => count % 2 === 0)).toBe(true);
        // Kept rows never flip, so some flips become invisible; none is new.
        const without = breaks(false);
        expect(withKeep.every(count => without.includes(count))).toBe(true);
    });

    /** Token count by the function's own measure: content plus JSON toolCalls. */
    const tokensOf = (out: readonly AgentMessage[]): number =>
        out.reduce(
            (sum, m) =>
                sum +
                estimateTokens(m.content) +
                (m.toolCalls ? estimateTokens(JSON.stringify(m.toolCalls)) : 0),
            0
        );
    const users = (out: readonly AgentMessage[]): number =>
        out.filter(m => m.role === 'user').length;

    it('under budget pressure the kept extras revert to markers before any turn is dropped', () => {
        const history = transcript(6, () => [1_400, 1_400]);
        const withExtras = tokensOf(
            selectHistoryWindow(history, {
                ...BASE,
                keepSmallToolResults: KEEP,
            })
        );
        const plain = selectHistoryWindow(history, BASE);
        const plainTokens = tokensOf(plain);
        expect(withExtras).toBeGreaterThan(plainTokens);
        // A budget between the two: extras do not fit, but every turn does.
        const budgetTokens = Math.floor((withExtras + plainTokens) / 2);
        const out = selectHistoryWindow(history, {
            ...BASE,
            budgetTokens,
            keepSmallToolResults: KEEP,
        });
        expect(tokensOf(out)).toBeLessThanOrEqual(budgetTokens);
        expect(users(out)).toBe(6);
        expect(toolRows(out).filter(isOmitted)).toHaveLength(8);
        expect(out).toEqual(plain);
    });

    describe('budget pressure with stride 4 and toolResultStride 2', () => {
        // 7 turns: head 0, block boundary turn 4, exact boundary turn 5.
        // Each turn: one small row (kept when old) and one big row (verbatim
        // only inside the verbatim turns).
        const history = transcript(7, () => [1_000, 3_000]);
        const WIDE = {
            turns: 8,
            toolResultTurns: 2,
            stride: 4,
            toolResultStride: 2,
            budgetTokens: 1_000_000,
        };
        const exact = { ...WIDE, toolResultStride: 1 };
        const keep = { keepSmallToolResults: KEEP };
        const blockKeep = tokensOf(
            selectHistoryWindow(history, { ...WIDE, ...keep })
        );
        const exactKeep = tokensOf(
            selectHistoryWindow(history, { ...exact, ...keep })
        );
        const blockOff = tokensOf(selectHistoryWindow(history, WIDE));
        const exactOff = tokensOf(selectHistoryWindow(history, exact));

        it('the fixture orders the four shapes as the cases below assume', () => {
            expect(blockKeep).toBeGreaterThan(exactKeep);
            expect(exactKeep).toBeGreaterThan(blockOff);
            expect(blockOff).toBeGreaterThan(exactOff);
        });

        it('block+keep over but exact+keep fits: falls back to exact+keep, extras kept', () => {
            const out = selectHistoryWindow(history, {
                ...WIDE,
                budgetTokens: exactKeep,
                ...keep,
            });
            expect(out).toEqual(
                selectHistoryWindow(history, { ...exact, ...keep })
            );
            expect(tokensOf(out)).toBeLessThanOrEqual(exactKeep);
        });

        it('exact+keep over: extras revert and the block boundary is decided again, as with the option off', () => {
            // blockOff fits here, exactKeep does not.
            const budgetTokens = blockOff;
            expect(exactKeep).toBeGreaterThan(budgetTokens);
            const off = selectHistoryWindow(history, { ...WIDE, budgetTokens });
            const out = selectHistoryWindow(history, {
                ...WIDE,
                budgetTokens,
                ...keep,
            });
            expect(out).toEqual(off);
            expect(tokensOf(out)).toBeLessThanOrEqual(budgetTokens);
        });

        it('so tight that the option off drops turns: the option on drops the same turns', () => {
            const budgetTokens = exactOff - 100;
            const off = selectHistoryWindow(history, { ...WIDE, budgetTokens });
            const out = selectHistoryWindow(history, {
                ...WIDE,
                budgetTokens,
                ...keep,
            });
            expect(users(off)).toBeLessThan(7);
            expect(out).toEqual(off);
            expect(users(out)).toBe(users(off));
        });
    });
});
