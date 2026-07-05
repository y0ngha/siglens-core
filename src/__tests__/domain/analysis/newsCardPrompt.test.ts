import { describe, it, expect } from 'vitest';
import { buildNewsCardAnalysisPrompt as buildNewsCardAnalysisPromptRaw } from '@/domain/analysis/newsCardPrompt';
import type { NewsItem } from '@/domain/types';

// `buildNewsCardAnalysisPrompt` now returns `{ stable, dynamic }` (spec §3.4
// assembly split) — this file's call sites predate the split and assert
// against the single legacy combined string (`stable + '\n\n' + dynamic`,
// exactly the string dispatch still sends as the `prompt` fallback field).
const buildNewsCardAnalysisPrompt = (
    ...args: Parameters<typeof buildNewsCardAnalysisPromptRaw>
): string => {
    const { stable, dynamic } = buildNewsCardAnalysisPromptRaw(...args);
    return `${stable}\n\n${dynamic}`;
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

const FULL_NEWS_ITEM: NewsItem = {
    id: 'news-001',
    symbol: 'NVDA',
    source: 'Bloomberg',
    url: 'https://bloomberg.com/nvda-ai-chips',
    publishedAt: '2025-04-28T14:30:00Z',
    titleEn:
        'Nvidia unveils next-gen AI chip platform targeting data center workloads',
    bodyEn: 'Nvidia Corporation announced its next generation of AI-focused GPU chips on Monday, targeting enterprise data center customers. The new platform promises a 3x performance improvement over the previous generation.',
};

const NULL_BODY_NEWS_ITEM: NewsItem = {
    id: 'news-002',
    symbol: 'TSLA',
    source: 'Reuters',
    url: 'https://reuters.com/tsla-delivery',
    publishedAt: '2025-04-27T10:00:00Z',
    titleEn: 'Tesla misses Q1 delivery estimates for third consecutive quarter',
    bodyEn: null,
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('buildNewsCardAnalysisPrompt', () => {
    it('produces a prompt with full structure including JSON schema and all required output fields', () => {
        const prompt = buildNewsCardAnalysisPrompt(FULL_NEWS_ITEM);

        // Source metadata
        expect(prompt).toContain('NVDA');
        expect(prompt).toContain('Bloomberg');
        expect(prompt).toContain('2025-04-28T14:30:00Z');
        expect(prompt).toContain(
            'Nvidia unveils next-gen AI chip platform targeting data center workloads'
        );
        expect(prompt).toContain('Nvidia Corporation announced');

        // Output schema fields
        expect(prompt).toContain('titleKo');
        expect(prompt).toContain('bodyKo');
        expect(prompt).toContain('summaryKo');
        expect(prompt).toContain(
            'what happened, why it matters for the named symbol, and what investors should watch'
        );
        expect(prompt).toContain('must add substance beyond the title');
        expect(prompt).toContain('reported figures, growth rates, guidance');
        expect(prompt).toContain(
            'never omit material information merely to satisfy brevity'
        );
        expect(prompt).not.toContain('80-140');
        // Few-shot good/bad pair for summaryKo
        expect(prompt).toContain('Few-shot for summaryKo');
        expect(prompt).toContain('BAD (restates/translates the title');
        expect(prompt).toContain("GOOD (resolves the body's actual point");
        expect(prompt).toContain('Preserve important numbers');
        expect(prompt).toContain('sentiment');
        expect(prompt).toContain('category');

        // Sentiment and category options must be specified
        expect(prompt).toContain('bullish');
        expect(prompt).toContain('bearish');
        expect(prompt).toContain('neutral');
        expect(prompt).toContain('earnings');
        expect(prompt).toContain('regulation');

        // Instruction to return JSON only
        expect(prompt).toContain('JSON');
        expect(prompt).toContain('Data Boundary');
        expect(prompt).toContain('untrusted source data');
        expect(prompt).toContain('Do not fabricate missing article body text');
        expect(prompt).toContain('## Allowed Values');
        expect(prompt).toContain('sentiment: "bullish", "neutral", "bearish"');
        expect(prompt).toContain(
            'category: "earnings", "m_and_a", "guidance", "regulation", "macro", "product", "other"'
        );
        expect(prompt).toContain(
            'priceImpact: "high", "medium", "low", "negligible"'
        );
    });

    it('handles a news item with null body by omitting body section gracefully', () => {
        const prompt = buildNewsCardAnalysisPrompt(NULL_BODY_NEWS_ITEM);

        // Symbol and title still present
        expect(prompt).toContain('TSLA');
        expect(prompt).toContain('Tesla misses Q1 delivery estimates');

        // Output schema still requests bodyKo (nullable)
        expect(prompt).toContain('bodyKo');

        // Should not throw or include "null" as a raw literal in article body
        expect(prompt).not.toContain('\nbodyEn: null');
        expect(prompt).not.toContain('Body: null');
        expect(prompt).toContain(
            'prefer sentiment: "neutral" and priceImpact: "negligible" rather than guessing'
        );
        expect(prompt).toContain(
            'based only on the headline and avoid guessing missing details'
        );
    });
});
