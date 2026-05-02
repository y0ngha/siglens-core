// All AI-facing prompt strings must be in English — Korean reduces analysis quality.

import { MIN_CONFIDENCE_WEIGHT } from '@/domain/indicators/constants';
import type { EarningsCalendarItem, EnrichedNewsItem, Skill } from '@/domain/types';
import { formatNullableNumber as fmt } from './promptFormat';

/** Filter skills to news category with sufficient confidence weight. */
function filterNewsSkills(skills: readonly Skill[]): Skill[] {
    return skills.filter(
        s => s.category === 'news' && s.confidenceWeight >= MIN_CONFIDENCE_WEIGHT,
    );
}

/** Format a single enriched news item into a compact block for the prompt. */
function formatNewsItem(item: EnrichedNewsItem, index: number): string {
    const lines = [
        `[${index + 1}] ${item.titleEn}`,
        `    Source: ${item.source} | Published: ${item.publishedAt}`,
        `    Sentiment: ${item.card.sentiment} | Category: ${item.card.category}`,
        `    Summary (KO): ${item.card.summaryKo}`,
    ];
    if (item.card.bodyKo) {
        lines.push(`    Body (KO): ${item.card.bodyKo}`);
    }
    return lines.join('\n');
}

/** Format upcoming earnings calendar items into a compact block. */
function formatCalendarItems(items: readonly EarningsCalendarItem[]): string {
    if (items.length === 0) return '  None scheduled.';
    return items
        .map(item => {
            const eps = fmt(item.epsEstimated);
            const rev = item.revenueEstimated != null
                ? `${(item.revenueEstimated / 1e9).toFixed(1)}B`
                : 'N/A';
            const actEps = item.epsActual != null ? `Actual EPS: ${fmt(item.epsActual)}` : '';
            return `  - ${item.earningsDate}: EPS est. ${eps}${actEps ? ` | ${actEps}` : ''} | Rev est. ${rev}`;
        })
        .join('\n');
}

/**
 * Build the AI news-analysis prompt.
 *
 * Accepts enriched news items (each already tagged with a
 * {@link NewsCardAnalysis} via the flash-lite model), the upcoming earnings
 * calendar, and a list of loaded {@link Skill}s. Only skills with
 * `category === 'news'` and `confidenceWeight >= MIN_CONFIDENCE_WEIGHT` are
 * injected into the prompt.
 *
 * Returns a fully self-contained English prompt string; the JSON output schema
 * specifies Korean text for fields labelled `KO`.
 *
 * @param symbol            - Stock ticker (e.g. `'AAPL'`).
 * @param news              - Enriched news items with per-card analysis.
 * @param upcomingCalendar  - Upcoming or recent earnings events for the symbol.
 * @param skills            - All loaded skills; non-news / low-weight entries are filtered out.
 * @returns Prompt string ready to be sent to the LLM worker.
 */
export function buildNewsAnalysisPrompt(
    symbol: string,
    news: ReadonlyArray<EnrichedNewsItem>,
    upcomingCalendar: readonly EarningsCalendarItem[],
    skills: readonly Skill[],
): string {
    const qualifiedSkills = filterNewsSkills(skills);
    const skillsSection = qualifiedSkills.length > 0
        ? qualifiedSkills.map(s => `### ${s.name}\n${s.content}`).join('\n\n')
        : 'No additional news skills loaded.';

    const newsSection = news.length > 0
        ? news.map((item, i) => formatNewsItem(item, i)).join('\n\n')
        : 'No recent news articles available.';

    const calendarSection = formatCalendarItems(upcomingCalendar);

    return `You are a financial news analyst. Analyze the recent news flow for ${symbol} and respond with a JSON object matching the exact schema below. No markdown, no extra text — only valid JSON.

## Recent News Articles (${news.length} items)
${newsSection}

## Upcoming / Recent Earnings Calendar
${calendarSection}

## News Analysis Frameworks (Active Skills)
${skillsSection}

## Output Schema
{
  "currentDriverKo": "한국어 한 단락 — 현재 가격 흐름의 뉴스 원인 (차트 보강 A 섹션에서 인용됨)",
  "keyEventsKo": [
    "핵심 이벤트 bullet 1 (한국어)",
    "핵심 이벤트 bullet 2 (한국어)"
  ],
  "upcomingEventsKo": [
    "향후 주의 이벤트 bullet 1 (한국어)",
    "향후 주의 이벤트 bullet 2 (한국어)"
  ],
  "overallSentiment": "bullish" | "neutral" | "bearish"
}

Rules:
- Respond with valid JSON only. No markdown fences.
- All KO fields must be written in Korean (존댓말).
- keyEventsKo should cover the 3–5 most market-moving events from the articles above.
- upcomingEventsKo should highlight scheduled catalysts (earnings, regulatory deadlines, etc.).
- overallSentiment reflects the net directional bias of the news flow.`;
}
