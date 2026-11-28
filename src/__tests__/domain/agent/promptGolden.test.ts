import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    buildAgentSystemPrompt,
    buildAgentTurnContext,
} from '@/domain/agent/buildAgentSystemPrompt';
import type { AgentLocale } from '@/domain/agent/promptShared';
import { selectToolSetSpecs } from '@/domain/agent/toolSet';
import golden from '@/__tests__/fixtures/agentPromptGolden.json';
import {
    TEST_AGENT_TOOL_NAMES,
    TEST_AGENT_TOOL_SET,
} from '@/__tests__/fixtures/agentToolSet';

/**
 * Prompt-byte gate for the agent prompt frame.
 *
 * Core no longer ships tools: the consumer passes its own `toolSet` (tool
 * catalog, routing rows, tool rules, fragments), and pins the bytes of its own
 * prompt. What core owns is the frame those pieces are spliced into, so the
 * hashes in `fixtures/agentPromptGolden.json` are renders of the frame with the
 * fixed test tool set (`fixtures/agentToolSet.ts`). The fixture never changes
 * with the frame, so a changed hash here is a frame change: bump
 * `AGENT_PROMPT_VERSION` and regenerate the file in the same commit with
 *
 *   UPDATE_AGENT_PROMPT_GOLDEN=1 yarn test src/__tests__/domain/agent/promptGolden.test.ts
 *
 * which rewrites the fixture from the CURRENT builder (review the diff: it is
 * exactly the prompt change). With the variable unset the test never writes.
 *
 * The overnight-session instants were added with the overnight states, so
 * their hashes are renders of the builder that introduced them; the three
 * older instants kept their hashes through that change.
 *
 * The prompt hashes were generated with this test tool set by the builder as it
 * was before the built-in tool set was deleted, so the deletion is shown not to
 * have moved a byte of the frame. The turn-context hashes are carried over
 * unchanged from the earlier 432-cell file.
 *
 * Matrix: 4 locales x guest/member x portfolio symbols present/absent x 14
 * availability sets (all test tools, each tool removed in turn, none) = 224
 * renders, each hashed for the system prompt and for the JSON of the selected
 * tool specs.
 */

const LOCALES: readonly AgentLocale[] = ['ko', 'en', 'ja', 'zh'];
const PORTFOLIOS: ReadonlyArray<readonly string[] | undefined> = [
    undefined,
    ['AAPL', '005930.KS'],
];
const TURN_CONTEXT_INSTANTS = [
    '2026-09-12T14:30:00Z',
    '2026-11-20T23:59:59.999Z',
    '2026-01-01T00:00:00Z',
    // Around the overnight-session launch (Sun 2026-12-06 21:00 ET): one minute
    // before it, Sunday night, a weekday overnight, the weekday 20:00–21:00
    // pause, Sunday 20:30 ET (closed, overnight from 21:00; not a pause) and a
    // holiday eve (Thu 2026-12-24 21:30 ET, no session before Christmas).
    '2026-12-07T01:59:00Z',
    '2026-12-07T02:30:00Z',
    '2026-12-08T03:00:00Z',
    '2026-12-08T01:30:00Z',
    '2026-12-14T01:30:00Z',
    '2026-12-25T02:30:00Z',
];

const AVAILABILITY_SETS: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['all', TEST_AGENT_TOOL_NAMES],
    ...TEST_AGENT_TOOL_NAMES.map(
        n =>
            [`minus:${n}`, TEST_AGENT_TOOL_NAMES.filter(x => x !== n)] as [
                string,
                string[],
            ]
    ),
    ['none', []],
];

const sha = (text: string): string =>
    createHash('sha256').update(text).digest('hex');

const REGENERATE = process.env.UPDATE_AGENT_PROMPT_GOLDEN === '1';
const FIXTURE_PATH = resolve(
    __dirname,
    '../../fixtures/agentPromptGolden.json'
);

describe('agent prompt golden hashes', () => {
    const cells = LOCALES.flatMap(locale =>
        [true, false].flatMap(guest =>
            PORTFOLIOS.flatMap(portfolioSymbols =>
                AVAILABILITY_SETS.map(([setName, names]) => ({
                    key: [
                        locale,
                        guest ? 'guest' : 'member',
                        portfolioSymbols ? 'pf' : 'nopf',
                        setName,
                    ].join('|'),
                    locale,
                    guest,
                    portfolioSymbols,
                    available: new Set(names),
                }))
            )
        )
    );

    const render = (cell: (typeof cells)[number]) => {
        const tools = selectToolSetSpecs(TEST_AGENT_TOOL_SET, cell.available);
        return {
            prompt: buildAgentSystemPrompt({
                locale: cell.locale,
                tools,
                toolSet: TEST_AGENT_TOOL_SET,
                guest: cell.guest,
                portfolioSymbols: cell.portfolioSymbols,
            }),
            specs: JSON.stringify(tools),
        };
    };

    const turnContextHashes = () =>
        Object.fromEntries(
            LOCALES.flatMap(locale =>
                TURN_CONTEXT_INSTANTS.map(at => [
                    `${locale}|${at}`,
                    sha(buildAgentTurnContext({ locale, now: new Date(at) })),
                ])
            )
        );

    it.runIf(REGENERATE)(
        'UPDATE_AGENT_PROMPT_GOLDEN=1: 현재 빌더로 고정 해시 파일을 다시 쓴다',
        () => {
            const prompts = Object.fromEntries(
                cells.map(cell => {
                    const { prompt, specs } = render(cell);
                    return [
                        cell.key,
                        { prompt: sha(prompt), specs: sha(specs) },
                    ];
                })
            );
            writeFileSync(
                FIXTURE_PATH,
                `${JSON.stringify({ prompts, turnContext: turnContextHashes() }, null, 4)}\n`
            );
        }
    );

    it('매트릭스는 224칸이고 고정 해시 파일과 키가 정확히 일치한다', () => {
        expect(cells).toHaveLength(224);
        expect(Object.keys(golden.prompts).toSorted()).toEqual(
            cells.map(c => c.key).toSorted()
        );
    });

    it('테스트 도구 묶음으로 만든 프롬프트와 도구 스펙 JSON이 모든 칸에서 고정 해시와 같다', () => {
        const mismatches = cells.flatMap(cell => {
            const { prompt, specs } = render(cell);
            const expected =
                golden.prompts[cell.key as keyof typeof golden.prompts];
            return [
                sha(prompt) === expected.prompt ? [] : [`${cell.key} prompt`],
                sha(specs) === expected.specs ? [] : [`${cell.key} specs`],
            ].flat();
        });
        expect(mismatches).toEqual([]);
    });

    it('턴 컨텍스트 노트는 도구 묶음과 무관하고 바이트가 고정 해시와 같다', () => {
        expect(turnContextHashes()).toEqual(golden.turnContext);
    });
});
