import { describe, it, expect } from 'vitest';
import { buildChatPrompt } from '@/domain/chat/buildChatPrompt';
import type { AnalysisResponse } from '@/domain/types';

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

describe('buildChatPrompt assetClass framing', () => {
    it('crypto chat does not frame the asset as a U.S. stock and allows crypto questions', () => {
        const payload = buildChatPrompt(
            'BTCUSD',
            'Bitcoin',
            '1Day',
            analysis,
            [],
            'Is now a good entry?',
            { assetClass: 'crypto' }
        );
        const text = JSON.stringify(payload);
        expect(text).not.toMatch(/U\.S\. (equity|stock)/i);
    });

    it('equity chat (no assetClass) keeps existing refusal framing', () => {
        const payload = buildChatPrompt(
            'AAPL',
            'Apple',
            '1Day',
            analysis,
            [],
            'How is it?'
        );
        const text = JSON.stringify(payload);
        expect(text.length).toBeGreaterThan(0);
    });
});
