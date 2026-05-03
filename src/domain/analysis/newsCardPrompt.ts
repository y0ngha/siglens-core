// All AI-facing prompt strings must be in English — Korean reduces analysis quality.

import type { NewsItem } from '@/domain/types';

/**
 * Build the per-card news analysis prompt for the flash-lite model.
 *
 * Each {@link NewsItem} is processed individually: this prompt asks the model
 * to translate the title and body to Korean, produce a one-line Korean summary,
 * assign a sentiment label, and categorise the news theme — all returned as a
 * single JSON object.
 *
 * Intended for high-volume batch calls using `gemini-2.5-flash-lite` where
 * latency and cost per card are critical. No skill injection needed — the task
 * is purely translation + classification, not market interpretation.
 *
 * @param item - The raw news article to analyse.
 * @returns Prompt string ready to be sent to the flash-lite LLM.
 */
export function buildNewsCardAnalysisPrompt(item: NewsItem): string {
    const bodySection =
        item.bodyEn != null
            ? `Body:\n${item.bodyEn}`
            : '(No article body available — analyse title only.)';

    return `You are a financial news translator and classifier. Analyse the article below and respond with a JSON object matching the exact schema provided. No markdown, no extra text — only valid JSON.

## Article Metadata
- Symbol: ${item.symbol}
- Source: ${item.source}
- Published: ${item.publishedAt}
- URL: ${item.url}

## Article Content
Title: ${item.titleEn}
${bodySection}

## Output Schema
{
  "titleKo": "한국어 번역 제목",
  "bodyKo": "한국어 번역 본문 (body가 없으면 null)",
  "summaryKo": "한국어 한 줄 요약 (최대 60자)",
  "sentiment": "bullish" | "neutral" | "bearish",
  "category": "earnings" | "m_and_a" | "guidance" | "regulation" | "macro" | "product" | "other"
}

Rules:
- Respond with valid JSON only. No markdown fences.
- titleKo: natural Korean translation of the English title.
- bodyKo: natural Korean translation of the article body; null if no body was provided.
- summaryKo: a single concise Korean sentence capturing the most important point (존댓말).
- sentiment: the directional market implication for the named symbol — bullish if positive catalyst, bearish if negative, neutral if ambiguous or unrelated.
- category: the dominant news theme from the provided options.`;
}
