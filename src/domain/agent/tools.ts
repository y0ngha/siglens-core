import type { AgentToolSpec } from '@/domain/ports/agentProvider';
import { TIMEFRAMES } from '@/domain/constants/market';

const TIMEFRAME_ENUM = TIMEFRAMES as readonly string[];

const symbolProp = {
    type: 'string',
    description:
        'Ticker symbol as used on siglens (e.g. AAPL, 005930.KS, BTCUSD). Use search_ticker first when unsure.',
} as const;

/**
 * Tool catalog (spec §7). Descriptions are the only thing the model reads —
 * keep them imperative and say WHEN to call the tool, not just what it does.
 * Executors live in siglens (`app/api/ai/chat/tools/*`).
 */
export const AGENT_TOOL_SPECS: readonly AgentToolSpec[] = [
    {
        name: 'search_ticker',
        description:
            'Find ticker symbols by company name or partial symbol (Korean and English). Call this before any other tool when the user names a company instead of a symbol.',
        costClass: 'free',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Company name or symbol fragment',
                },
            },
            required: ['query'],
            additionalProperties: false,
        },
    },
    {
        name: 'get_quote',
        description:
            'Latest price, day change and volume for up to 3 symbols. Always call this instead of quoting a price from memory.',
        costClass: 'free',
        inputSchema: {
            type: 'object',
            properties: {
                symbols: {
                    type: 'array',
                    description: 'Up to 3 symbols; extra entries are ignored',
                    items: { type: 'string' },
                },
            },
            required: ['symbols'],
            additionalProperties: false,
        },
    },
    {
        name: 'get_bars_indicators',
        description:
            'Recent OHLCV bars with latest indicator values (RSI, MACD, Bollinger, moving averages), detected signals and trend state. Use for any question about price action, momentum or chart setup.',
        costClass: 'free',
        inputSchema: {
            type: 'object',
            properties: {
                symbol: symbolProp,
                timeframe: {
                    type: 'string',
                    enum: TIMEFRAME_ENUM,
                    description: 'Bar interval; 1Day for most questions',
                },
                bars: {
                    type: 'integer',
                    minimum: 10,
                    maximum: 60,
                    description: 'How many recent bars to return (default 30)',
                },
            },
            required: ['symbol', 'timeframe'],
            additionalProperties: false,
        },
    },
    {
        name: 'get_cached_analysis',
        description:
            'Most recent siglens AI analysis for a symbol and tab, read from cache/snapshot/history. Call this FIRST for any "what does siglens think" question; if it returns stale:true or found:false, call run_fresh_analysis when that tool is available.',
        costClass: 'cached',
        inputSchema: {
            type: 'object',
            properties: {
                symbol: symbolProp,
                tab: {
                    type: 'string',
                    enum: [
                        'technical',
                        'overall',
                        'fundamental',
                        'financials',
                        'news',
                        'options',
                        'congress',
                    ],
                },
                timeframe: {
                    type: 'string',
                    enum: TIMEFRAME_ENUM,
                    description: 'Only for technical/overall; default 1Day',
                },
            },
            required: ['symbol', 'tab'],
            additionalProperties: false,
        },
    },
    {
        name: 'get_news',
        description:
            'News already ingested by siglens for a symbol or a market category, with sentiment and Korean summary. If the result is empty or older than the question needs, say coverage is limited and use web_search if available.',
        costClass: 'free',
        inputSchema: {
            type: 'object',
            properties: {
                symbol: {
                    type: 'string',
                    description:
                        'Symbol; omit when asking about a market category',
                },
                category: {
                    type: 'string',
                    enum: [
                        'general',
                        'stock',
                        'crypto',
                        'forex',
                        'articles',
                        'kr',
                    ],
                    description:
                        'Market news category; omit when symbol is given',
                },
                since: {
                    type: 'string',
                    description:
                        'ISO date (YYYY-MM-DD); only news published on/after it',
                },
                query: {
                    type: 'string',
                    description: 'Keyword filter on title/summary',
                },
                limit: { type: 'integer', minimum: 1, maximum: 10 },
                includeBody: {
                    type: 'boolean',
                    description:
                        'Include up to 1,000 chars of body for the top 3 items',
                },
            },
            additionalProperties: false,
        },
    },
    {
        name: 'get_options_summary',
        description:
            'Options market summary: ATM implied volatility, max pain, put/call ratio, top open-interest strikes, nearest expirations. Use for volatility, expected move or positioning questions.',
        costClass: 'cached',
        inputSchema: {
            type: 'object',
            properties: { symbol: symbolProp },
            required: ['symbol'],
            additionalProperties: false,
        },
    },
    {
        name: 'run_fresh_analysis',
        description:
            'Run a NEW siglens AI analysis now (30–250 seconds). Call only after get_cached_analysis returned found:false or stale:true, at most once per turn. The result is the same structure as get_cached_analysis.',
        costClass: 'expensive',
        inputSchema: {
            type: 'object',
            properties: {
                symbol: symbolProp,
                kind: {
                    type: 'string',
                    enum: ['technical', 'overall', 'news', 'options'],
                },
                timeframe: {
                    type: 'string',
                    enum: TIMEFRAME_ENUM,
                    description: 'technical/overall only; default 1Day',
                },
            },
            required: ['symbol', 'kind'],
            additionalProperties: false,
        },
    },
    {
        name: 'get_my_portfolio',
        description:
            "The signed-in user's own holdings on siglens: symbol, quantity, average price, currency. Call when the user asks about 'my stocks', 'my position', profit/loss, or what they hold. Never guess holdings.",
        costClass: 'free',
        inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
        },
    },
    {
        name: 'web_search',
        description:
            'Web search (top 5 results with snippets) for facts siglens data does not hold: corporate events, regulation, macro headlines. Do not use for prices or indicators. At most 2 per turn.',
        costClass: 'external',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string' },
                freshness: {
                    type: 'string',
                    enum: ['day', 'week', 'month'],
                    description: 'Restrict to recent results',
                },
            },
            required: ['query'],
            additionalProperties: false,
        },
    },
];

export const AGENT_TOOL_NAMES: readonly string[] = AGENT_TOOL_SPECS.map(
    s => s.name
);

/**
 * Look up a tool's spec by name.
 *
 * @param name - The tool name (matches `AgentToolSpec.name`).
 * @returns The matching spec, or `undefined` if no tool has that name.
 */
export function findToolSpec(name: string): AgentToolSpec | undefined {
    return AGENT_TOOL_SPECS.find(s => s.name === name);
}

/**
 * Filter the catalog to the tools the consumer can actually execute right now
 * (e.g. `web_search` is absent without a Brave key or under E2E). The consumer
 * computes `available`; core never reads env.
 *
 * @param available - Names of tools the consumer can currently execute.
 * @returns The subset of {@link AGENT_TOOL_SPECS} whose name is in `available`.
 */
export function selectTools(available: ReadonlySet<string>): AgentToolSpec[] {
    return AGENT_TOOL_SPECS.filter(s => available.has(s.name));
}
