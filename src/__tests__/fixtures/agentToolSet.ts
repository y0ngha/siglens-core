import type {
    AgentToolArgs,
    AgentToolDefinition,
    AgentToolSet,
} from '@/domain/agent/toolSet';
import { FRESH_ANALYSIS_KINDS } from '@/domain/agent/tools';
import { AGENT_TURN_CAPS } from '@/domain/agent/turnCaps';
import type {
    AgentToolCostClass,
    JsonSchemaProperty,
} from '@/domain/ports/agentProvider';

/**
 * The tool set core's agent tests pass as the (required) `toolSet`.
 *
 * Core ships no tools: the consumer owns its catalog, routing rows, tool rules
 * and prompt fragments. This fixture stands in for one. Its tool names are the
 * consumer's (so the loop tests read like real turns), and its loop metadata
 * mirrors what the consumer declares (`perTurn` from `AGENT_TURN_CAPS`, the
 * web-search meter, the fresh-analysis daily quota, the filing-read `counts`
 * rule, the estimated seconds), so the `TurnBudget` tests exercise the same
 * caps. Its text is short and fixed: it exists to show where each piece of a
 * tool set lands in the frame, and a frame change is the only thing that moves
 * the prompt golden hashes built from it.
 */

const string = { type: 'string' } as const;

function tool(
    name: string,
    costClass: AgentToolCostClass,
    properties: Record<string, JsonSchemaProperty>,
    required: readonly string[] = [],
    extra: Partial<AgentToolDefinition> = {}
): AgentToolDefinition {
    return {
        name,
        description: `Test tool ${name}.`,
        costClass,
        inputSchema: {
            type: 'object',
            properties,
            required,
            additionalProperties: false,
        },
        ...extra,
    };
}

const FRESH_ANALYSIS_ESTIMATED_SECONDS: Readonly<Record<string, number>> = {
    technical: 40,
    overall: 120,
    news: 90,
    options: 60,
};

/** A filing call with a non-empty `accession` reads a text; a listing does not count. */
function isFilingRead(args: AgentToolArgs): boolean {
    return typeof args.accession === 'string' && args.accession.trim() !== '';
}

export const TEST_AGENT_TOOLS: readonly AgentToolDefinition[] = [
    tool('search_ticker', 'free', { query: string }, ['query']),
    tool('get_quote', 'free', { symbols: { type: 'array', items: string } }, [
        'symbols',
    ]),
    tool(
        'get_bars_indicators',
        'free',
        { symbol: string, timeframe: string, bars: { type: 'integer' } },
        ['symbol', 'timeframe']
    ),
    tool(
        'get_cached_analysis',
        'cached',
        { symbol: string, tab: string, timeframe: string },
        ['symbol']
    ),
    tool('get_news', 'free', { symbol: string, query: string }),
    tool('get_options_summary', 'cached', { symbol: string }, ['symbol']),
    tool(
        'get_company_filings',
        'cached',
        { symbol: string, accession: string },
        ['symbol'],
        {
            perTurn: {
                max: AGENT_TURN_CAPS.maxFilingReads,
                counts: isFilingRead,
            },
        }
    ),
    tool(
        'run_fresh_analysis',
        'expensive',
        {
            symbol: string,
            kind: { type: 'string', enum: FRESH_ANALYSIS_KINDS },
            timeframe: string,
        },
        ['symbol', 'kind'],
        {
            perTurn: { max: AGENT_TURN_CAPS.maxFreshAnalysis },
            dailyQuota: 'freshAnalysis',
            estimatedSeconds: args =>
                typeof args.kind === 'string'
                    ? FRESH_ANALYSIS_ESTIMATED_SECONDS[args.kind]
                    : undefined,
        }
    ),
    tool('get_my_portfolio', 'free', {}),
    tool('get_x_posts', 'external', { symbol: string }, ['symbol'], {
        perTurn: { max: AGENT_TURN_CAPS.maxXPostCalls },
    }),
    tool(
        'show_chart',
        'cached',
        {
            kind: string,
            symbols: { type: 'array', items: string },
            symbol: string,
            market: string,
        },
        ['kind'],
        { perTurn: { max: AGENT_TURN_CAPS.maxCharts } }
    ),
    tool('web_search', 'external', { query: string }, ['query'], {
        perTurn: { max: AGENT_TURN_CAPS.maxWebSearch },
        meter: 'webSearch',
    }),
];

export const TEST_AGENT_TOOL_NAMES: readonly string[] = TEST_AGENT_TOOLS.map(
    t => t.name
);

export const TEST_AGENT_TOOL_SET: AgentToolSet = {
    version: 'test.1',
    tools: TEST_AGENT_TOOLS,
    routingRows: [
        {
            requires: ['search_ticker'],
            text: 'A company name instead of a symbol → search_ticker first.',
        },
        {
            // A row whose wording depends on which tools are available.
            requires: [],
            text: available =>
                available.has('get_quote')
                    ? available.has('get_bars_indicators')
                        ? 'Price and trend → get_quote and get_bars_indicators.'
                        : 'Price → get_quote.'
                    : '',
        },
        {
            requires: ['get_news', 'web_search'],
            text: 'News SIGLENS lacks → get_news, then web_search.',
        },
        {
            requires: [],
            text: 'Out-of-scope requests → no tools.',
        },
    ],
    ruleLines: available => [
        available.has('get_quote') &&
            '- Test rule: a delayed quote is called delayed.',
        available.has('get_news') &&
            available.has('web_search') &&
            '- Test rule: search only for a gap in the news.',
        '- Test rule: always present.',
    ],
    fragments: {
        computedFigureExamples: 'testField, otherTestField',
        guestCapabilities: available =>
            `quotes${available.has('get_news') ? ', news' : ''}${available.has('web_search') ? ', web search' : ''}`,
        portfolioTool: 'get_my_portfolio',
        recallExamples: available =>
            available.has('get_news') ? 'get_news with a query, ' : '',
        internalToolNameExamples: 'get_quote, get_news, …',
        toolDisplayNames: 'quotes / news / web search',
    },
};
