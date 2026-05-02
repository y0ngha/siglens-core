// IMPORTANT: System prompt strings must be written in English.
// Korean reduces LLM instruction-following consistency.

import type {
    AnalysisResponse,
    ChatMessage,
    ChatPromptPayload,
    CurrentAnalysisContext,
    FundamentalAnalysisResponse,
    KeyLevel,
    NewsAnalysisResponse,
    OverallAnalysisResponse,
    PriceScenario,
    Timeframe,
} from '@/domain/types';

function formatKeyLevels(levels: KeyLevel[]): string {
    if (levels.length === 0) return 'None detected';
    return levels.map(l => `${l.price.toFixed(2)} (${l.reason})`).join(', ');
}

function formatPriceTargets(
    scenario: PriceScenario | null | undefined
): string {
    if (!scenario || scenario.targets.length === 0) return 'None';
    return scenario.targets
        .map(t => `${t.price.toFixed(2)} — ${t.basis}`)
        .join('; ');
}

function formatIndicatorSignals(
    indicatorResults: AnalysisResponse['indicatorResults']
): string {
    return indicatorResults
        .flatMap(r =>
            r.signals.map(
                s => `• ${r.indicatorName}: ${s.trend} — ${s.description}`
            )
        )
        .join('\n');
}

function formatDetectedPatterns(
    patternSummaries: AnalysisResponse['patternSummaries']
): string {
    const detected = patternSummaries.filter(p => p.detected);
    if (detected.length === 0) return 'None detected';
    return detected.map(p => `${p.skillName} (${p.trend})`).join(', ');
}

function formatStrategyResults(
    strategyResults: AnalysisResponse['strategyResults']
): string {
    if (strategyResults.length === 0) return 'None';
    return strategyResults
        .map(
            r =>
                `### ${r.strategyName} (${r.trend})\n${r.summary || 'No summary'}`
        )
        .join('\n\n');
}

/**
 * Format a technical analysis context section for the system prompt.
 *
 * Surfaces the three most informative fields: overall trend, risk level,
 * and the plain-language summary.
 *
 * @param payload - The technical {@link AnalysisResponse} to format.
 * @returns A markdown section string.
 */
function formatTechnicalContext(payload: AnalysisResponse): string {
    return [
        `Trend: ${payload.trend}`,
        `Risk Level: ${payload.riskLevel}`,
        `Summary: ${payload.summary}`,
    ].join('\n');
}

/**
 * Format a fundamental analysis context section for the system prompt.
 *
 * Surfaces the two most informative fields: overall sentiment and the
 * overall conclusion (in Korean, as produced by the LLM).
 *
 * @param payload - The {@link FundamentalAnalysisResponse} to format.
 * @returns A markdown section string.
 */
function formatFundamentalContext(
    payload: FundamentalAnalysisResponse
): string {
    return [
        `Overall Sentiment: ${payload.overallSentiment}`,
        `Overall Conclusion: ${payload.overallConclusionKo}`,
    ].join('\n');
}

/**
 * Format a news analysis context section for the system prompt.
 *
 * Surfaces the two most informative fields: overall sentiment and the
 * current-driver summary (in Korean, as produced by the LLM).
 *
 * @param payload - The {@link NewsAnalysisResponse} to format.
 * @returns A markdown section string.
 */
function formatNewsContext(payload: NewsAnalysisResponse): string {
    return [
        `Overall Sentiment: ${payload.overallSentiment}`,
        `Current Driver: ${payload.currentDriverKo}`,
    ].join('\n');
}

/**
 * Format an overall (3-axis) analysis context section for the system prompt.
 *
 * Surfaces the two most informative fields: the headline summary and the
 * three-axis conclusion (both in Korean, as produced by the LLM).
 *
 * @param payload - The {@link OverallAnalysisResponse} to format.
 * @returns A markdown section string.
 */
function formatOverallContext(payload: OverallAnalysisResponse): string {
    return [
        `Headline: ${payload.headlineKo}`,
        `Three-axis Conclusion: ${payload.threeAxisConclusionKo}`,
    ].join('\n');
}

/**
 * Build the `## Current analysis context` section for the system prompt
 * from a {@link CurrentAnalysisContext} tagged union.
 *
 * Returns an empty string when `context` is `undefined` so that callers
 * can safely concatenate without a conditional.
 *
 * @param context - The tagged-union analysis context, or `undefined`.
 * @returns The formatted section string, or `""` when context is absent.
 */
function formatCurrentAnalysisContext(
    context: CurrentAnalysisContext | undefined
): string {
    if (!context) return '';

    let body: string;
    switch (context.kind) {
        case 'technical':
            body = formatTechnicalContext(context.payload);
            break;
        case 'fundamental':
            body = formatFundamentalContext(context.payload);
            break;
        case 'news':
            body = formatNewsContext(context.payload);
            break;
        case 'overall':
            body = formatOverallContext(context.payload);
            break;
    }

    return `\n\n## Current analysis context\nKind: ${context.kind}\n${body}`;
}

/**
 * Build a chat prompt payload (system prompt + message history) for an
 * already-completed analysis.
 *
 * The system prompt instructs the LLM to answer in friendly Korean, grounded
 * in the provided analysis while allowing directly related follow-up
 * questions and general technical-analysis explanations. Questions about
 * unrelated stocks or personalized financial advice are politely refused. It
 * embeds the trend, risk level, summary, trading strategy, key levels,
 * detected patterns, indicator signals, and price targets so the LLM can
 * answer without re-fetching anything.
 *
 * @param symbol - U.S. equity ticker (e.g. `"AAPL"`).
 * @param timeframe - The timeframe of the analysis being discussed.
 * @param analysis - The `AnalysisResponse` from a previously completed job.
 * @param history - Prior conversation turns; appended verbatim to the
 *   message list before `userMessage`.
 * @param userMessage - The user's latest input.
 * @param currentAnalysisContext - Optional tagged union of the analysis result
 *   currently displayed on the user's page (technical / fundamental / news /
 *   overall). When provided, a `## Current analysis context` section is
 *   appended to the system prompt so the LLM can reference live numbers
 *   without re-fetching data. Omit to keep the original behavior.
 * @returns The prompt payload — see {@link ChatPromptPayload}.
 */
export function buildChatPrompt(
    symbol: string,
    timeframe: Timeframe,
    analysis: AnalysisResponse,
    history: ChatMessage[],
    userMessage: string,
    currentAnalysisContext?: CurrentAnalysisContext
): ChatPromptPayload {
    const rec = analysis.actionRecommendation;

    const systemPrompt = `You are an AI assistant helping a user understand a technical analysis report for ${symbol}.
Ground every answer in the analysis data provided below.
You MAY answer follow-up questions when they are clearly connected to this analysis, including:
- a price level, support/resistance, target, stop, trend, risk, signal, pattern, indicator, or scenario mentioned in the analysis;
- a concept that appeared in your previous answer in this conversation;
- general technical-analysis knowledge needed to explain what the analysis means or how to monitor a related signal.
When using general technical-analysis knowledge, clearly connect it back to ${symbol}'s provided analysis and avoid inventing new market data.
If asked about anything unrelated to this analysis (other stocks, unrelated macro topics, personal portfolio advice, or predictions that require data not provided here), politely decline in Korean: "이 분석 결과와 관련된 질문만 답변할 수 있어요."
Do not refuse a question only because the exact wording is absent from the report if the question naturally follows from the analysis context.

The user is NOT a technical trader — they may not know terms like RSI, MACD, or support levels.
Explain everything in plain, friendly Korean. Use natural analogies when they genuinely help understanding, but avoid forced comparisons.
Respond in Korean (한국어) in a warm, conversational tone.
When the answer contains multiple contexts, format it with readable markdown:
- use short paragraphs separated by blank lines;
- use bullets for multiple levels, conditions, or actions;
- avoid returning one dense paragraph.

=== ANALYSIS DATA ===
Symbol: ${symbol} | Timeframe: ${timeframe}
Overall Trend: ${analysis.trend} | Risk Level: ${analysis.riskLevel}

Summary:
${analysis.summary}
${
    rec
        ? `
Trading Strategy:
- Position Analysis: ${rec.positionAnalysis ?? 'N/A'}
- Entry: ${rec.entry ?? 'N/A'}
- Exit: ${rec.exit ?? 'N/A'}
- Risk/Reward: ${rec.riskReward ?? 'N/A'}
`
        : ''
}
Key Levels:
- Resistance: ${formatKeyLevels(analysis.keyLevels.resistance)}
- Support: ${formatKeyLevels(analysis.keyLevels.support)}

Detected Patterns: ${formatDetectedPatterns(analysis.patternSummaries)}

Strategy Results:
${formatStrategyResults(analysis.strategyResults)}

Indicator Signals:
${formatIndicatorSignals(analysis.indicatorResults) || 'None'}

Price Targets:
- Bullish scenario: ${formatPriceTargets(analysis.priceTargets.bullish)}
- Bearish scenario: ${formatPriceTargets(analysis.priceTargets.bearish)}
=== END ANALYSIS DATA ===${formatCurrentAnalysisContext(currentAnalysisContext)}`;

    const messages = [
        ...history.map(m => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content: userMessage }, // literal type 추론 보조 — 런타임 값 변경 없음
    ];

    return { systemPrompt, messages };
}
