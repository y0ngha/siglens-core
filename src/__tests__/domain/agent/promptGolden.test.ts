import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    buildAgentSystemPrompt,
    buildAgentTurnContext,
} from '@/domain/agent/buildAgentSystemPrompt';
import { BUILT_IN_AGENT_TOOL_SET } from '@/domain/agent/builtInToolSet';
import type { AgentLocale } from '@/domain/agent/promptShared';
import { AGENT_TOOL_SPECS, selectTools } from '@/domain/agent/tools';
import { selectToolSetSpecs } from '@/domain/agent/toolSet';
import golden from '@/__tests__/fixtures/agentPromptGolden.json';

/**
 * Prompt-byte gate for making the agent tool set injectable.
 *
 * The hashes in `fixtures/agentPromptGolden.json` were taken from the prompt
 * builder BEFORE the tool text moved into `BUILT_IN_AGENT_TOOL_SET`: a render
 * that reads the same prompt back from the moved text cannot be a reference
 * for itself, so the reference is the frozen hash of the old bytes. Any edit
 * to the system prompt, a routing row, a tool rule, a tool description or the
 * order of the tools changes a hash here; that is a deliberate prompt change:
 * bump `AGENT_PROMPT_VERSION` and regenerate the file in the same commit with
 *
 *   UPDATE_AGENT_PROMPT_GOLDEN=1 yarn test src/__tests__/domain/agent/promptGolden.test.ts
 *
 * which rewrites the fixture from the CURRENT builder (review the diff: it is
 * exactly the prompt change). With the variable unset the test never writes.
 * After core-3 removes the built-in set, the reference comes from the siglens
 * `toolSet` instead.
 *
 * Matrix: 4 locales x guest/member x portfolio symbols present/absent x 27
 * availability sets (all tools, each tool removed in turn, an E2E-like set and
 * the public-API set) = 432 renders, each hashed for the system prompt and
 * for the JSON of the selected tool specs.
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
];

const ALL_NAMES: readonly string[] = AGENT_TOOL_SPECS.map(s => s.name);
const AVAILABILITY_SETS: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['all', ALL_NAMES],
    ...ALL_NAMES.map(
        n =>
            [`minus:${n}`, ALL_NAMES.filter(x => x !== n)] as [string, string[]]
    ),
    [
        'e2e',
        [
            'search_ticker',
            'get_quote',
            'get_bars_indicators',
            'get_cached_analysis',
            'get_news',
            'get_options_summary',
            'get_fundamentals',
            'get_my_portfolio',
            'show_chart',
        ],
    ],
    [
        'publicApi',
        ALL_NAMES.filter(
            n =>
                ![
                    'get_my_portfolio',
                    'show_chart',
                    'run_fresh_analysis',
                ].includes(n)
        ),
    ],
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

    it.runIf(REGENERATE)(
        'UPDATE_AGENT_PROMPT_GOLDEN=1: 현재 빌더로 고정 해시 파일을 다시 쓴다',
        () => {
            const prompts = Object.fromEntries(
                cells.map(cell => {
                    const tools = selectTools(cell.available);
                    const prompt = buildAgentSystemPrompt({
                        locale: cell.locale,
                        tools,
                        guest: cell.guest,
                        portfolioSymbols: cell.portfolioSymbols,
                    });
                    return [
                        cell.key,
                        {
                            prompt: sha(prompt),
                            specs: sha(JSON.stringify(tools)),
                        },
                    ];
                })
            );
            const turnContext = Object.fromEntries(
                LOCALES.flatMap(locale =>
                    TURN_CONTEXT_INSTANTS.map(at => [
                        `${locale}|${at}`,
                        sha(
                            buildAgentTurnContext({
                                locale,
                                now: new Date(at),
                            })
                        ),
                    ])
                )
            );
            writeFileSync(
                FIXTURE_PATH,
                `${JSON.stringify({ prompts, turnContext }, null, 4)}\n`
            );
        }
    );

    it('매트릭스는 432칸이고 고정 해시 파일과 키가 정확히 일치한다', () => {
        expect(cells).toHaveLength(432);
        expect(Object.keys(golden.prompts).toSorted()).toEqual(
            cells.map(c => c.key).toSorted()
        );
    });

    it('기본 경로(toolSet 생략)의 프롬프트와 도구 스펙 JSON이 모든 칸에서 고정 해시와 같다', () => {
        const mismatches = cells.flatMap(cell => {
            const tools = selectTools(cell.available);
            const prompt = buildAgentSystemPrompt({
                locale: cell.locale,
                tools,
                guest: cell.guest,
                portfolioSymbols: cell.portfolioSymbols,
            });
            const expected =
                golden.prompts[cell.key as keyof typeof golden.prompts];
            return [
                sha(prompt) === expected.prompt ? [] : [`${cell.key} prompt`],
                sha(JSON.stringify(tools)) === expected.specs
                    ? []
                    : [`${cell.key} specs`],
                sha(
                    JSON.stringify(
                        selectToolSetSpecs(
                            BUILT_IN_AGENT_TOOL_SET,
                            cell.available
                        )
                    )
                ) === expected.specs
                    ? []
                    : [`${cell.key} toolSet specs`],
            ].flat();
        });
        expect(mismatches).toEqual([]);
    });

    it('내장 도구 묶음을 명시해서 넘겨도 모든 칸에서 같은 바이트다', () => {
        const mismatches = cells.filter(cell => {
            const tools = selectTools(cell.available);
            const input = {
                locale: cell.locale,
                tools,
                guest: cell.guest,
                portfolioSymbols: cell.portfolioSymbols,
            };
            return (
                buildAgentSystemPrompt({
                    ...input,
                    toolSet: BUILT_IN_AGENT_TOOL_SET,
                }) !== buildAgentSystemPrompt(input)
            );
        });
        expect(mismatches.map(c => c.key)).toEqual([]);
    });

    it('턴 컨텍스트 노트도 도구 묶음 주입 전과 바이트가 같다', () => {
        const actual = Object.fromEntries(
            LOCALES.flatMap(locale =>
                TURN_CONTEXT_INSTANTS.map(at => [
                    `${locale}|${at}`,
                    sha(buildAgentTurnContext({ locale, now: new Date(at) })),
                ])
            )
        );
        expect(actual).toEqual(golden.turnContext);
    });
});
