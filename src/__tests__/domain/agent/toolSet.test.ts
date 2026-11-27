import { describe, expect, it } from 'vitest';
import { buildAgentSystemPrompt } from '@/domain/agent/buildAgentSystemPrompt';
import {
    selectToolSetSpecs,
    toAgentToolSpec,
    type AgentToolDefinition,
    type AgentToolSet,
} from '@/domain/agent/toolSet';
import {
    TEST_AGENT_TOOL_NAMES,
    TEST_AGENT_TOOL_SET,
} from '@/__tests__/fixtures/agentToolSet';

const EMPTY_SCHEMA = {
    type: 'object',
    properties: {},
    additionalProperties: false,
} as const;

function definition(
    name: string,
    extra: Partial<AgentToolDefinition> = {}
): AgentToolDefinition {
    return {
        name,
        description: `${name} description`,
        costClass: 'free',
        inputSchema: EMPTY_SCHEMA,
        ...extra,
    };
}

/** A tool set that shares no text with the test tool set. */
const CUSTOM_SET: AgentToolSet = {
    version: 'custom.1',
    tools: [definition('lookup_thing'), definition('scan_web')],
    routingRows: [
        { requires: ['lookup_thing'], text: 'Things → lookup_thing.' },
        { requires: ['lookup_thing', 'missing_tool'], text: 'Never shown.' },
        {
            requires: [],
            text: available =>
                available.has('scan_web') ? 'Web facts → scan_web.' : '',
        },
    ],
    ruleLines: available => [
        '- Custom rule always.',
        available.has('scan_web') && '- Custom rule for scan_web.',
        available.has('missing_tool') && '- Custom rule for missing_tool.',
    ],
    fragments: {
        computedFigureExamples: 'customField, otherCustomField',
        guestCapabilities: available =>
            `custom lookups${available.has('scan_web') ? ', custom scan' : ''}`,
        portfolioTool: 'custom_holdings',
        recallExamples: () => 'custom_tool with a hint, ',
        internalToolNameExamples: 'lookup_thing, scan_web, …',
        toolDisplayNames: 'lookups / scans',
    },
};

/** Top-level `## ` sections of a prompt, keyed by heading. */
function sectionsOf(prompt: string): Map<string, string> {
    const [head, ...rest] = prompt.split('\n## ');
    return new Map([
        ['(head)', head ?? ''],
        ...rest.map((s): [string, string] => [s.split('\n')[0] ?? '', s]),
    ]);
}

function differingSections(a: string, b: string): string[] {
    const left = sectionsOf(a);
    const right = sectionsOf(b);
    expect([...left.keys()]).toEqual([...right.keys()]);
    return [...left.keys()].filter(k => left.get(k) !== right.get(k));
}

describe('toAgentToolSpec / selectToolSetSpecs', () => {
    it('부가 필드를 떼고 나머지 키 순서를 그대로 둔다', () => {
        const def = definition('t', {
            perTurn: { max: 1 },
            meter: 'webSearch',
            dailyQuota: 'freshAnalysis',
            estimatedSeconds: () => 5,
        });
        const spec = toAgentToolSpec(def);
        expect(Object.keys(spec)).toEqual([
            'name',
            'description',
            'costClass',
            'inputSchema',
        ]);
        expect(JSON.stringify(spec)).not.toContain('perTurn');
        expect(JSON.stringify(spec)).not.toContain('dailyQuota');
    });

    it('가용한 도구만 가용 집합 순서가 아니라 묶음 순서대로 돌려준다', () => {
        expect(
            selectToolSetSpecs(CUSTOM_SET, new Set(['scan_web', 'x'])).map(
                s => s.name
            )
        ).toEqual(['scan_web']);
        expect(
            selectToolSetSpecs(
                TEST_AGENT_TOOL_SET,
                new Set(['web_search', 'get_news', 'search_ticker'])
            ).map(s => s.name)
        ).toEqual(['search_ticker', 'get_news', 'web_search']);
    });
});

describe('buildAgentSystemPrompt toolSet', () => {
    const allTools = selectToolSetSpecs(
        TEST_AGENT_TOOL_SET,
        new Set(TEST_AGENT_TOOL_NAMES)
    );
    const base = {
        locale: 'en',
        tools: allTools,
        toolSet: TEST_AGENT_TOOL_SET,
        portfolioSymbols: ['AAPL'],
    } as const;

    it('다른 묶음은 도구 관련 구역(Tools·Output의 한 줄·User)만 바꾼다', () => {
        const testSet = buildAgentSystemPrompt(base);
        const custom = buildAgentSystemPrompt({ ...base, toolSet: CUSTOM_SET });
        const differing = differingSections(testSet, custom);
        expect(differing).toEqual(['Tools', 'Output', 'User']);

        const outputLines = (prompt: string) =>
            sectionsOf(prompt).get('Output')?.split('\n') ?? [];
        const a = outputLines(testSet);
        const b = outputLines(custom);
        expect(a).toHaveLength(b.length);
        const changed = a.flatMap((line, i) =>
            line === b[i] ? [] : [b[i] ?? '']
        );
        expect(changed).toEqual([
            expect.stringContaining(
                'Never write internal tool names (lookup_thing, scan_web, …) or function-call syntax in the answer. Call them SIGLENS lookups / scans, in the answer language.'
            ),
        ]);
    });

    it('묶음의 라우팅 행·규칙·조각만 렌더하고 내장 문구는 남지 않는다', () => {
        const prompt = buildAgentSystemPrompt({
            locale: 'en',
            tools: selectToolSetSpecs(
                CUSTOM_SET,
                new Set(['lookup_thing', 'scan_web'])
            ),
            toolSet: CUSTOM_SET,
            portfolioSymbols: ['AAPL'],
        });
        expect(prompt).toContain('- Things → lookup_thing.');
        expect(prompt).toContain('- Web facts → scan_web.');
        expect(prompt).not.toContain('Never shown.');
        expect(prompt).toContain('- Custom rule always.');
        expect(prompt).toContain('- Custom rule for scan_web.');
        expect(prompt).not.toContain('missing_tool.');
        expect(prompt).toContain(
            'carries a computed figure (customField, otherCustomField), quote it as given'
        );
        expect(prompt).toContain('(call custom_holdings for quantities)');
        expect(prompt).toContain('custom_tool with a hint, a period');
        expect(prompt).not.toContain('search_ticker');
        expect(prompt).not.toContain('get_my_portfolio');
        expect(prompt).not.toContain('Test rule');
    });

    it('게스트 문장은 묶음의 가능 목록을 쓴다', () => {
        const prompt = buildAgentSystemPrompt({
            ...base,
            tools: selectToolSetSpecs(CUSTOM_SET, new Set(['scan_web'])),
            toolSet: CUSTOM_SET,
            guest: true,
        });
        expect(prompt).toContain(
            'everything else (custom lookups, custom scan) works without it.'
        );
    });

    it('false 규칙 줄과 빈 라우팅 행은 빈 줄을 남기지 않는다', () => {
        const prompt = buildAgentSystemPrompt({
            locale: 'en',
            tools: selectToolSetSpecs(CUSTOM_SET, new Set(['lookup_thing'])),
            toolSet: CUSTOM_SET,
        });
        const tools = sectionsOf(prompt).get('Tools') ?? '';
        const rules = tools.slice(tools.indexOf('### Rules'));
        expect(rules).not.toContain('\n\n\n');
        expect(rules).not.toMatch(/\n-\s*\n/);
        expect(rules).toContain(
            '- Custom rule always.\n- If a tool returns an error'
        );
        const routing = tools.slice(
            tools.indexOf('### Which tools to call'),
            tools.indexOf('### Rules')
        );
        expect(routing).not.toContain('scan_web');
        expect(routing.trimEnd().endsWith('- Things → lookup_thing.')).toBe(
            true
        );
    });
});
