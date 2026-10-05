import { describe, expect, it } from 'vitest';
import {
    getMacroIndicatorPromptMeta,
    MACRO_INDICATOR_PROMPT_META,
} from '@/domain/economy/indicatorPromptMeta';

/** The nine FMP economic-indicators names the siglens `/economy` page requests. */
const SIGLENS_INDICATOR_NAMES = [
    'federalFunds',
    'inflationRate',
    'CPI',
    'GDP',
    'industrialProductionTotalIndex',
    'smoothedUSRecessionProbabilities',
    'unemploymentRate',
    'totalNonfarmPayroll',
    'initialClaims',
];

describe('MACRO_INDICATOR_PROMPT_META', () => {
    it('covers every indicator name the consumer requests, keyed by the FMP name', () => {
        expect(Object.keys(MACRO_INDICATOR_PROMPT_META).toSorted()).toEqual(
            SIGLENS_INDICATOR_NAMES.toSorted()
        );
    });

    it('gives every entry a label and a unit, and no example sentences in notes', () => {
        for (const meta of Object.values(MACRO_INDICATOR_PROMPT_META)) {
            expect(meta.label.length).toBeGreaterThan(0);
            expect(meta.unit.length).toBeGreaterThan(0);
            expect(meta.note ?? '').not.toMatch(/e\.g\.|for example/i);
        }
    });

    it('treats rate and probability series as percentages', () => {
        for (const name of [
            'federalFunds',
            'inflationRate',
            'unemploymentRate',
            'smoothedUSRecessionProbabilities',
        ]) {
            expect(MACRO_INDICATOR_PROMPT_META[name].unit).toBe('%');
        }
    });
});

describe('getMacroIndicatorPromptMeta', () => {
    it('returns the entry for a known name and null for an unknown one', () => {
        expect(getMacroIndicatorPromptMeta('GDP')?.unit).toBe('USD trillion');
        expect(getMacroIndicatorPromptMeta('unknownSeries')).toBeNull();
    });

    it('never resolves inherited object keys', () => {
        expect(getMacroIndicatorPromptMeta('constructor')).toBeNull();
        expect(getMacroIndicatorPromptMeta('__proto__')).toBeNull();
        expect(getMacroIndicatorPromptMeta('toString')).toBeNull();
    });
});
