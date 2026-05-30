import { describe, it, expect } from 'vitest';
import {
    AI_SYSTEM_PROMPT,
    OVERALL_SYSTEM_PROMPT,
    NEWS_SYSTEM_PROMPT,
    NEWS_CARD_SYSTEM_PROMPT,
    FUNDAMENTAL_SYSTEM_PROMPT,
    OPTIONS_SYSTEM_PROMPT,
} from '@/domain/analysis/systemPrompt';

/**
 * Each per-analysis prompt is composed of a distinct persona first line followed
 * by the shared {@link ANALYSIS_SYSTEM_BASE}. The persona constants are
 * module-internal (not re-exported from the package barrel) but the test imports
 * them directly from the module file.
 */
const PROMPTS: Array<{
    name: string;
    value: string;
    personaFirstLine: string;
}> = [
    {
        name: 'AI_SYSTEM_PROMPT',
        value: AI_SYSTEM_PROMPT,
        personaFirstLine:
            'You are a senior technical analyst specializing in equity chart analysis.',
    },
    {
        name: 'OVERALL_SYSTEM_PROMPT',
        value: OVERALL_SYSTEM_PROMPT,
        personaFirstLine: 'You are a senior investment analyst.',
    },
    {
        name: 'NEWS_SYSTEM_PROMPT',
        value: NEWS_SYSTEM_PROMPT,
        personaFirstLine: 'You are a financial news analyst.',
    },
    {
        name: 'NEWS_CARD_SYSTEM_PROMPT',
        value: NEWS_CARD_SYSTEM_PROMPT,
        personaFirstLine: 'You are a financial news summarizer.',
    },
    {
        name: 'FUNDAMENTAL_SYSTEM_PROMPT',
        value: FUNDAMENTAL_SYSTEM_PROMPT,
        personaFirstLine: 'You are a fundamental and valuation analyst.',
    },
    {
        name: 'OPTIONS_SYSTEM_PROMPT',
        value: OPTIONS_SYSTEM_PROMPT,
        personaFirstLine: 'You are an options strategist.',
    },
];

describe('analysis system prompts', () => {
    it.each(PROMPTS)('$name is a defined non-empty string', ({ value }) => {
        expect(value).not.toBeUndefined();
        expect(typeof value).toBe('string');
        expect(value.length).toBeGreaterThan(0);
    });

    it.each(PROMPTS)(
        '$name starts with its distinct persona first line',
        ({ value, personaFirstLine }) => {
            expect(value.startsWith(personaFirstLine)).toBe(true);
        }
    );

    it.each(PROMPTS)(
        '$name contains the shared CORE PRINCIPLES base',
        ({ value }) => {
            expect(value).toContain('CORE PRINCIPLES');
            expect(value).toContain('Deterministic');
        }
    );

    it.each(PROMPTS)(
        '$name contains the shared JSON-only output contract',
        ({ value }) => {
            expect(value).toContain(
                'Respond with a SINGLE valid JSON object and nothing else.'
            );
            expect(value).toContain('Korean');
        }
    );

    it('each prompt places its persona before the shared base', () => {
        for (const { value } of PROMPTS) {
            expect(value.indexOf('You are')).toBeLessThan(
                value.indexOf('CORE PRINCIPLES')
            );
        }
    });
});
