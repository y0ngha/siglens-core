import { describe, it, expect } from 'vitest';
import { buildOptionsAnalysisPrompt } from '@/domain/options/optionsPrompt';
import type { OptionsSnapshot } from '@/domain/options/types';

describe('buildOptionsAnalysisPrompt', () => {
    const snapshot: OptionsSnapshot = {
        symbol: 'AAPL',
        underlyingPrice: 198,
        capturedAt: '2026-05-14T16:00:00Z',
        chains: [
            {
                expirationDate: '2026-05-22',
                daysToExpiration: 8,
                calls: [],
                puts: [],
            },
            {
                expirationDate: '2026-06-19',
                daysToExpiration: 36,
                calls: [],
                puts: [],
            },
        ],
    };

    it('filters to specific expiration when given', () => {
        const prompt = buildOptionsAnalysisPrompt({
            expirationDate: '2026-05-22',
            companyName: 'Apple Inc.',
            snapshot,
        });
        expect(prompt).toContain('2026-05-22');
        expect(prompt).not.toContain('2026-06-19');
    });

    it('uses all chains when expirationDate is "all"', () => {
        const prompt = buildOptionsAnalysisPrompt({
            expirationDate: 'all',
            companyName: 'Apple Inc.',
            snapshot,
        });
        expect(prompt).toContain('2026-05-22');
        expect(prompt).toContain('2026-06-19');
    });

    it('includes company name and current price', () => {
        const prompt = buildOptionsAnalysisPrompt({
            expirationDate: 'all',
            companyName: 'Apple Inc.',
            snapshot,
        });
        expect(prompt).toContain('Apple Inc.');
        expect(prompt).toContain('AAPL');
        expect(prompt).toContain('$198');
    });

    it('includes interpretation guidance for topVolumeStrikes and topOiBidAskSummary', () => {
        const prompt = buildOptionsAnalysisPrompt({
            expirationDate: 'all',
            companyName: 'Apple Inc.',
            snapshot,
        });
        expect(prompt).toContain('topVolumeStrikes');
        expect(prompt).toContain('topOiBidAskSummary');
    });

    it('uses English instructions without markdown JSON fences', () => {
        const prompt = buildOptionsAnalysisPrompt({
            expirationDate: 'all',
            companyName: 'Apple Inc.',
            snapshot,
        });
        expect(prompt).toContain('You are an options market analyst');
        expect(prompt).toContain('Current price:');
        expect(prompt).toContain('== Output Schema ==');
        expect(prompt).toContain('== Interpretation Guide ==');
        expect(prompt).toContain(
            'Respond with valid JSON only. No markdown fences.'
        );
        expect(prompt).not.toContain('```json');
    });

    it('keeps the output schema fields and Korean output directives', () => {
        const prompt = buildOptionsAnalysisPrompt({
            expirationDate: 'all',
            companyName: 'Apple Inc.',
            snapshot,
        });
        expect(prompt).toContain('"summary"');
        expect(prompt).toContain('"perExpiration"');
        expect(prompt).toContain('"signals"');
        expect(prompt).toContain('"expirationDate"');
        expect(prompt).toContain('"commentary"');
        expect(prompt).toContain('"tone"');
        expect(prompt).toContain('"kind"');
        expect(prompt).toContain('"message"');
        expect(prompt).toContain('bullish | bearish | neutral | cautious');
        expect(prompt).toContain('bullish | bearish | neutral | volatility');
        // Model output must remain Korean.
        expect(prompt).toContain('전체 옵션 시장에 대한 한 문단 요약');
    });
});
