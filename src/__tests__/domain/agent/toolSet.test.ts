import { describe, expect, it } from 'vitest';
import { buildAgentSystemPrompt } from '@/domain/agent/buildAgentSystemPrompt';
import { BUILT_IN_AGENT_TOOL_SET } from '@/domain/agent/builtInToolSet';
import {
    selectToolSetSpecs,
    toAgentToolSpec,
    type AgentToolDefinition,
    type AgentToolSet,
} from '@/domain/agent/toolSet';
import { AGENT_TOOL_SPECS, selectTools } from '@/domain/agent/tools';
import { AGENT_TURN_CAPS } from '@/domain/agent/turnCaps';

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

/** A tool set that shares no text with the built-in one. */
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

describe('BUILT_IN_AGENT_TOOL_SET', () => {
    it('도구는 AGENT_TOOL_SPECS와 같은 순서·같은 내용이고, 제공자에게 가는 부분은 원본 스펙과 JSON까지 같다', () => {
        expect(BUILT_IN_AGENT_TOOL_SET.tools.map(t => t.name)).toEqual(
            AGENT_TOOL_SPECS.map(s => s.name)
        );
        expect(
            JSON.stringify(BUILT_IN_AGENT_TOOL_SET.tools.map(toAgentToolSpec))
        ).toBe(JSON.stringify(AGENT_TOOL_SPECS));
    });

    it('도구별 턴 상한·계량·예상 시간은 예전 루프에 박혀 있던 값 그대로다', () => {
        const metaOf = (name: string) => {
            const tool = BUILT_IN_AGENT_TOOL_SET.tools.find(
                t => t.name === name
            );
            return {
                max: tool?.perTurn?.max,
                hasCounts: tool?.perTurn?.counts !== undefined,
                meter: tool?.meter,
                hasEstimate: tool?.estimatedSeconds !== undefined,
            };
        };
        expect(metaOf('web_search')).toEqual({
            max: AGENT_TURN_CAPS.maxWebSearch,
            hasCounts: false,
            meter: 'webSearch',
            hasEstimate: false,
        });
        expect(metaOf('run_fresh_analysis')).toEqual({
            max: AGENT_TURN_CAPS.maxFreshAnalysis,
            hasCounts: false,
            meter: undefined,
            hasEstimate: true,
        });
        expect(metaOf('get_company_filings')).toEqual({
            max: AGENT_TURN_CAPS.maxFilingReads,
            hasCounts: true,
            meter: undefined,
            hasEstimate: false,
        });
        expect(metaOf('get_x_posts')).toEqual({
            max: AGENT_TURN_CAPS.maxXPostCalls,
            hasCounts: false,
            meter: undefined,
            hasEstimate: false,
        });
        expect(metaOf('show_chart')).toEqual({
            max: AGENT_TURN_CAPS.maxCharts,
            hasCounts: false,
            meter: undefined,
            hasEstimate: false,
        });
        const capped = BUILT_IN_AGENT_TOOL_SET.tools
            .filter(
                t =>
                    t.perTurn !== undefined ||
                    t.meter !== undefined ||
                    t.estimatedSeconds !== undefined
            )
            .map(t => t.name);
        expect(capped).toEqual([
            'get_company_filings',
            'run_fresh_analysis',
            'get_x_posts',
            'show_chart',
            'web_search',
        ]);
    });

    it('일일 분석 쿼터는 run_fresh_analysis 정의에만 실려 있다', () => {
        expect(
            BUILT_IN_AGENT_TOOL_SET.tools
                .filter(t => t.dailyQuota !== undefined)
                .map(t => [t.name, t.dailyQuota])
        ).toEqual([['run_fresh_analysis', 'freshAnalysis']]);
    });

    it('get_company_filings는 accession이 있는 본문 읽기만 상한에 센다', () => {
        const counts = BUILT_IN_AGENT_TOOL_SET.tools.find(
            t => t.name === 'get_company_filings'
        )?.perTurn?.counts;
        expect(counts?.({ symbol: 'IONQ' })).toBe(false);
        expect(counts?.({ symbol: 'IONQ', accession: '' })).toBe(false);
        expect(counts?.({ symbol: 'IONQ', accession: '   ' })).toBe(false);
        expect(counts?.({ symbol: 'IONQ', accession: 7 })).toBe(false);
        expect(counts?.({ symbol: 'IONQ', accession: '0001-26-1' })).toBe(true);
    });

    it('run_fresh_analysis 예상 시간은 kind별 고정값이고 모르는 kind는 없다', () => {
        const estimate = BUILT_IN_AGENT_TOOL_SET.tools.find(
            t => t.name === 'run_fresh_analysis'
        )?.estimatedSeconds;
        expect(
            ['technical', 'overall', 'news', 'options', 'other', undefined].map(
                kind => estimate?.({ kind })
            )
        ).toEqual([40, 120, 90, 60, undefined, undefined]);
    });
});

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

    it('가용한 도구만 묶음 순서대로 돌려주고 기본 묶음은 selectTools와 같다', () => {
        expect(
            selectToolSetSpecs(CUSTOM_SET, new Set(['scan_web', 'x'])).map(
                s => s.name
            )
        ).toEqual(['scan_web']);
        const available = new Set(['get_news', 'search_ticker', 'web_search']);
        expect(
            JSON.stringify(
                selectToolSetSpecs(BUILT_IN_AGENT_TOOL_SET, available)
            )
        ).toBe(JSON.stringify(selectTools(available)));
    });
});

describe('buildAgentSystemPrompt toolSet', () => {
    const allTools = selectTools(new Set(AGENT_TOOL_SPECS.map(s => s.name)));
    const base = {
        locale: 'en',
        tools: allTools,
        portfolioSymbols: ['AAPL'],
    } as const;

    it('내장 묶음을 명시한 것과 생략한 것은 바이트가 같다', () => {
        expect(
            buildAgentSystemPrompt({
                ...base,
                toolSet: BUILT_IN_AGENT_TOOL_SET,
            })
        ).toBe(buildAgentSystemPrompt(base));
    });

    it('다른 묶음은 도구 관련 구역(Tools·Output의 한 줄·User)만 바꾼다', () => {
        const builtIn = buildAgentSystemPrompt(base);
        const custom = buildAgentSystemPrompt({ ...base, toolSet: CUSTOM_SET });
        const differing = differingSections(builtIn, custom);
        expect(differing).toEqual(['Tools', 'Output', 'User']);

        const outputLines = (prompt: string) =>
            sectionsOf(prompt).get('Output')?.split('\n') ?? [];
        const a = outputLines(builtIn);
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
