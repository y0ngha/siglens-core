import { describe, expect, it } from 'vitest';
import {
    aggregateVerdicts,
    assignBlindLabels,
    buildJudgePrompt,
    evaluateGate,
    mergeResultsByCase,
    parseJudgeVerdict,
    type CaseVerdictRecord,
    type JudgeVerdict,
    type VariantAxisMeans,
} from '../../../../scripts/ab-harness/judge';
import type { ModelRunResult } from '../../../../scripts/ab-harness/runModels';

function makeResult(
    caseId: string,
    mode: 'full' | 'digest',
    overrides: Partial<ModelRunResult> = {}
): ModelRunResult {
    return {
        caseId,
        mode,
        analysisType: 'technical',
        resultText: '{"ok":true}',
        usage: { promptTokens: 100, cachedTokens: 0, outputTokens: 50 },
        latencyMs: 500,
        promptChars: 1000,
        ...overrides,
    };
}

const PERFECT_SCORES = {
    dataGroundedness: 5,
    hallucinationFreedom: 5,
    actionability: 5,
    patternJudgmentAccuracy: 5,
};

describe('assignBlindLabels', () => {
    it('is deterministic across repeated calls for the same caseId', () => {
        const first = assignBlindLabels('tech-trend');
        const second = assignBlindLabels('tech-trend');
        expect(second).toEqual(first);
    });

    it('always assigns complementary (never identical) variants to A and B', () => {
        for (const caseId of [
            'tech-trend',
            'tech-range',
            'news-earnings',
            'news-macro',
        ]) {
            const labels = assignBlindLabels(caseId);
            expect(labels.aVariant).not.toBe(labels.bVariant);
            expect(['full', 'digest']).toContain(labels.aVariant);
            expect(['full', 'digest']).toContain(labels.bVariant);
        }
    });

    it('does not assign the same variant to A for every caseId (worst case: a degenerate always-A-is-full mapping)', () => {
        const caseIds = [
            'tech-trend',
            'tech-range',
            'tech-highvol',
            'tech-lowliq',
            'tech-pattern-hs',
            'tech-pattern-doubletop',
            'news-earnings',
            'news-macro',
        ];
        const aVariants = new Set(
            caseIds.map(id => assignBlindLabels(id).aVariant)
        );
        expect(aVariants.size).toBeGreaterThan(1);
    });
});

describe('parseJudgeVerdict', () => {
    it('parses a well-formed verdict', () => {
        const raw = JSON.stringify({
            scoresA: PERFECT_SCORES,
            scoresB: { ...PERFECT_SCORES, actionability: 3 },
            winner: 'A',
        });
        const verdict = parseJudgeVerdict(raw);
        expect(verdict).not.toBeNull();
        expect(verdict?.winner).toBe('A');
        expect(verdict?.scoresB.actionability).toBe(3);
    });

    it('salvages a verdict wrapped in a markdown JSON fence', () => {
        const raw =
            '```json\n' +
            JSON.stringify({
                scoresA: PERFECT_SCORES,
                scoresB: PERFECT_SCORES,
                winner: 'tie',
            }) +
            '\n```';
        expect(parseJudgeVerdict(raw)?.winner).toBe('tie');
    });

    it('returns null for unparseable garbage (worst case)', () => {
        expect(parseJudgeVerdict('not json at all')).toBeNull();
    });

    it('returns null when a score is out of the 1-5 range', () => {
        const raw = JSON.stringify({
            scoresA: { ...PERFECT_SCORES, actionability: 7 },
            scoresB: PERFECT_SCORES,
            winner: 'A',
        });
        expect(parseJudgeVerdict(raw)).toBeNull();
    });

    it('returns null when a score axis is missing', () => {
        const { actionability: _drop, ...incomplete } = PERFECT_SCORES;
        const raw = JSON.stringify({
            scoresA: incomplete,
            scoresB: PERFECT_SCORES,
            winner: 'A',
        });
        expect(parseJudgeVerdict(raw)).toBeNull();
    });

    it('returns null when winner is not A/B/tie', () => {
        const raw = JSON.stringify({
            scoresA: PERFECT_SCORES,
            scoresB: PERFECT_SCORES,
            winner: 'C',
        });
        expect(parseJudgeVerdict(raw)).toBeNull();
    });
});

describe('mergeResultsByCase', () => {
    it('pairs full/digest results by caseId regardless of which list they came from', () => {
        const listA = [makeResult('tech-trend', 'full')];
        const listB = [makeResult('tech-trend', 'digest')];
        const merged = mergeResultsByCase(listA, listB);
        expect(merged.size).toBe(1);
        expect(merged.get('tech-trend')?.full.mode).toBe('full');
        expect(merged.get('tech-trend')?.digest.mode).toBe('digest');
    });

    it('works when both variants for a case are split across the two input lists in mixed order', () => {
        const listA = [makeResult('a', 'digest'), makeResult('b', 'full')];
        const listB = [makeResult('a', 'full'), makeResult('b', 'digest')];
        const merged = mergeResultsByCase(listA, listB);
        expect(merged.get('a')?.full.mode).toBe('full');
        expect(merged.get('b')?.digest.mode).toBe('digest');
    });

    it('throws when a case is missing its digest side', () => {
        const listA = [makeResult('tech-trend', 'full')];
        expect(() => mergeResultsByCase(listA, [])).toThrow(/missing a digest/);
    });

    it('throws on an unrecognized mode value (worst case: corrupt results file)', () => {
        const bad = makeResult('x', 'full', { mode: 'bogus' as 'full' });
        expect(() => mergeResultsByCase([bad], [])).toThrow(/unknown mode/);
    });
});

describe('buildJudgePrompt', () => {
    it('includes the caseId, both result texts, and A/B labels', () => {
        const resultA = makeResult('tech-trend', 'full', {
            resultText: '{"a":1}',
        });
        const resultB = makeResult('tech-trend', 'digest', {
            resultText: '{"b":2}',
        });
        const prompt = buildJudgePrompt('tech-trend', resultA, resultB);
        expect(prompt).toContain('tech-trend');
        expect(prompt).toContain('{"a":1}');
        expect(prompt).toContain('{"b":2}');
        expect(prompt).toContain('Candidate A');
        expect(prompt).toContain('Candidate B');
    });

    it('falls back to the caseId itself when there is no known description (worst case)', () => {
        const resultA = makeResult('unknown-case', 'full');
        const resultB = makeResult('unknown-case', 'digest');
        const prompt = buildJudgePrompt('unknown-case', resultA, resultB);
        expect(prompt).toContain('Description: unknown-case');
    });
});

function makeVerdictRecord(
    caseId: string,
    aVariant: 'full' | 'digest',
    scoresA: JudgeVerdict['scoresA'],
    scoresB: JudgeVerdict['scoresB']
): CaseVerdictRecord {
    return {
        caseId,
        blindLabels: {
            aVariant,
            bVariant: aVariant === 'full' ? 'digest' : 'full',
        },
        verdict: { scoresA, scoresB, winner: 'A' },
    };
}

describe('aggregateVerdicts', () => {
    it('unblinds A/B back to full/digest before averaging', () => {
        // Case 1: A=full (scores 5), B=digest (scores 3).
        // Case 2: A=digest (scores 3), B=full (scores 5).
        // Both cases: full=5, digest=3 once unblinded — means should reflect that exactly.
        const records: CaseVerdictRecord[] = [
            makeVerdictRecord('c1', 'full', PERFECT_SCORES, {
                ...PERFECT_SCORES,
                dataGroundedness: 3,
                hallucinationFreedom: 3,
                actionability: 3,
                patternJudgmentAccuracy: 3,
            }),
            makeVerdictRecord(
                'c2',
                'digest',
                {
                    ...PERFECT_SCORES,
                    dataGroundedness: 3,
                    hallucinationFreedom: 3,
                    actionability: 3,
                    patternJudgmentAccuracy: 3,
                },
                PERFECT_SCORES
            ),
        ];

        const means = aggregateVerdicts(records);
        expect(means.full.dataGroundedness).toBe(5);
        expect(means.digest.dataGroundedness).toBe(3);
    });

    it('returns all-zero means for an empty record set (worst case, avoids divide-by-zero NaN)', () => {
        const means = aggregateVerdicts([]);
        expect(means.full.dataGroundedness).toBe(0);
        expect(means.digest.dataGroundedness).toBe(0);
    });
});

describe('evaluateGate', () => {
    it('PASSes when digest matches full exactly on every axis and every case', () => {
        const means: VariantAxisMeans = {
            full: { ...PERFECT_SCORES },
            digest: { ...PERFECT_SCORES },
        };
        const records = [
            makeVerdictRecord('c1', 'full', PERFECT_SCORES, PERFECT_SCORES),
        ];
        expect(evaluateGate(means, records).passed).toBe(true);
    });

    it('PASSes when digest beats full', () => {
        const means: VariantAxisMeans = {
            full: { ...PERFECT_SCORES, actionability: 3 },
            digest: { ...PERFECT_SCORES, actionability: 4 },
        };
        const records = [
            makeVerdictRecord(
                'c1',
                'full',
                { ...PERFECT_SCORES, actionability: 3 },
                { ...PERFECT_SCORES, actionability: 4 }
            ),
        ];
        const gate = evaluateGate(means, records);
        expect(gate.passed).toBe(true);
        expect(gate.perAxis.actionability.ok).toBe(true);
    });

    it('PASSes when the axis mean trails full by less than GATE_TOLERANCE and no case regresses', () => {
        const means: VariantAxisMeans = {
            full: { ...PERFECT_SCORES, actionability: 4.0 },
            digest: { ...PERFECT_SCORES, actionability: 3.95 },
        };
        const records = [
            makeVerdictRecord(
                'c1',
                'full',
                { ...PERFECT_SCORES, actionability: 4.0 },
                { ...PERFECT_SCORES, actionability: 3.95 }
            ),
        ];
        expect(evaluateGate(means, records).passed).toBe(true);
    });

    it('FAILs the mean-floor clause when the axis mean drops beyond GATE_TOLERANCE, even with no single-case outlier', () => {
        const means: VariantAxisMeans = {
            full: { ...PERFECT_SCORES, actionability: 4.0 },
            digest: { ...PERFECT_SCORES, actionability: 3.5 },
        };
        const records = [
            makeVerdictRecord(
                'c1',
                'full',
                { ...PERFECT_SCORES, actionability: 4.0 },
                { ...PERFECT_SCORES, actionability: 3.5 }
            ),
        ];
        const gate = evaluateGate(means, records);
        expect(gate.passed).toBe(false);
        expect(gate.perAxis.actionability.meanOk).toBe(false);
        expect(gate.perAxis.actionability.ok).toBe(false);
        // Unaffected axes still individually pass.
        expect(gate.perAxis.dataGroundedness.ok).toBe(true);
    });

    it('FAILs the worst-case clause when the mean floor passes but one case regressed badly (offset by others improving)', () => {
        // c1: full=5, digest=4 (a single-case drop of 1, exceeding GATE_MAX_DROP=0.25).
        // c2: full=1, digest=5 (a big improvement that pulls the mean up).
        // Axis mean: full=(5+1)/2=3, digest=(4+5)/2=4.5 -> delta=+1.5, which
        // clears the mean-floor tolerance easily — isolating the worst-case
        // clause as the sole reason this axis fails.
        const records = [
            makeVerdictRecord(
                'c1',
                'full',
                { ...PERFECT_SCORES, actionability: 5 },
                { ...PERFECT_SCORES, actionability: 4 }
            ),
            makeVerdictRecord(
                'c2',
                'full',
                { ...PERFECT_SCORES, actionability: 1 },
                { ...PERFECT_SCORES, actionability: 5 }
            ),
        ];
        const means = aggregateVerdicts(records);
        const gate = evaluateGate(means, records);
        expect(gate.perAxis.actionability.meanOk).toBe(true);
        expect(gate.perAxis.actionability.worstCaseDrop).toBeCloseTo(1, 5);
        expect(gate.perAxis.actionability.worstCaseOk).toBe(false);
        expect(gate.perAxis.actionability.ok).toBe(false);
        expect(gate.passed).toBe(false);
    });
});
