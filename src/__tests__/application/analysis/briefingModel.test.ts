import { describe, expect, it } from 'vitest';
import { resolveBriefingModel } from '@/application/analysis/briefingModel';
import type { ActiveModelId } from '@/domain/types';

// Configured server-side default — BRIEFING_MODEL_ID switched to
// deepseek-v4-flash, so this mirrors the deepseek default rather than the
// previous Gemini-only default.
const FALLBACK: ActiveModelId = 'deepseek-v4.1-flash';

describe('resolveBriefingModel', () => {
    it('returns the request-supplied model when it is a valid Gemini model', () => {
        expect(resolveBriefingModel('gemini-3.6-flash', FALLBACK)).toBe(
            'gemini-3.6-flash'
        );
        expect(resolveBriefingModel('gemini-3.1-pro-preview', FALLBACK)).toBe(
            'gemini-3.1-pro-preview'
        );
    });

    it('returns the request-supplied model when it is a valid DeepSeek model', () => {
        expect(resolveBriefingModel('deepseek-v4.1-flash', FALLBACK)).toBe(
            'deepseek-v4.1-flash'
        );
        expect(resolveBriefingModel('deepseek-v4.1-pro', FALLBACK)).toBe(
            'deepseek-v4.1-pro'
        );
    });

    it('falls back to the configured default when the model is absent', () => {
        expect(resolveBriefingModel(undefined, FALLBACK)).toBe(FALLBACK);
        expect(resolveBriefingModel('', FALLBACK)).toBe(FALLBACK);
    });

    it('falls back to the default for a supported-but-non-briefing model (claude/gpt) — graceful degradation', () => {
        // claude/gpt are real, supported models but callBriefingAi cannot route
        // them, so the resolver degrades to the briefing-capable default instead
        // of returning a model that would later throw in callBriefingAi.
        expect(resolveBriefingModel('claude-opus-5', FALLBACK)).toBe(FALLBACK);
        expect(resolveBriefingModel('gpt-5.6-sol', FALLBACK)).toBe(FALLBACK);
    });

    it('falls back to the configured default for an unknown/bogus model string', () => {
        expect(resolveBriefingModel('not-a-real-model', FALLBACK)).toBe(
            FALLBACK
        );
        expect(resolveBriefingModel('gemini-9-ultra', FALLBACK)).toBe(FALLBACK);
    });

    it('falls back to the configured default for non-string values', () => {
        expect(resolveBriefingModel(null, FALLBACK)).toBe(FALLBACK);
        expect(resolveBriefingModel(42, FALLBACK)).toBe(FALLBACK);
        expect(resolveBriefingModel({}, FALLBACK)).toBe(FALLBACK);
    });
});
