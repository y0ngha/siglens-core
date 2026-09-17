import { AGENT_TURN_CAPS } from '@/domain/agent/turnCaps';
import { TIMEFRAMES } from '@/domain/constants/market';
import type { AgentToolSpec } from '@/domain/ports/agentProvider';

const TIMEFRAME_ENUM: readonly string[] = TIMEFRAMES;

/** Analysis kinds `run_fresh_analysis` can produce (spec §7). */
export const FRESH_ANALYSIS_KINDS = [
    'technical',
    'overall',
    'news',
    'options',
] as const;
export type FreshAnalysisKind = (typeof FRESH_ANALYSIS_KINDS)[number];
const FRESH_ANALYSIS_KIND_STRINGS: readonly string[] = FRESH_ANALYSIS_KINDS;

/**
 * @internal Narrows an already-schema-validated `kind` argument to
 * {@link FreshAnalysisKind}; used by `runAgentTurn` to key
 * `FRESH_ANALYSIS_ESTIMATED_SECONDS` without an unsafe cast.
 */
export function isFreshAnalysisKind(
    value: unknown
): value is FreshAnalysisKind {
    return (
        typeof value === 'string' && FRESH_ANALYSIS_KIND_STRINGS.includes(value)
    );
}

const symbolProp = {
    type: 'string',
    description:
        'Ticker symbol as used on SIGLENS (e.g. AAPL, 005930.KS, BTCUSD). Use search_ticker first when unsure.',
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
            "Latest price and day change for up to 3 symbols. Call for any current-price or today's-move question, and always instead of quoting a price from memory. Each quote carries quoteDelayMinutes; when it is greater than 0 the quote is delayed by that many minutes and must not be called real-time.",
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
            "Recent OHLCV bars with latest indicator values (RSI, MACD, Bollinger, moving averages, ADX/+DI/-DI, stochastic %K/%D, CCI, MFI, Williams %R, VWAP, Ichimoku tenkan/kijun/senkou A/B, SuperTrend, Parabolic SAR, squeeze momentum), detected signals, trend state, recent candle patterns with their dates, and `confluence` — the rule-based indicator-family agreement score (0–100, 50 neutral; entry/exit triggers; bullish/bearish and newly lit signals; null below 120 bars; no AI involved). Call for any question about price action, momentum, indicator values, chart setup, or a symbol's outlook; not needed for questions only about earnings, financials, news or congressional trades.",
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
            'Most recent SIGLENS AI analysis for a symbol and tab, read from cache/snapshot/history. Call this FIRST for any "what does SIGLENS think" question, including chart pattern questions: technical results include detected chart patterns, candle patterns and strategy verdicts. If it returns stale:true or found:false, call run_fresh_analysis when that tool is available.',
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
            'News already ingested by SIGLENS for a symbol or a market category, with sentiment and Korean summary. Call for news, events, rulings or "why did it move / what happened" questions. If the result is empty or older than the question needs, say coverage is limited and use web_search if available.',
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
        name: 'get_fundamentals',
        description:
            'Company profile, valuation ratios (P/E, P/B, market cap and similar), profitability, growth, financial health scores, analyst consensus and price targets, and the upcoming earnings date/estimates. Stocks only (US and Korean); not for crypto. Use for valuation, earnings, "is it expensive", growth or balance-sheet questions.',
        costClass: 'cached',
        inputSchema: {
            type: 'object',
            properties: { symbol: symbolProp },
            required: ['symbol'],
            additionalProperties: false,
        },
    },
    {
        name: 'get_market_overview',
        description:
            'Market-wide fear & greed index with its factor breakdown, major index levels and day change, and for \'us\' the sector signal scan (golden crosses, RSI divergences, squeezes across large caps). Use for "how is the market", market mood, index or sector questions.',
        costClass: 'cached',
        inputSchema: {
            type: 'object',
            properties: {
                market: {
                    type: 'string',
                    enum: ['us', 'kr'],
                    description: 'Which market to summarize',
                },
            },
            required: ['market'],
            additionalProperties: false,
        },
    },
    {
        name: 'get_economy',
        description:
            'US macro indicators (policy rate, CPI, employment, GDP), Treasury yields, upcoming high-impact economic calendar events, and the latest SIGLENS macro briefing if available. Use for rates, inflation, macro calendar or "what\'s coming up this week" questions.',
        costClass: 'cached',
        inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
        },
    },
    {
        name: 'get_congress_trades',
        description:
            'Recent disclosed US congressional trades in a US stock, with a buy/sell trend summary. US stocks only. Use when the user asks about congressional or insider political trading in a symbol.',
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
        description: `Run a NEW SIGLENS AI analysis now (30–250 seconds). Call only after get_cached_analysis returned found:false or stale:true, at most ${AGENT_TURN_CAPS.maxFreshAnalysis} per turn. The result is the same structure as get_cached_analysis.`,
        costClass: 'expensive',
        inputSchema: {
            type: 'object',
            properties: {
                symbol: symbolProp,
                kind: {
                    type: 'string',
                    enum: FRESH_ANALYSIS_KINDS,
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
            "The signed-in user's own holdings on SIGLENS: symbol, quantity, average price, currency. Call when the user asks about 'my stocks', 'my position', profit/loss, or what they hold. Never guess holdings.",
        costClass: 'free',
        inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
        },
    },
    {
        name: 'web_search',
        description: `Web search (top 5 results with snippets) for market, company or economic facts SIGLENS data does not hold: corporate events, regulation, macro headlines. Never for unrelated topics, code repositories or search operators (site:, filetype:). Do not use for prices or indicators. At most ${AGENT_TURN_CAPS.maxWebSearch} per turn.`,
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
