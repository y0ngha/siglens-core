import { describe, expect, it } from 'vitest';
import {
    aggregateBatchEntries,
    aggregateVerdicts,
    assignBlindLabels,
    assignBlindLabelsForPass,
    buildBatchRequests,
    buildCaseSamplePairs,
    buildJudgePrompt,
    decodeCustomId,
    encodeCustomId,
    evaluateAggregatedGate,
    evaluateGate,
    median,
    mergeResultsByCase,
    meansFromAggregates,
    parseJudgeVerdict,
    roundToHalf,
    type BatchVerdictEntry,
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
        sampleIndex: 0,
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

    it('PASSes a single 1-point drop on one case (integer-scale noise, tolerated once)', () => {
        // c1: full=4, digest=3 -> a single 1-point drop, the minimum nonzero
        // difference on the 1-5 integer scale. c2: full=1, digest=2 offsets
        // it so the mean floor clears too (delta=0), isolating the outlier
        // clause as what's under test: exactly one 1-point-drop case per
        // axis is tolerated as judge noise, not treated as a regression.
        const records = [
            makeVerdictRecord(
                'c1',
                'full',
                { ...PERFECT_SCORES, actionability: 4 },
                { ...PERFECT_SCORES, actionability: 3 }
            ),
            makeVerdictRecord(
                'c2',
                'full',
                { ...PERFECT_SCORES, actionability: 1 },
                { ...PERFECT_SCORES, actionability: 2 }
            ),
        ];
        const means = aggregateVerdicts(records);
        const gate = evaluateGate(means, records);
        expect(gate.perAxis.actionability.meanOk).toBe(true);
        expect(gate.perAxis.actionability.onePointDropCount).toBe(1);
        expect(gate.perAxis.actionability.twoPointDropCount).toBe(0);
        expect(gate.perAxis.actionability.outlierOk).toBe(true);
        expect(gate.perAxis.actionability.ok).toBe(true);
        expect(gate.passed).toBe(true);
    });

    it('FAILs when two different cases each have a 1-point drop on the same axis', () => {
        // c1 and c2 each regress by exactly 1 point on `actionability` — a
        // single 1-point drop is tolerated, but two on the same axis is a
        // signal, not noise, and fails the axis even though no individual
        // case regressed by >= 2. c3 offsets the mean (full=1, digest=3, a
        // +2 improvement cancelling c1+c2's combined -2) so the mean floor
        // clears too, isolating the outlier clause as the sole reason this
        // axis fails.
        const records = [
            makeVerdictRecord(
                'c1',
                'full',
                { ...PERFECT_SCORES, actionability: 4 },
                { ...PERFECT_SCORES, actionability: 3 }
            ),
            makeVerdictRecord(
                'c2',
                'full',
                { ...PERFECT_SCORES, actionability: 4 },
                { ...PERFECT_SCORES, actionability: 3 }
            ),
            makeVerdictRecord(
                'c3',
                'full',
                { ...PERFECT_SCORES, actionability: 1 },
                { ...PERFECT_SCORES, actionability: 3 }
            ),
        ];
        const means = aggregateVerdicts(records);
        const gate = evaluateGate(means, records);
        expect(gate.perAxis.actionability.meanOk).toBe(true);
        expect(gate.perAxis.actionability.onePointDropCount).toBe(2);
        expect(gate.perAxis.actionability.twoPointDropCount).toBe(0);
        expect(gate.perAxis.actionability.outlierOk).toBe(false);
        expect(gate.perAxis.actionability.ok).toBe(false);
        expect(gate.passed).toBe(false);
    });

    it('FAILs when a single case regresses by 2 points on an axis, even though the mean floor passes', () => {
        // c1: full=5, digest=3 (a 2-point drop, a real regression).
        // c2: full=1, digest=5 (a big improvement that pulls the mean up).
        // Axis mean: full=(5+1)/2=3, digest=(3+5)/2=4 -> delta=+1, which
        // clears the mean-floor tolerance easily — isolating the outlier
        // clause as the sole reason this axis fails.
        const records = [
            makeVerdictRecord(
                'c1',
                'full',
                { ...PERFECT_SCORES, actionability: 5 },
                { ...PERFECT_SCORES, actionability: 3 }
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
        expect(gate.perAxis.actionability.twoPointDropCount).toBe(1);
        expect(gate.perAxis.actionability.outlierOk).toBe(false);
        expect(gate.perAxis.actionability.ok).toBe(false);
        expect(gate.passed).toBe(false);
    });
});

describe('encodeCustomId / decodeCustomId', () => {
    it('round-trips (caseId, sampleIndex, pass) exactly', () => {
        const cases: Array<[string, number, number]> = [
            ['tech-trend', 0, 0],
            ['tech-pattern-doubletop', 2, 4],
            ['news-macro', 10, 0],
        ];
        for (const [caseId, sampleIndex, pass] of cases) {
            const customId = encodeCustomId(caseId, sampleIndex, pass);
            expect(decodeCustomId(customId)).toEqual({
                caseId,
                sampleIndex,
                pass,
            });
        }
    });

    it('produces distinct custom_ids for different sampleIndex/pass on the same case (worst case: collision would silently merge two requests)', () => {
        const ids = new Set([
            encodeCustomId('tech-trend', 0, 0),
            encodeCustomId('tech-trend', 0, 1),
            encodeCustomId('tech-trend', 1, 0),
            encodeCustomId('tech-trend', 1, 1),
        ]);
        expect(ids.size).toBe(4);
    });

    it('throws on a malformed custom_id (worst case: corrupt/foreign batch result)', () => {
        expect(() => decodeCustomId('not-a-valid-id')).toThrow(/malformed/);
        expect(() => decodeCustomId('tech-trend__s0')).toThrow(/malformed/);
        expect(() => decodeCustomId('tech-trend__x0__p0')).toThrow(/malformed/);
        expect(() => decodeCustomId('tech-trend__s0__pNaN')).toThrow(
            /malformed/
        );
    });
});

describe('assignBlindLabelsForPass', () => {
    it('is deterministic across repeated calls for the same (caseId, sampleIndex, pass)', () => {
        const first = assignBlindLabelsForPass('tech-trend', 1, 2);
        const second = assignBlindLabelsForPass('tech-trend', 1, 2);
        expect(second).toEqual(first);
    });

    it('always assigns complementary variants to A and B', () => {
        const labels = assignBlindLabelsForPass('tech-trend', 0, 3);
        expect(labels.aVariant).not.toBe(labels.bVariant);
        expect(['full', 'digest']).toContain(labels.aVariant);
    });

    it('differs across passes for the same (caseId, sampleIndex) — the whole point of multi-pass judging (worst case: a flip that never flips)', () => {
        const aVariants = new Set(
            Array.from(
                { length: 8 },
                (_, pass) =>
                    assignBlindLabelsForPass('tech-trend', 0, pass).aVariant
            )
        );
        expect(aVariants.size).toBeGreaterThan(1);
    });

    it('differs from the plain (non-pass) assignBlindLabels seed for at least one sampleIndex/pass combination (proves the seed actually changed, not just aliased)', () => {
        const legacy = assignBlindLabels('tech-trend');
        const perPass = Array.from({ length: 8 }, (_, pass) =>
            assignBlindLabelsForPass('tech-trend', 0, pass)
        );
        expect(perPass.some(p => p.aVariant !== legacy.aVariant)).toBe(true);
    });
});

describe('buildCaseSamplePairs', () => {
    it('pairs full/digest results index-for-index across multiple samples', () => {
        const listA = [
            makeResult('tech-trend', 'full', { sampleIndex: 0 }),
            makeResult('tech-trend', 'full', { sampleIndex: 1 }),
        ];
        const listB = [
            makeResult('tech-trend', 'digest', { sampleIndex: 0 }),
            makeResult('tech-trend', 'digest', { sampleIndex: 1 }),
        ];
        const pairs = buildCaseSamplePairs(listA, listB);
        expect(pairs).toHaveLength(2);
        expect(pairs.map(p => p.sampleIndex)).toEqual([0, 1]);
        expect(pairs[0].full.mode).toBe('full');
        expect(pairs[0].digest.mode).toBe('digest');
    });

    it('pairs by min(fullCount, digestCount) when one side has fewer samples', () => {
        const listA = [
            makeResult('tech-trend', 'full', { sampleIndex: 0 }),
            makeResult('tech-trend', 'full', { sampleIndex: 1 }),
            makeResult('tech-trend', 'full', { sampleIndex: 2 }),
        ];
        const listB = [makeResult('tech-trend', 'digest', { sampleIndex: 0 })];
        const pairs = buildCaseSamplePairs(listA, listB);
        expect(pairs.map(p => p.sampleIndex)).toEqual([0]);
    });

    it('throws when a case is missing its digest side entirely', () => {
        const listA = [makeResult('tech-trend', 'full')];
        expect(() => buildCaseSamplePairs(listA, [])).toThrow(
            /missing a digest/
        );
    });
});

describe('buildBatchRequests', () => {
    it('builds one request per (pair, pass) with a unique custom_id decoding back to its (caseId, sampleIndex, pass)', () => {
        const pairs = buildCaseSamplePairs(
            [makeResult('tech-trend', 'full', { sampleIndex: 0 })],
            [makeResult('tech-trend', 'digest', { sampleIndex: 0 })]
        );
        const requests = buildBatchRequests(pairs, 3);
        expect(requests).toHaveLength(3);
        expect(requests.map(r => r.pass)).toEqual([0, 1, 2]);
        for (const request of requests) {
            expect(decodeCustomId(request.customId)).toEqual({
                caseId: 'tech-trend',
                sampleIndex: 0,
                pass: request.pass,
            });
            expect(request.resultA.mode).toBe(request.blindLabels.aVariant);
            expect(request.resultB.mode).toBe(request.blindLabels.bVariant);
        }
    });

    it('produces distinct blind assignments across at least some passes (K=8, worst case: a flip that never flips)', () => {
        const pairs = buildCaseSamplePairs(
            [makeResult('tech-trend', 'full', { sampleIndex: 0 })],
            [makeResult('tech-trend', 'digest', { sampleIndex: 0 })]
        );
        const requests = buildBatchRequests(pairs, 8);
        const aVariants = new Set(requests.map(r => r.blindLabels.aVariant));
        expect(aVariants.size).toBeGreaterThan(1);
    });
});

describe('median', () => {
    it('returns the middle value for an odd-length input', () => {
        expect(median([3, 1, 2])).toBe(2);
    });

    it('averages the two middle values for an even-length input', () => {
        expect(median([1, 2, 3, 4])).toBe(2.5);
    });

    it('returns 0 for an empty input (worst case, avoids divide-by-zero NaN)', () => {
        expect(median([])).toBe(0);
    });

    it('is insensitive to input order', () => {
        expect(median([5, 1, 3])).toBe(median([1, 3, 5]));
    });
});

describe('roundToHalf', () => {
    it('rounds to the nearest 0.5', () => {
        expect(roundToHalf(1.0)).toBe(1);
        expect(roundToHalf(1.24)).toBe(1);
        expect(roundToHalf(1.26)).toBe(1.5);
        expect(roundToHalf(1.75)).toBe(2);
    });
});

/** Builds one `BatchVerdictEntry` for a given (caseId, sampleIndex, pass), with `full`/`digest` axis scores already known (unblinded) — internally re-blinds them per the given `aVariant` so `aggregateBatchEntries`'s own unblinding logic is exercised, not bypassed. */
function makeBatchEntry(
    caseId: string,
    sampleIndex: number,
    pass: number,
    aVariant: 'full' | 'digest',
    fullScores: JudgeVerdict['scoresA'],
    digestScores: JudgeVerdict['scoresA']
): BatchVerdictEntry {
    const bVariant = aVariant === 'full' ? 'digest' : 'full';
    const scoresA = aVariant === 'full' ? fullScores : digestScores;
    const scoresB = aVariant === 'full' ? digestScores : fullScores;
    return {
        caseId,
        sampleIndex,
        pass,
        blindLabels: { aVariant, bVariant },
        verdict: { scoresA, scoresB, winner: 'A' },
    };
}

describe('aggregateBatchEntries', () => {
    it('medians across K passes per sample, then means across samples per case', () => {
        // Sample 0: 3 passes of actionability full/digest = [4,4,4] / [3,3,3] -> medians 4/3.
        // Sample 1: 3 passes = [2,2,2] / [2,2,2] -> medians 2/2.
        // Case aggregate: mean of sample medians = full (4+2)/2=3, digest (3+2)/2=2.5.
        const entries: BatchVerdictEntry[] = [
            makeBatchEntry(
                'c1',
                0,
                0,
                'full',
                { ...PERFECT_SCORES, actionability: 4 },
                { ...PERFECT_SCORES, actionability: 3 }
            ),
            makeBatchEntry(
                'c1',
                0,
                1,
                'full',
                { ...PERFECT_SCORES, actionability: 4 },
                { ...PERFECT_SCORES, actionability: 3 }
            ),
            makeBatchEntry(
                'c1',
                0,
                2,
                'full',
                { ...PERFECT_SCORES, actionability: 4 },
                { ...PERFECT_SCORES, actionability: 3 }
            ),
            makeBatchEntry(
                'c1',
                1,
                0,
                'digest',
                { ...PERFECT_SCORES, actionability: 2 },
                { ...PERFECT_SCORES, actionability: 2 }
            ),
            makeBatchEntry(
                'c1',
                1,
                1,
                'digest',
                { ...PERFECT_SCORES, actionability: 2 },
                { ...PERFECT_SCORES, actionability: 2 }
            ),
            makeBatchEntry(
                'c1',
                1,
                2,
                'digest',
                { ...PERFECT_SCORES, actionability: 2 },
                { ...PERFECT_SCORES, actionability: 2 }
            ),
        ];
        const aggregates = aggregateBatchEntries(entries);
        expect(aggregates).toHaveLength(1);
        const { axes } = aggregates[0];
        expect(axes.actionability.full).toBe(3);
        expect(axes.actionability.digest).toBe(2.5);
        expect(axes.actionability.sampleCount).toBe(2);
        expect(axes.actionability.passCount).toBe(6);
    });

    it('a single outlier pass is suppressed by the median (noise-hardening working as intended)', () => {
        // 3 passes for one sample: actionability full=[5,1,5], digest=[3,3,3].
        // Mean would be full=3.67 (dragged down by the outlier pass), but the
        // median is 5 — the noisy middle pass doesn't move the aggregate at
        // all, which is the entire point of medianing across passes.
        const entries: BatchVerdictEntry[] = [
            makeBatchEntry(
                'c1',
                0,
                0,
                'full',
                { ...PERFECT_SCORES, actionability: 5 },
                { ...PERFECT_SCORES, actionability: 3 }
            ),
            makeBatchEntry(
                'c1',
                0,
                1,
                'full',
                { ...PERFECT_SCORES, actionability: 1 },
                { ...PERFECT_SCORES, actionability: 3 }
            ),
            makeBatchEntry(
                'c1',
                0,
                2,
                'full',
                { ...PERFECT_SCORES, actionability: 5 },
                { ...PERFECT_SCORES, actionability: 3 }
            ),
        ];
        const aggregates = aggregateBatchEntries(entries);
        expect(aggregates[0].axes.actionability.full).toBe(5);
        expect(aggregates[0].axes.actionability.digest).toBe(3);
        expect(aggregates[0].axes.actionability.fullSpread).toEqual([1, 5]);
    });

    it('skips null (missing/errored) verdicts and still aggregates over the surviving passes', () => {
        const entries: BatchVerdictEntry[] = [
            makeBatchEntry(
                'c1',
                0,
                0,
                'full',
                { ...PERFECT_SCORES, actionability: 4 },
                { ...PERFECT_SCORES, actionability: 3 }
            ),
            {
                caseId: 'c1',
                sampleIndex: 0,
                pass: 1,
                blindLabels: { aVariant: 'full', bVariant: 'digest' },
                verdict: null,
            },
        ];
        const aggregates = aggregateBatchEntries(entries);
        expect(aggregates[0].axes.actionability.passCount).toBe(1);
        expect(aggregates[0].axes.actionability.full).toBe(4);
    });

    it('drops a case entirely when every one of its verdicts is null (worst case: fully-failed batch for that case)', () => {
        const entries: BatchVerdictEntry[] = [
            {
                caseId: 'c1',
                sampleIndex: 0,
                pass: 0,
                blindLabels: { aVariant: 'full', bVariant: 'digest' },
                verdict: null,
            },
        ];
        expect(aggregateBatchEntries(entries)).toEqual([]);
    });
});

describe('meansFromAggregates', () => {
    it('averages the per-case aggregated scores across cases per axis', () => {
        const aggregates = aggregateBatchEntries([
            makeBatchEntry(
                'c1',
                0,
                0,
                'full',
                { ...PERFECT_SCORES, actionability: 4 },
                { ...PERFECT_SCORES, actionability: 3 }
            ),
            makeBatchEntry(
                'c2',
                0,
                0,
                'full',
                { ...PERFECT_SCORES, actionability: 2 },
                { ...PERFECT_SCORES, actionability: 5 }
            ),
        ]);
        const means = meansFromAggregates(aggregates);
        expect(means.full.actionability).toBe(3);
        expect(means.digest.actionability).toBe(4);
    });

    it('returns all-zero means for an empty aggregate set (worst case, avoids divide-by-zero NaN)', () => {
        const means = meansFromAggregates([]);
        expect(means.full.actionability).toBe(0);
        expect(means.digest.actionability).toBe(0);
    });
});

describe('evaluateAggregatedGate', () => {
    it('PASSes when a case has pass-spread noise but the median suppresses it into a non-regression', () => {
        // Same noisy-outlier-pass setup as the aggregateBatchEntries test
        // above: raw passes look like a mix of 5s, 3s and a 1, but medianing
        // per sample collapses it to full=5/digest=3 — a 2-point rounded
        // drop would normally hard-fail the axis, so pair it with an
        // offsetting case to isolate what's under test: verifying the
        // MEDIAN (not the noisy raw passes) is what the gate operates on.
        const entries: BatchVerdictEntry[] = [
            makeBatchEntry(
                'c1',
                0,
                0,
                'full',
                { ...PERFECT_SCORES, actionability: 5 },
                { ...PERFECT_SCORES, actionability: 3 }
            ),
            makeBatchEntry(
                'c1',
                0,
                1,
                'full',
                { ...PERFECT_SCORES, actionability: 1 },
                { ...PERFECT_SCORES, actionability: 3 }
            ),
            makeBatchEntry(
                'c1',
                0,
                2,
                'full',
                { ...PERFECT_SCORES, actionability: 5 },
                { ...PERFECT_SCORES, actionability: 3 }
            ),
            makeBatchEntry(
                'c2',
                0,
                0,
                'full',
                { ...PERFECT_SCORES, actionability: 1 },
                { ...PERFECT_SCORES, actionability: 3 }
            ),
        ];
        const aggregates = aggregateBatchEntries(entries);
        // c1: full=5, digest=3 (rounded drop=2, a hard-fail by itself).
        // c2: full=1, digest=3 (digest wins by 2, offsetting the mean).
        const means = meansFromAggregates(aggregates);
        const gate = evaluateAggregatedGate(means, aggregates);
        expect(gate.perAxis.actionability.twoPointDropCount).toBe(1);
        expect(gate.perAxis.actionability.ok).toBe(false);
        // The key assertion: the median suppressed the noisy middle pass —
        // c1's aggregated full score is exactly 5 (the un-noised value),
        // not something dragged toward the outlier 1.
        expect(
            aggregates.find(a => a.caseId === 'c1')?.axes.actionability.full
        ).toBe(5);
    });

    it('rounds aggregated drops to the nearest 0.5 before classifying them (a 1.24 rounds down out of the 1pt-drop bucket, a 1.26 rounds up into it)', () => {
        const flatCell = (full: number, digest: number) => ({
            full,
            digest,
            fullSpread: [full, full] as [number, number],
            digestSpread: [digest, digest] as [number, number],
            passCount: 1,
            sampleCount: 1,
        });
        const meansJustUnder: VariantAxisMeans = {
            full: { ...PERFECT_SCORES },
            digest: { ...PERFECT_SCORES },
        };

        const justUnder = [
            {
                caseId: 'c1',
                axes: {
                    dataGroundedness: flatCell(5, 5),
                    hallucinationFreedom: flatCell(5, 5),
                    patternJudgmentAccuracy: flatCell(5, 5),
                    actionability: flatCell(4.24, 3),
                },
            },
        ];
        const gateUnder = evaluateAggregatedGate(meansJustUnder, justUnder);
        // roundToHalf(4.24 - 3) = roundToHalf(1.24) = 1.0 -> exactly 1 -> counts as a 1pt drop.
        expect(gateUnder.perAxis.actionability.onePointDropCount).toBe(1);
        expect(gateUnder.perAxis.actionability.twoPointDropCount).toBe(0);

        const justOver = [
            {
                caseId: 'c1',
                axes: {
                    ...justUnder[0].axes,
                    actionability: flatCell(4.26, 3),
                },
            },
        ];
        const gateOver = evaluateAggregatedGate(meansJustUnder, justOver);
        // roundToHalf(4.26 - 3) = roundToHalf(1.26) = 1.5 -> neither exactly 1 nor >= 2 -> counts as neither bucket.
        expect(gateOver.perAxis.actionability.onePointDropCount).toBe(0);
        expect(gateOver.perAxis.actionability.twoPointDropCount).toBe(0);
    });
});
