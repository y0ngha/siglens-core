import { describe, it, expect } from 'vitest';
import { buildNewsCardAnalysisPrompt } from '@/domain/analysis/newsCardPrompt';
import type { NewsItem } from '@/domain/types';

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
    });
});
