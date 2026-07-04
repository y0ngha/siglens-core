import { describe, expect, it } from 'vitest';
import type { PromptCaseOutput } from '../../../../scripts/ab-harness/buildPrompts';
import {
    filterUnfinishedCases,
    inferModeFromFilename,
    isRetryableError,
    parseSamplesArg,
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

    const makeResult = (caseId: string, sampleIndex = 0): ModelRunResult => ({
        caseId,
        mode: 'digest',
        analysisType: 'technical',
        resultText: '{}',
        usage: { promptTokens: 0, cachedTokens: 0, outputTokens: 0 },
        latencyMs: 1,
        promptChars: 1,
        sampleIndex,
    });

    it('returns all cases (as sampleIndex 0 pending units) when no results exist yet', () => {
        const cases = [makeCase('a'), makeCase('b')];
        expect(filterUnfinishedCases(cases, [])).toEqual([
            { promptCase: cases[0], sampleIndex: 0 },
            { promptCase: cases[1], sampleIndex: 0 },
        ]);
    });

    it('skips caseIds already present in existing results', () => {
        const cases = [makeCase('a'), makeCase('b'), makeCase('c')];
        const existing = [makeResult('a'), makeResult('c')];
        const remaining = filterUnfinishedCases(cases, existing);
        expect(remaining.map(c => c.promptCase.caseId)).toEqual(['b']);
    });

    it('returns an empty array when every case is already done (worst case)', () => {
        const cases = [makeCase('a'), makeCase('b')];
        const existing = [makeResult('a'), makeResult('b')];
        expect(filterUnfinishedCases(cases, existing)).toEqual([]);
    });

    it('keys resume on (caseId, sampleIndex): with samples=3, only the missing sampleIndex for a partially-done case remains', () => {
        const cases = [makeCase('a'), makeCase('b')];
        // "a" has samples 0 and 2 done, but NOT 1 — sample-aware resume must
        // re-run exactly sample 1 for "a", not skip it (caseId-only keying
        // would wrongly treat "a" as fully done) and not re-run 0/2.
        const existing = [makeResult('a', 0), makeResult('a', 2)];
        const remaining = filterUnfinishedCases(cases, existing, 3);
        expect(remaining).toEqual([
            { promptCase: cases[0], sampleIndex: 1 },
            { promptCase: cases[1], sampleIndex: 0 },
            { promptCase: cases[1], sampleIndex: 1 },
            { promptCase: cases[1], sampleIndex: 2 },
        ]);
    });

    it('treats a result missing sampleIndex as sample 0 (back-compat with pre-multi-sample results files)', () => {
        const cases = [makeCase('a')];
        const legacyResult = {
            caseId: 'a',
            mode: 'digest',
            analysisType: 'technical',
            resultText: '{}',
            usage: { promptTokens: 0, cachedTokens: 0, outputTokens: 0 },
            latencyMs: 1,
            promptChars: 1,
        } as unknown as ModelRunResult;
        expect(filterUnfinishedCases(cases, [legacyResult], 1)).toEqual([]);
    });
});

describe('parseSamplesArg', () => {
    it('defaults to 1 when unset', () => {
        expect(parseSamplesArg(undefined)).toBe(1);
    });

    it('parses a valid positive integer string', () => {
        expect(parseSamplesArg('5')).toBe(5);
    });

    it('rejects zero, negative, and non-integer values (worst case)', () => {
        expect(() => parseSamplesArg('0')).toThrow(/positive integer/);
        expect(() => parseSamplesArg('-1')).toThrow(/positive integer/);
        expect(() => parseSamplesArg('1.5')).toThrow(/positive integer/);
        expect(() => parseSamplesArg('abc')).toThrow(/positive integer/);
    });
});
