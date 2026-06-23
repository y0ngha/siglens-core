import { describe, it, expect } from 'vitest';
import { buildChatPrompt } from '@/domain/chat/buildChatPrompt';
import { buildNewsAnalysisPrompt } from '@/domain/analysis/newsPrompt';
import { buildOverallAnalysisPrompt } from '@/domain/analysis/overallPrompt';
import type {
    AnalysisResponse,
    CurrentAnalysisContext,
    FundamentalAnalysisResponse,
    NewsAnalysisResponse,
} from '@/domain/types';

// ─── Shared fixtures ────────────────────────────────────────────────────────

const analysis: AnalysisResponse = {
    summary: 'Test summary.',
    trend: 'bullish',
    riskLevel: 'medium',
    indicatorResults: [],
    keyLevels: { support: [], resistance: [] },
    priceTargets: {
        bullish: { targets: [], condition: '' },
        bearish: { targets: [], condition: '' },
    },
    patternSummaries: [],
    strategyResults: [],
    candlePatterns: [],
    trendlines: [],
};

const mockFundamental: FundamentalAnalysisResponse = {
    overallConclusionKo: '펀더멘털 테스트.',
    categoryAssessments: [],
    riskFactorsKo: [],
    overallSentiment: 'neutral',
};

const mockNews: NewsAnalysisResponse = {
    currentDriverKo: '뉴스 테스트.',
    keyEventsKo: [],
    upcomingEventsKo: [],
    overallSentiment: 'neutral',
};

// ─── buildChatPrompt — assetClass framing ───────────────────────────────────

describe('buildChatPrompt assetClass framing', () => {
    it('equity chat (default): contains U.S. equity wording and equity refusal example', () => {
        const payload = buildChatPrompt(
            'AAPL',
            'Apple',
            '1Day',
            analysis,
            [],
            'How is it?'
        );
        const text = payload.systemPrompt;
        expect(text).toContain('U.S. equity');
        // Equity-specific refusal example references "다른 종목"
        expect(text).toContain('다른 종목');
    });

    it('crypto chat (assetClass param): contains cryptocurrency wording and crypto refusal example', () => {
        const payload = buildChatPrompt(
            'BTCUSD',
            'Bitcoin',
            '1Day',
            analysis,
            [],
            'Is now a good entry?',
            undefined, // no currentAnalysisContext
            'crypto'
        );
        const text = payload.systemPrompt;
        // Must use crypto asset kind
        expect(text).toContain('cryptocurrency');
        // Must include crypto-specific refusal example
        expect(text).toContain('다른 코인');
        // Must NOT use equity framing
        expect(text).not.toMatch(/U\.S\. equity/i);
        // Must NOT use the equity-specific "다른 종목" wording
        expect(text).not.toContain('다른 종목');
    });

    it('R1: assetClass=crypto with NO currentAnalysisContext does NOT emit a "## Current analysis context" section', () => {
        // This is the core R1 regression guard: a framing-only flag must not
        // produce a duplicate context section.
        const payload = buildChatPrompt(
            'BTCUSD',
            'Bitcoin',
            '1Day',
            analysis,
            [],
            'Is now a good entry?',
            undefined, // explicitly no context
            'crypto'
        );
        expect(payload.systemPrompt).not.toContain(
            '## Current analysis context'
        );
        // But crypto framing is still applied
        expect(payload.systemPrompt).toContain('cryptocurrency');
    });

    it('R1: currentAnalysisContext IS emitted when explicitly provided alongside assetClass=crypto', () => {
        const context: CurrentAnalysisContext = {
            kind: 'news',
            payload: mockNews,
        };
        const payload = buildChatPrompt(
            'BTCUSD',
            'Bitcoin',
            '1Day',
            analysis,
            [],
            'What is the news sentiment?',
            context,
            'crypto'
        );
        // Context section must appear (caller explicitly provided it)
        expect(payload.systemPrompt).toContain('## Current analysis context');
        expect(payload.systemPrompt).toContain('Kind: news');
        // Crypto framing is also applied
        expect(payload.systemPrompt).toContain('cryptocurrency');
    });

    it('equity chat with currentAnalysisContext emits the context section', () => {
        const context: CurrentAnalysisContext = {
            kind: 'technical',
            payload: analysis,
        };
        const payload = buildChatPrompt(
            'AAPL',
            'Apple',
            '1Day',
            analysis,
            [],
            'How is it?',
            context
        );
        expect(payload.systemPrompt).toContain('## Current analysis context');
        expect(payload.systemPrompt).toContain('Kind: technical');
        expect(payload.systemPrompt).toContain('U.S. equity');
    });
});

// ─── buildNewsAnalysisPrompt — crypto drops earnings framing ────────────────

describe('buildNewsAnalysisPrompt assetClass framing', () => {
    it('equity (default): contains U.S. equity framing', () => {
        const prompt = buildNewsAnalysisPrompt(
            'AAPL',
            'Apple Inc.',
            [],
            [],
            [],
            'equity'
        );
        expect(prompt).toContain('publicly traded U.S. equity');
        expect(prompt).not.toContain('cryptocurrency');
    });

    it('crypto: drops earnings/analyst framing and includes crypto framing', () => {
        const prompt = buildNewsAnalysisPrompt(
            'BTCUSD',
            'Bitcoin',
            [],
            [],
            [],
            'crypto'
        );
        // Must use crypto context
        expect(prompt).toContain('cryptocurrency');
        expect(prompt).toContain('no earnings reports');
        // Must NOT include U.S. equity framing
        expect(prompt).not.toContain('publicly traded U.S. equity');
    });
});

// ─── buildOverallAnalysisPrompt — crypto opener (R2) ───────────────────────

describe('buildOverallAnalysisPrompt assetClass framing (R2)', () => {
    it('equity (default): role line says "senior equity analyst" and "four-axis data"', () => {
        const prompt = buildOverallAnalysisPrompt(
            'AAPL',
            'Apple Inc.',
            analysis,
            mockFundamental,
            mockNews,
            '1Day',
            undefined,
            null,
            false,
            null,
            'equity'
        );
        // The very first line of the prompt must use the equity role.
        const firstLine = prompt.split('\n')[0] ?? '';
        expect(firstLine).toContain('senior equity analyst');
        expect(firstLine).toContain('four-axis data');
        expect(firstLine).not.toContain('senior markets analyst');
        expect(firstLine).not.toContain('available-axis');
    });

    it('crypto: role line uses neutral "senior markets analyst" and "available-axis data" — no equity-analyst or four-axis in the opener', () => {
        const prompt = buildOverallAnalysisPrompt(
            'BTCUSD',
            'Bitcoin',
            analysis,
            mockFundamental,
            mockNews,
            '1Day',
            undefined,
            null,
            false,
            null,
            'crypto'
        );
        const firstLine = prompt.split('\n')[0] ?? '';
        expect(firstLine).toContain('senior markets analyst');
        expect(firstLine).toContain('available-axis data');
        expect(firstLine).not.toContain('senior equity analyst');
        expect(firstLine).not.toContain('four-axis data');
        // The crypto branch must be internally consistent: no "four-axis data"
        // wording anywhere (R2 round-2 fix — the Data Boundary line previously
        // hardcoded "four-axis data", contradicting the crypto opener).
        expect(prompt).not.toContain('four-axis data');
        expect(prompt).toContain('available-axis data as evidence');
    });

    it('equity Data Boundary keeps the "four-axis data as evidence" wording', () => {
        const prompt = buildOverallAnalysisPrompt(
            'AAPL',
            'Apple Inc.',
            analysis,
            mockFundamental,
            mockNews,
            '1Day',
            undefined,
            null,
            false,
            null,
            'equity'
        );
        expect(prompt).toContain('four-axis data as evidence');
        expect(prompt).not.toContain('available-axis data');
    });

    it('crypto: Axis 2 section contains the empty-array instruction for fundamentalBulletsKo', () => {
        const prompt = buildOverallAnalysisPrompt(
            'BTCUSD',
            'Bitcoin',
            analysis,
            mockFundamental,
            mockNews,
            '1Day',
            undefined,
            null,
            false,
            null,
            'crypto'
        );
        // Verify the exact text emitted by overallPrompt.ts for the crypto Axis 2 branch.
        expect(prompt).toContain('## Axis 2 — Fundamental Analysis');
        expect(prompt).toContain(
            'This asset is a cryptocurrency and is not subject to corporate fundamental analysis. Keep fundamentalBulletsKo as an empty array.'
        );
    });
});
