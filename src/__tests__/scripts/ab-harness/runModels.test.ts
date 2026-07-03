import { describe, expect, it } from 'vitest';
import type { PromptCaseOutput } from '../../../../scripts/ab-harness/buildPrompts';
import {
    filterUnfinishedCases,
    inferModeFromFilename,
    isRetryableError,
    type ModelRunResult,
} from '../../../../scripts/ab-harness/runModels';

describe('inferModeFromFilename', () => {
    it('infers "full" from a filename containing full', () => {
        expect(inferModeFromFilename('/tmp/prompts-full.json')).toBe('full');
        expect(inferModeFromFilename('prompts-full.json')).toBe('full');
    });

    it('infers "digest" from a filename containing digest', () => {
        expect(inferModeFromFilename('/tmp/prompts-digest.json')).toBe(
            'digest'
        );
    });

    it('prefers "digest" when both substrings somehow appear (documented tie-break, worst case)', () => {
        expect(inferModeFromFilename('full-digest.json')).toBe('digest');
    });

    it('returns "unknown" when neither substring is present (worst case)', () => {
        expect(inferModeFromFilename('results.json')).toBe('unknown');
    });
});

describe('isRetryableError', () => {
    it('treats 503/UNAVAILABLE/429 as retryable', () => {
        expect(isRetryableError(new Error('503 Service Unavailable'))).toBe(
            true
        );
        expect(isRetryableError(new Error('UNAVAILABLE: overloaded'))).toBe(
            true
        );
        expect(isRetryableError(new Error('429 Too Many Requests'))).toBe(true);
        expect(isRetryableError({ status: 503 })).toBe(true);
        expect(isRetryableError({ code: 429 })).toBe(true);
    });

    it('treats other errors as non-retryable (worst case)', () => {
        expect(isRetryableError(new Error('400 Bad Request'))).toBe(false);
        expect(isRetryableError(new Error('invalid schema'))).toBe(false);
        expect(isRetryableError({ status: 401 })).toBe(false);
    });
});

describe('filterUnfinishedCases', () => {
    const makeCase = (caseId: string): PromptCaseOutput =>
        ({
            caseId,
            analysisType: 'technical',
            prompt: 'p',
        }) as unknown as PromptCaseOutput;

    const makeResult = (caseId: string): ModelRunResult => ({
        caseId,
        mode: 'digest',
        analysisType: 'technical',
        resultText: '{}',
        usage: { promptTokens: 0, cachedTokens: 0, outputTokens: 0 },
        latencyMs: 1,
        promptChars: 1,
    });

    it('returns all cases when no results exist yet', () => {
        const cases = [makeCase('a'), makeCase('b')];
        expect(filterUnfinishedCases(cases, [])).toEqual(cases);
    });

    it('skips caseIds already present in existing results', () => {
        const cases = [makeCase('a'), makeCase('b'), makeCase('c')];
        const existing = [makeResult('a'), makeResult('c')];
        const remaining = filterUnfinishedCases(cases, existing);
        expect(remaining.map(c => c.caseId)).toEqual(['b']);
    });

    it('returns an empty array when every case is already done (worst case)', () => {
        const cases = [makeCase('a'), makeCase('b')];
        const existing = [makeResult('a'), makeResult('b')];
        expect(filterUnfinishedCases(cases, existing)).toEqual([]);
    });
});
