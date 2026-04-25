import { describe, it, expect } from 'vitest';
import { AI_SYSTEM_PROMPT } from '@/infrastructure/ai/utils';

describe('AI_SYSTEM_PROMPT', () => {
    it('is a non-empty string', () => {
        expect(typeof AI_SYSTEM_PROMPT).toBe('string');
        expect(AI_SYSTEM_PROMPT.length).toBeGreaterThan(0);
    });

    it('instructs Korean output', () => {
        expect(AI_SYSTEM_PROMPT).toContain('Korean');
    });

    it('instructs JSON-only output', () => {
        expect(AI_SYSTEM_PROMPT).toContain('SINGLE valid JSON object');
    });

    it('contains Deterministic principle', () => {
        expect(AI_SYSTEM_PROMPT).toContain('Deterministic');
    });
});
