// IMPORTANT: System prompt strings must be written in English.
// Korean reduces LLM instruction-following consistency.

import type {
    AnalysisResponse,
    ChatMessage,
    ChatPromptPayload,
    KeyLevel,
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
 * @returns The prompt payload — see {@link ChatPromptPayload}.
 */
export function buildChatPrompt(
    symbol: string,
    timeframe: Timeframe,
    analysis: AnalysisResponse,
    history: ChatMessage[],
    userMessage: string
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

Indicator Signals:
${formatIndicatorSignals(analysis.indicatorResults) || 'None'}

Price Targets:
- Bullish scenario: ${formatPriceTargets(analysis.priceTargets.bullish)}
- Bearish scenario: ${formatPriceTargets(analysis.priceTargets.bearish)}
=== END ANALYSIS DATA ===`;

    const messages = [
        ...history.map(m => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content: userMessage }, // literal type 추론 보조 — 런타임 값 변경 없음
    ];

    return { systemPrompt, messages };
}
