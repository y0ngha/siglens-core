import { describe, it, expect } from 'vitest';
import { buildOptionsAnalysisPrompt as buildOptionsAnalysisPromptRaw } from '@/domain/options/optionsPrompt';
import type { OptionsSnapshot } from '@/domain/options/types';

// `buildOptionsAnalysisPrompt` now returns `{ stable, dynamic }` (spec §3.4
// assembly split) — this file's call sites predate the split and assert
// against the single legacy combined string (`stable + '\n\n' + dynamic`,
// exactly the string dispatch still sends as the `prompt` fallback field).
const buildOptionsAnalysisPrompt = (
    ...args: Parameters<typeof buildOptionsAnalysisPromptRaw>
): string => {
    const { stable, dynamic } = buildOptionsAnalysisPromptRaw(...args);
    return `${stable}\n\n${dynamic}`;
};

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

    const allExpirationsPrompt = buildOptionsAnalysisPrompt({
        expirationDate: 'all',
        companyName: 'Apple Inc.',
        snapshot,
    });

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
        expect(allExpirationsPrompt).toContain('2026-05-22');
        expect(allExpirationsPrompt).toContain('2026-06-19');
    });

    it('includes company name and current price', () => {
        expect(allExpirationsPrompt).toContain('Apple Inc.');
        expect(allExpirationsPrompt).toContain('AAPL');
        expect(allExpirationsPrompt).toContain('$198');
    });

    it('includes interpretation guidance for topVolumeStrikes and topOiBidAskSummary', () => {
        expect(allExpirationsPrompt).toContain('topVolumeStrikes');
        expect(allExpirationsPrompt).toContain('topOiBidAskSummary');
    });

    it('uses English instructions without markdown JSON fences', () => {
        expect(allExpirationsPrompt).toContain(
            'You are an options market analyst'
        );
        expect(allExpirationsPrompt).toContain('Current price:');
        expect(allExpirationsPrompt).toContain('== Output Schema ==');
        expect(allExpirationsPrompt).toContain('== Interpretation Guide ==');
        expect(allExpirationsPrompt).toContain(
            'Respond with valid JSON only. No markdown fences.'
        );
        expect(allExpirationsPrompt).not.toContain('```json');
    });

    it('keeps the output schema field names', () => {
        expect(allExpirationsPrompt).toContain('"summary"');
        expect(allExpirationsPrompt).toContain('"perExpiration"');
        expect(allExpirationsPrompt).toContain('"signals"');
        expect(allExpirationsPrompt).toContain('"expirationDate"');
        expect(allExpirationsPrompt).toContain('"commentary"');
        expect(allExpirationsPrompt).toContain('"tone"');
        expect(allExpirationsPrompt).toContain('"kind"');
        expect(allExpirationsPrompt).toContain('"message"');
    });

    it('keeps the Korean output directives and tone/kind enums', () => {
        expect(allExpirationsPrompt).toContain(
            'bullish | bearish | neutral | cautious'
        );
        expect(allExpirationsPrompt).toContain(
            'bullish | bearish | neutral | volatility'
        );
        // Model output must remain Korean.
        expect(allExpirationsPrompt).toContain(
            '전체 옵션 시장에 대한 한 문단 요약'
        );
    });
});
