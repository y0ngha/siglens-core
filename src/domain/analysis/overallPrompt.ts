// All AI-facing prompt strings must be in English — Korean reduces analysis quality.

import type {
    AnalysisResponse,
    FundamentalAnalysisResponse,
    NewsAnalysisResponse,
    Timeframe,
} from '@/domain/types';

/**
 * Human-readable label for each timeframe displayed in the prompt header.
 *
 * Matches the canonical {@link Timeframe} literals used throughout the codebase.
 */
const TIMEFRAME_LABEL: Record<Timeframe, string> = {
    '5Min': '5-Minute',
    '15Min': '15-Minute',
    '30Min': '30-Minute',
    '1Hour': '1-Hour',
    '4Hour': '4-Hour',
    '1Day': 'Daily',
};

/**
 * Timeframe context injected into the prompt to orient the LLM analyst.
 *
 * Short-term frames emphasise intraday price dynamics; longer frames shift
 * focus to positional and multi-day trend analysis.
 */
const TIMEFRAME_CONTEXT: Record<Timeframe, string> = {
    '5Min': 'Very short-term intraday chart. Focus on immediate momentum and near-term price catalysts. Macro and fundamental inputs should be treated as background context, not primary drivers.',
    '15Min':
        'Short-term intraday chart. Integrate technical signals with news flow. Fundamental data provides context for intraday support/resistance interpretation.',
    '30Min':
        'Intraday chart with moderate signal reliability. Technical, fundamental, and news inputs carry roughly equal weight. Identify the dominant intraday trend.',
    '1Hour':
        'Medium-term chart. Divergences and cross-axis confirmations (technical + fundamental + news) carry meaningful weight. Good for swing entry/exit evaluation.',
    '4Hour':
        'Swing trading positional chart. All three axes (technical, fundamental, news) should converge before taking a strong directional stance. Multi-day trends dominate.',
    '1Day': 'Daily positional chart. Fundamental valuation and news catalysts carry high weight alongside technical signals. Use for medium- to long-term position analysis.',
};

/** Formats technical analysis fields (trend, risk, key levels, price targets, patterns) into prompt lines. */
function formatTechnical(tech: AnalysisResponse): string {
    const lines: string[] = [
        `- Overall Trend: ${tech.trend}`,
        `- Risk Level: ${tech.riskLevel}`,
        `- Summary: ${tech.summary}`,
    ];

    if (tech.keyLevels.support.length > 0) {
        const supports = tech.keyLevels.support
            .map(l => `${l.price.toFixed(2)} (${l.reason})`)
            .join(', ');
        lines.push(`- Key Support Levels: ${supports}`);
    }

    if (tech.keyLevels.resistance.length > 0) {
        const resistances = tech.keyLevels.resistance
            .map(l => `${l.price.toFixed(2)} (${l.reason})`)
            .join(', ');
        lines.push(`- Key Resistance Levels: ${resistances}`);
    }

    if (tech.priceTargets.bullish) {
        const targets = tech.priceTargets.bullish.targets
            .map(t => t.price.toFixed(2))
            .join(', ');
        lines.push(
            `- Bullish Targets: ${targets} — ${tech.priceTargets.bullish.condition}`
        );
    }

    if (tech.priceTargets.bearish) {
        const targets = tech.priceTargets.bearish.targets
            .map(t => t.price.toFixed(2))
            .join(', ');
        lines.push(
            `- Bearish Targets: ${targets} — ${tech.priceTargets.bearish.condition}`
        );
    }

    if (tech.patternSummaries.length > 0) {
        lines.push(
            `- Chart Patterns: ${tech.patternSummaries.map(p => p.patternName).join(', ')}`
        );
    }

    return lines.join('\n');
}

/** Formats fundamental analysis fields (sentiment, conclusion, per-category assessments, risk factors) into prompt lines. */
function formatFundamental(fund: FundamentalAnalysisResponse): string {
    const lines: string[] = [
        `- Overall Sentiment: ${fund.overallSentiment}`,
        `- Conclusion (KO): ${fund.overallConclusionKo}`,
    ];

    for (const assessment of fund.categoryAssessments) {
        lines.push(
            `- ${assessment.category} [${assessment.sentiment}]: ${assessment.rationaleKo}`
        );
    }

    if (fund.riskFactorsKo.length > 0) {
        lines.push(`- Risk Factors: ${fund.riskFactorsKo.join(' | ')}`);
    }

    return lines.join('\n');
}

/** Formats news analysis fields (sentiment, current driver, key events, upcoming events) into prompt lines. */
function formatNews(news: NewsAnalysisResponse): string {
    const lines: string[] = [
        `- Overall Sentiment: ${news.overallSentiment}`,
        `- Current Driver (KO): ${news.currentDriverKo}`,
    ];

    if (news.keyEventsKo.length > 0) {
        lines.push(`- Key Events: ${news.keyEventsKo.join(' | ')}`);
    }

    if (news.upcomingEventsKo.length > 0) {
        lines.push(`- Upcoming Events: ${news.upcomingEventsKo.join(' | ')}`);
    }

    return lines.join('\n');
}

/**
 * Build the 3-axis overall analysis prompt.
 *
 * Combines completed technical, fundamental, and news analysis results into a
 * single comprehensive prompt that asks the LLM to synthesise all three axes
 * into an overall verdict with scenario analysis.
 *
 * The timeframe context dictionary orients the LLM for either intraday
 * (5Min–30Min) or positional (1Hour–1Day) interpretation weighting.
 *
 * @param symbol      - Stock ticker (e.g. `'AAPL'`).
 * @param technical   - Completed technical analysis result.
 * @param fundamental - Completed fundamental analysis result.
 * @param news        - Completed news analysis result.
 * @param timeframe   - The chart timeframe; determines interpretation context.
 * @returns Prompt string ready to be sent to the LLM worker.
 */
export function buildOverallAnalysisPrompt(
    symbol: string,
    technical: AnalysisResponse,
    fundamental: FundamentalAnalysisResponse,
    news: NewsAnalysisResponse,
    timeframe: Timeframe
): string {
    const label = TIMEFRAME_LABEL[timeframe];
    const context = TIMEFRAME_CONTEXT[timeframe];

    return `You are a senior equity analyst integrating technical, fundamental, and news analysis into a unified investment verdict. Analyse the three-axis data for ${symbol} on the ${label} (${timeframe}) timeframe and respond with a JSON object matching the exact schema below. No markdown, no extra text — only valid JSON.

## Timeframe Context
${context}

## Axis 1 — Technical Analysis
${formatTechnical(technical)}

## Axis 2 — Fundamental Analysis
${formatFundamental(fundamental)}

## Axis 3 — News Analysis
${formatNews(news)}

## Output Schema
{
  "headlineKo": "한국어 한 줄 정의 + 현재 상태 1단락",
  "technicalBulletsKo": [
    "기술적 분석 요약 bullet 1 (한국어)",
    "기술적 분석 요약 bullet 2 (한국어)"
  ],
  "fundamentalBulletsKo": [
    "펀더멘털 요약 bullet 1 (한국어)",
    "펀더멘털 요약 bullet 2 (한국어)"
  ],
  "newsBulletsKo": [
    "뉴스 요약 bullet 1 (한국어)",
    "뉴스 요약 bullet 2 (한국어)"
  ],
  "threeAxisConclusionKo": "3축 종합 결론 (한 단락 또는 두 단락, 한국어)",
  "scenarios": [
    {
      "name": "bullish" | "neutral" | "bearish",
      "triggerConditionKo": "시나리오 발동 조건 (한국어)",
      "priceRangeKo": "예상 가격대 (한국어)"
    }
  ],
  "riskFactorsKo": ["위험 요인 1 (한국어)", "위험 요인 2 (한국어)"]
}

Rules:
- Respond with valid JSON only. No markdown fences.
- All KO fields must be written in Korean (존댓말).
- scenarios must include all three entries: bullish, neutral, bearish — in any order.
- technicalBulletsKo, fundamentalBulletsKo, newsBulletsKo: provide 2–4 bullets each.
- riskFactorsKo: list 3–5 key risk factors combining all three axes.
- threeAxisConclusionKo: synthesise all three axes into a cohesive directional verdict appropriate for the ${timeframe} timeframe context described above.`;
}
