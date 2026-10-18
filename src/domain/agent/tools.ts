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
            'Latest price and day change for up to 3 symbols. Call for any current-price or today\'s-move question, and always instead of quoting a price from memory. Each quote carries quoteDelayMinutes; when it is greater than 0 the quote is delayed by that many minutes and must not be called real-time. When asOfIsFetchTime is true, asOf is when SIGLENS fetched the quote, not necessarily the trade time — cite it as "as of <time>", never as the trade time.',
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
            "Recent OHLCV bars with latest indicator values (RSI, MACD, Bollinger, moving averages, ADX/+DI/-DI, stochastic %K/%D, CCI, MFI, Williams %R, VWAP, Ichimoku tenkan/kijun/senkou A/B, SuperTrend, Parabolic SAR, squeeze momentum, and RSI(2) as `rsi2` on 1Day only), detected signals, `latest.rsiZone` (computed RSI zone: overbought ≥ 70, oversold ≤ 30, otherwise neutral — quote it, do not re-derive; when absent, treat RSI between 30 and 70 as neutral), trend state, recent candle patterns with their dates, `derived` (precomputed — quote them as given, do not recompute: lastClose; changePct.1bar/5bars/20bars/60bars, each counted in bars of the requested timeframe, e.g. on 1Day roughly 1 day/1 week/1 month/3 months but on 1Hour the same keys mean 1/5/20/60 HOURS — always read them against the requested timeframe, never assume daily; range.high/low/fromHighPct/fromLowPct/bars, the high/low over up to the last 252 bars on 1Day (≈52 weeks) or all loaded bars intraday, with `bars` saying how many; ranges['20bars']/ranges['60bars'] ({high, low, fromHighPct, fromLowPct}, or null when fewer bars are loaded), the high/low over the last 20/60 bars of the requested timeframe — use these instead of the 252-bar `range` for N-day high/low questions over 20 or 60 bars; volumeVsAvg20; atrPct; priceVsMa (ma50Pct is distance from the 50-bar simple moving average; the other priceVsMa keys are the indicator MA/EMA periods); maStack), `higherTimeframe` (the next larger timeframe's trend/tally, or null), and `confluence` — the rule-based indicator-family agreement score (0–100, 50 neutral, normally within 35–65; 92 or 8 means the bullish or the bearish trigger conditions of the tally all held on the last bar; descriptive, with no measured forward edge; bullish/bearish and newly lit signals; null below 120 bars; no AI involved). On timeframe 1Day the result also carries `pullback`: the short-term washout reading — `reading` (washoutInUptrend | nearWashoutInUptrend | washoutBelowMa200), the values it was read from (williamsR, rsi2, closeVsMa200Pct, ma5 as the exit reference) and `measured`, the reading's historical base rate (quote it as given; it is not an instruction) — null when there is no washout reading, on other timeframes or below 200 bars; and `fearGreed`: THIS SYMBOL's own fear & greed reading (score 0–100, label, confidence and the Flow/Trend group scores) — the same index the symbol's fear & greed page shows, never the market-wide one from get_market_overview. It is null on other timeframes and when the history is too short to rank. Call for any question about price action, momentum, indicator values, chart setup, or a symbol's outlook; not needed for questions only about earnings, financials, news or congressional trades.",
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
            'Most recent SIGLENS AI analysis for a symbol and tab, read from cache/snapshot/history. Call this FIRST for any "what does SIGLENS think" question, including chart pattern questions: technical results include detected chart patterns, candle patterns and strategy verdicts, plus `sinceAnalysis` — analysisPrice, priceNow, movePct, levelsBroken, nearestSupport, nearestResistance, planNow (planNow may be null) — precomputed price movement since the analysis was generated; quote it as given, do not recompute it. If it returns stale:true or found:false, call run_fresh_analysis when that tool is available.',
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
            "News already ingested by SIGLENS for a symbol or a market category, with sentiment and Korean summary, a `tally` (bullish/bearish/neutral/highImpact counts) and each item's `ageHours` — already computed, quote them as given, do not recount or recompute them. A category request also carries `digest`: SIGLENS's own summary of that feed (`driver`, `keyEvents`, `upcomingEvents`, `overallSentiment`) — relay it as SIGLENS's reading of the category rather than re-deriving one from the item list; it is absent for a symbol request and when nothing is cached yet. Call for news, events, rulings or \"why did it move / what happened\" questions. If the result is empty or older than the question needs, say coverage is limited and use web_search if available.",
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
            'Options market summary: ATM implied volatility, max pain, put/call ratio, top open-interest strikes (each with a precomputed distancePct/side vs the underlying), nearest expirations, plus precomputed daysToExpiration, maxPainDistancePct, impliedMoveRange, and callSpreadPct/putSpreadPct on the bid/ask summary — quote them as given, do not recompute them. Max pain is the strike with the smallest total payout to option holders if the stock closed there at expiration (not a forecast); put/call ratio = put OI ÷ call OI (0.58 = 0.58 puts per call). Open interest and volume are contract counts, never prices; only callMidPrice/putMidPrice are option prices (null = no two-sided quote, not zero). Use for volatility, expected move or positioning questions.',
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
            'Company profile, valuation ratios (P/E, P/B, market cap and similar), profitability, growth, financial health scores, analyst consensus and price targets, the upcoming earnings date, `analystEstimate` (consensus EPS/revenue; its `period` says whether it covers the current fiscal year or the current quarter — name that period when you cite it, never call an annual figure quarterly), plus precomputed `targetUpsidePct` (consensus target vs current price) and `daysToEarnings` — quote them as given, do not recompute them. Stocks only (US and Korean); not for crypto. Use for valuation, earnings, "is it expensive", growth or balance-sheet questions.',
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
            "Market-wide fear & greed index with its factor breakdown and `comparisons` (the same index at past sessions — quote the past score and its date as given), major index levels and day change, SIGLENS's own market `briefing` when one is cached (`summary`, `dominantThemes`, `riskSentiment` — relay it as SIGLENS's view), and the sector signal scan (golden crosses, RSI divergences, squeezes across the market's large caps) in `sectorSignals` — `countsBySector` plus `topSignals`, each flagged symbol with the rule that flagged it. All three markets carry the scan. `market: 'crypto'` scans the major and altcoin coins SIGLENS curates; it has no fear & greed index and no sector ETFs, so `fearGreed`, `sectors`, `sectorBreadth` and `bestWorstSpreadPp` are null or empty there and the coin groups live in the scan's `countsBySector` instead. Each sector carries its display `name` and `rank` (by day change, best to worst), plus `sectorBreadth` (up/down/flat counts of the sector ETFs listed here — not market-wide advancers/decliners) and `bestWorstSpreadPp` (best-minus-worst sector spread) — all already computed, quote them as given, do not recompute them. Use for \"how is the market\", market mood, index or sector questions, and as the only screen SIGLENS has when the user asks which sectors or stocks are worth looking at.",
        costClass: 'cached',
        inputSchema: {
            type: 'object',
            properties: {
                market: {
                    type: 'string',
                    enum: ['us', 'kr', 'crypto'],
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
            'US macro indicators (policy rate, CPI, employment, GDP) with the latest-vs-previous change already computed, Treasury yields including `spread2s10s` (2s10s spread, precomputed — quote it as given, do not recompute it), upcoming high-impact economic calendar events, and the latest SIGLENS macro briefing if available. Use for rates, inflation, macro calendar or "what\'s coming up this week" questions.',
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
            "Recent disclosed US congressional trades in a US stock — trades by members of the US Senate and House (e.g. Pelosi), with a buy/sell trend summary. US stocks only. Use only when the user asks about lawmakers' or politicians' trading. It covers members of Congress only, not company executives, directors or other corporate insiders.",
        costClass: 'cached',
        inputSchema: {
            type: 'object',
            properties: { symbol: symbolProp },
            required: ['symbol'],
            additionalProperties: false,
        },
    },
    {
        name: 'get_investor_flows',
        description:
            "Investor flows (수급) of a US or Korean stock — who is buying, selling, shorting or diluting it. Returns a precomputed scorecard: composite and per-axis labels and scores (institutions, insiders, 5% holders, short sellers, dilution), signals with their numeric evidence, and the as-of date of every source. A US stock also returns the largest institutional holders with their quarter-over-quarter change and the institutions' 13F put/call option positions, recent insider (Form 4) transactions and Form 144 proposed sales, recent 13D/13G filings, recent share-offering and registration filings, FINRA short-interest and short-volume data, SEC fails-to-deliver, Reg SHO threshold-list status and a 0–100 short-squeeze risk score. A Korean stock (e.g. 005930.KS) returns DART ownership disclosures instead: 대량보유 상황보고 (5% or more holders; 보고구분 일반 or 약식, which never sets strength), 임원·주요주주 소유보고 (executives and major shareholders) and 거래계획보고서 (trading plans). " +
            'Call it for questions about institutional buying or selling or holdings (기관 매수/매도, 기관 보유, 기관 수급, 13F); corporate insiders (내부자 매수/매도, executives or CEO buying, cluster buys); 5%+ holders and activists (13D, 13G); short selling (공매도, 공매도 잔고, short interest, days to cover); share dilution and offerings (유상증자, 증자, 희석, 공모, ATM 발행, 선반 등록, shelf registration, S-3, 424B5, private placement, Form D); planned insider sales (Form 144, 매도 예정, 내부자 매도 계획, 10b5-1 계획 매도); fails-to-deliver (결제 불이행, FTD, 무차입 공매도 의혹); the Reg SHO threshold list (공매도 과열 종목, threshold list); institutional option positions (기관 풋·콜 포지션); short-squeeze risk (숏스퀴즈, 숏스퀴즈 점수, 숏스퀴즈 가능성, short squeeze); and, for a Korean stock, major-holder and insider stake changes (대주주 지분 변동, 최대주주 지분, 5% 공시, 임원이 주식 샀어?). ' +
            'How to read it: fails to deliver arise from many operational causes and are not evidence of naked short selling (SEC) — say so whenever you mention them, including when the user asks about 무차입 공매도. A threshold listing means fails persisted for five settlement days; after 13 consecutive days a close-out is mandatory. A Form 144 is a notice of intent to sell, so the sale may not happen, and the executed sale later appears as a Form 4 — do not count the two as separate selling; a sale under a Rule 10b5-1 plan was scheduled in advance. 13F option positions are underlying notional, not premium, and are often hedges against long stock, so a put/call tilt is a weak signal. An at-the-market program or a priced offering sells new shares; a shelf or registration only makes a sale possible. The squeeze score: quote its score and level with the top components it lists; sufficiency partial means some inputs were missing and the score was reweighted over the rest (say which are missing when it lists them), and levelCapped means the level was held at elevated because no short-positioning input (short interest, days to cover, its trend, short-volume z-score) was present. ' +
            "The data is lagged and partial: 13F (holdings and options) is quarterly and filed up to ~45 days after quarter end, so it shows past positioning (an in-progress quarter is partial and not scored); Form 4 arrives about 2 business days after a trade; 13D/13G within days; a Form 144 is filed no later than the sell order, so it can come before a sale that never happens; offering filings are dated filings, so give each filing's date; FINRA short interest settles twice a month and is published ~8 business days later; FINRA short volume covers off-exchange trades only; fails-to-deliver are published about two weeks after each half-month; the threshold list is daily. Always state the as-of dates from the result and never present the data as live. An axis marked insufficient has no data — say so, never call it neutral. A Korean result has no 13F, FINRA short or dilution data, so those axes are insufficient. Korean institutional/foreign net buying (기관·외국인 순매수) is not available in this tool or anywhere in SIGLENS — say so, never estimate it. For members of Congress use get_congress_trades. Quote labels and scores as given.",
        costClass: 'cached',
        inputSchema: {
            type: 'object',
            properties: { symbol: symbolProp },
            required: ['symbol'],
            additionalProperties: false,
        },
    },
    {
        name: 'get_guide',
        description:
            "SIGLENS's own explainer for a technical-analysis concept: a candlestick pattern, chart pattern, indicator or strategy/theory (e.g. 망치형, double bottom, RSI, 엘리어트 파동). Returns the best match's article (how it looks or is calculated, what it means, how SIGLENS detects it, caveats) plus up to two other matches, each with a page url. Call when the user asks what a concept is or how to read it, without needing a symbol. Link the url in your answer.",
        costClass: 'free',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description:
                        'Concept name in any language (e.g. "이중바닥", "MACD", "hammer")',
                },
            },
            required: ['query'],
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
            "The signed-in user's own holdings on SIGLENS: symbol, quantity, average price, currency, plus precomputed `pnl`/`pnlPct` (profit/loss vs cost) and `weightPct` (share of portfolio value) — quote them as given, do not recompute them. Call when the user asks about 'my stocks', 'my position', profit/loss, or what they hold. Never guess holdings.",
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
