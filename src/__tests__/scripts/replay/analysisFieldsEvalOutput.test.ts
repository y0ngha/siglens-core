import { describe, expect, it } from 'vitest';
import { COMPUTED_CARD_KINDS } from '@/domain/analysis/computedCardKinds';
import {
    bootstrapCi,
    cardTrendAgreement,
    compareArms,
    outputGates,
    readArmCase,
    ungroundedMentions,
    type ArmCase,
    type ComparisonInput,
    type PatternSkill,
} from '../../../../scripts/replay/analysisFieldsEvalOutput';
import {
    share,
    median,
} from '../../../../scripts/replay/analysisFieldsEvalCompute';
import type { RunCallStats } from '../../../../scripts/replay/analysisFieldsEvalPlan';
import type { LevelCase } from '../../../../scripts/replay/analysisFieldsEvalSkills';
import { FIELDS_EVAL_CONSTANTS as C } from '../../../../scripts/replay/analysisFieldsEvalTypes';
import type { CaseResultFile } from '../../../../scripts/replay/types';
import { dynamicPrompt } from './wp16Fixtures';

const result = (
    over: Partial<CaseResultFile> & {
        body?: Record<string, unknown> | null;
    } = {}
): CaseResultFile => {
    const { body, ...rest } = over;
    return {
        caseId: 'C1',
        symbol: 'NVDA',
        asOf: '2024-01-02',
        repeat: 1,
        unfilteredResult:
            body === null
                ? null
                : {
                      summary: '요약입니다.',
                      indicatorResults: [],
                      strategyResults: [],
                      patternSummaries: [],
                      candlePatterns: [],
                      keyLevels: { support: [{ price: 1 }], resistance: [] },
                      priceTargets: {},
                      actionRecommendation: { entryPrices: [10] },
                      ...body,
                  },
        promptVersion: 'p34',
        promptHashes: { system: 's', stable: 'a', dynamic: 'b', full: 'f1' },
        promptDynamic: dynamicPrompt({
            qualified: ['double_top'],
            strategies: ['Strategy One', '이동평균선 대순환 분석'],
        }),
        usage: { inputTokens: 1000, outputTokens: 200, cachedTokens: 400 },
        exchangeCount: 1,
        latencyMs: 1000,
        error: body === null ? 'failed' : null,
        ...rest,
    };
};

describe('readArmCase', () => {
    it('measures what the model wrote and leaves out what code attaches', () => {
        const c = readArmCase(
            result({
                body: {
                    strategyResults: [
                        {
                            strategyName: 'Strategy One',
                            summary: 'x',
                            id: 'a_0',
                            confidenceWeight: 0.5,
                        },
                        {
                            strategyName: 'MACD 대순환 분석',
                            summary: 'cycle',
                            cycle: { stage: 4 },
                        },
                    ],
                    indicatorResults: [
                        { indicatorName: 'A', signals: [{ trend: 'neutral' }] },
                        {
                            indicatorName: 'B',
                            signals: [{ reading: { kind: 'ma' } }],
                        },
                    ],
                    patternSummaries: [
                        {
                            skillName: '이중천장',
                            detected: true,
                            candidateId: 'pattern:double_top:1000',
                            id: 'x',
                            confidenceWeight: 1,
                            renderConfig: { show: true },
                        },
                    ],
                    actionRecommendation: {
                        entryPrices: [10],
                        planState: { position: 'in_zone' },
                        planCheck: { riskRewardAtEntry: 2 },
                        reconciledLevels: { stopLoss: 1 },
                    },
                },
            })
        );
        expect(c.chars.strategyResults).toBe(
            JSON.stringify([{ strategyName: 'Strategy One', summary: 'x' }])
                .length
        );
        expect(c.chars.indicatorResults).toBe(
            JSON.stringify([
                { indicatorName: 'A', signals: [{ trend: 'neutral' }] },
            ]).length
        );
        expect(c.chars.patternSummaries).toBe(
            JSON.stringify([
                {
                    skillName: '이중천장',
                    detected: true,
                    candidateId: 'pattern:double_top:1000',
                },
            ]).length
        );
        expect(c.chars.actionRecommendation).toBe(
            JSON.stringify({ entryPrices: [10] }).length
        );
        expect(c.computedCards).toBe(2);
        expect(c.computedChars).toBeGreaterThan(0);
        expect(c.modelChars).toBe(
            Object.values(c.chars).reduce((s, v) => s + v, 0)
        );
        expect(c.planPosition).toBe('in_zone');
        expect(c.strategyChars).toEqual({
            'Strategy One': JSON.stringify({
                strategyName: 'Strategy One',
                summary: 'x',
            }).length,
        });
        expect(c.strategyEntries).toBe(2);
    });

    it('lists the strategies the model writes, the cycle ones excluded, and the printed ids', () => {
        const c = readArmCase(result({ body: {} }));
        expect(c.listedStrategies).toEqual(['Strategy One']);
        expect(c.qualifiedIds).toEqual(['double_top']);
        expect(c.promptFull).toBe('f1');
        expect(c.outputTokens).toBe(200);
        expect(c.uncachedTokens).toBe(600);
    });

    it('marks a failed call, and counts nothing it did not write', () => {
        const c = readArmCase(result({ body: null, usage: null }));
        expect(c).toMatchObject({
            failed: true,
            fallback: false,
            hasSummary: false,
            hasPlan: false,
            outputTokens: null,
            uncachedTokens: null,
            modelChars: 0,
        });
    });

    it('recognises the empty fallback, and a missing summary or zone', () => {
        const fallback = readArmCase(
            result({
                body: {
                    summary:
                        'AI로부터 분석 결과를 받지 못했습니다. 재분석을 시도해 주세요.',
                    keyLevels: { support: [], resistance: [] },
                    actionRecommendation: {},
                },
            })
        );
        expect(fallback).toMatchObject({
            fallback: true,
            hasPlan: false,
            hasSummary: true,
        });
        expect(
            readArmCase(result({ body: { summary: '  ' } })).hasSummary
        ).toBe(false);
        expect(readArmCase(result({ body: {} })).fallback).toBe(false);
        expect(
            readArmCase(
                result({ body: { actionRecommendation: { entryPrices: [] } } })
            ).hasPlan
        ).toBe(false);
    });

    it('reads the card trends against the rule on the printed lines', () => {
        const prompt = `${dynamicPrompt({ stateLines: ['- MA stack: bullish (x)'] })}`;
        const c = readArmCase(
            result({
                promptDynamic: prompt,
                body: {
                    indicatorResults: [
                        {
                            indicatorName: 'MA Signal Guide',
                            signals: [
                                { trend: 'bullish' },
                                { trend: 'bearish' },
                            ],
                        },
                        {
                            indicatorName: 'RSI Signal Guide',
                            signals: [{ trend: 'bullish' }],
                        },
                    ],
                },
            })
        );
        expect(c.trendRows).toEqual([
            { skill: 'MA Signal Guide', model: 'bullish' },
            { skill: 'MA Signal Guide', model: 'bearish' },
            { skill: 'RSI Signal Guide', model: 'bullish' },
        ]);
        expect(cardTrendAgreement([c], { 'MA Signal Guide': 'ma' })).toEqual({
            'MA Signal Guide': { kind: 'ma', n: 2, agree: 1, opposite: 1 },
        });
    });

    it("takes an event card's rule trend from the signals the stored prompt printed for the skill's triggers", () => {
        const prompt = [
            '- RSI(14): 24.5 [falling]',
            'Bullish signals: rsi_oversold(rsi)',
            'Bearish signals: none',
        ].join('\n');
        const c = readArmCase(
            result({
                promptDynamic: prompt,
                body: {
                    indicatorResults: [
                        {
                            indicatorName: 'RSI Signal Guide',
                            signals: [
                                { trend: 'bullish' },
                                { trend: 'bearish' },
                            ],
                        },
                    ],
                },
            })
        );
        const kinds = { 'RSI Signal Guide': 'rsi' };
        expect(
            cardTrendAgreement([c], kinds, {
                'RSI Signal Guide': ['rsi_oversold', 'rsi_overbought'],
            })
        ).toEqual({
            'RSI Signal Guide': { kind: 'rsi', n: 2, agree: 1, opposite: 1 },
        });
        // Without the triggers no signal can be told to belong to the skill: no reading, no row.
        expect(cardTrendAgreement([c], kinds)).toEqual({});
    });
});

describe('bootstrapCi', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

    it('is reproducible and brackets the point estimate', () => {
        const a = bootstrapCi(values, median);
        expect(bootstrapCi(values, median)).toEqual(a);
        expect(a.point).toBe(5.5);
        expect(a.low).toBeLessThanOrEqual(5.5);
        expect(a.high).toBeGreaterThanOrEqual(5.5);
        expect(a.n).toBe(10);
    });

    it('has no interval below two values or without a point', () => {
        expect(bootstrapCi([3], median)).toEqual({
            n: 1,
            point: 3,
            low: null,
            high: null,
        });
        expect(bootstrapCi([], median)).toEqual({
            n: 0,
            point: null,
            low: null,
            high: null,
        });
    });

    it('collapses to the value when every value is equal', () => {
        expect(bootstrapCi([2, 2, 2], median)).toMatchObject({
            low: 2,
            high: 2,
        });
    });
});

describe('ungroundedMentions', () => {
    const patterns: readonly PatternSkill[] = [
        { name: '이중천장', triggers: ['double_top'] },
        { name: '이중바닥', triggers: ['double_bottom'] },
    ];

    it('names a pattern the summary mentions by name, id or spaced id and the prompt did not qualify', () => {
        expect(ungroundedMentions('이중천장이 보입니다', [], patterns)).toEqual(
            ['이중천장']
        );
        expect(ungroundedMentions('a double top here', [], patterns)).toEqual([
            '이중천장',
        ]);
        expect(ungroundedMentions('double_bottom shape', [], patterns)).toEqual(
            ['이중바닥']
        );
        expect(ungroundedMentions('DOUBLE TOP', [], patterns)).toEqual([
            '이중천장',
        ]);
    });

    it('ignores a qualified pattern and a summary that names none', () => {
        expect(
            ungroundedMentions('이중천장이 보입니다', ['double_top'], patterns)
        ).toEqual([]);
        expect(ungroundedMentions('조용한 장입니다', [], patterns)).toEqual([]);
    });
});

// ─── Comparison ───────────────────────────────────────────────────────────────

const arm = (id: string, over: Partial<ArmCase> = {}): ArmCase => ({
    caseId: id,
    failed: false,
    fallback: false,
    hasSummary: true,
    hasPlan: true,
    outputTokens: 1000,
    inputTokens: 5000,
    uncachedTokens: 3000,
    latencyMs: 10000,
    chars: {
        summary: 100,
        indicatorResults: 300,
        strategyResults: 200,
        patternSummaries: 50,
        candlePatterns: 20,
        keyLevels: 40,
        priceTargets: 30,
        actionRecommendation: 60,
    },
    modelChars: 800,
    computedChars: 0,
    computedCards: 0,
    summary: '요약',
    summaryChars: 100,
    listedStrategies: ['Strategy One'],
    strategyChars: { 'Strategy One': 100 },
    strategyEntries: 1,
    qualifiedIds: ['double_top'],
    patternEntries: [
        {
            skillName: '이중천장',
            detected: true,
            candidateId: 'pattern:double_top:1',
        },
    ],
    planPosition: 'in_zone',
    promptFull: 'f',
    trendRows: [],
    prompt: '',
    close: null,
    ...over,
});

const callStats = (ungrounded = 0): RunCallStats => ({
    n: 10,
    failed: share(0, 10),
    missingPlan: share(0, 10),
    unlabelled: share(0, 10),
    ungroundedPlan: share(ungrounded, 100),
    medianOutputTokens: null,
    medianInputTokens: null,
    medianUncachedInputTokens: null,
    medianLatencyMs: null,
});

const ids = Array.from({ length: 10 }, (_, i) => `C${i}`);
const levelCase = (id: string, levels: number[]): LevelCase => ({
    caseId: id,
    repeat: 1,
    atr: 1,
    levels,
});

const patterns: readonly PatternSkill[] = [
    { name: '이중천장', triggers: ['double_top'] },
    { name: '이중바닥', triggers: ['double_bottom'] },
];

function inputOf(
    over: {
        after?: (id: string) => Partial<ArmCase>;
        before?: (id: string) => Partial<ArmCase>;
        repeat?: ((id: string) => Partial<ArmCase>) | null;
        tier?: 'free' | 'member';
        afterLevels?: number[];
        beforeLevels?: number[];
        repeatLevels?: number[];
        ungrounded?: [number, number, number];
        noiseFloor?: number;
        /** Number of cases (default 10). */
        count?: number;
        taggedKinds?: readonly string[];
    } = {}
): ComparisonInput {
    const caseIds =
        over.count === undefined
            ? ids
            : Array.from({ length: over.count }, (_, i) => `C${i}`);
    const cases = (f: ((id: string) => Partial<ArmCase>) | undefined) =>
        caseIds.map(id => arm(id, f?.(id)));
    const levels = (values: number[]) =>
        caseIds.map(id => levelCase(id, values));
    const [ua, ub, ur] = over.ungrounded ?? [0, 0, 0];
    return {
        kindOfSkill: { 'OBV Signal Guide': 'obv' },
        taggedKinds: over.taggedKinds ?? [],
        after: cases(over.after),
        before: cases(over.before),
        repeat:
            over.repeat === null || over.repeat === undefined
                ? null
                : cases(over.repeat),
        patterns,
        levels: {
            after: levels(over.afterLevels ?? [100]),
            before: levels(over.beforeLevels ?? [100]),
            repeat:
                over.repeat === null || over.repeat === undefined
                    ? null
                    : levels(over.repeatLevels ?? [100]),
        },
        calls: {
            after: callStats(ua),
            before: callStats(ub),
            repeat:
                over.repeat === null || over.repeat === undefined
                    ? null
                    : callStats(ur),
        },
        noiseFloor: over.noiseFloor ?? 0,
        tier: over.tier ?? 'member',
    };
}

const gateOf = (c: ReturnType<typeof compareArms>, id: string) => {
    const g = outputGates(c).find(x => x.id === id);
    if (g === undefined) throw new Error(`gate ${id} missing`);
    return g;
};

describe('compareArms', () => {
    it('measures the paired ratios of tokens and latency, and ms per token', () => {
        const c = compareArms(
            inputOf({
                after: () => ({ outputTokens: 700, latencyMs: 7700 }),
            })
        );
        expect(c.n).toBe(10);
        expect(c.tokens.ratio.point).toBeCloseTo(0.7);
        expect(c.tokens.medianBefore).toBe(1000);
        expect(c.tokens.medianAfter).toBe(700);
        expect(c.latency.ratio.point).toBeCloseTo(0.77);
        expect(c.latency.msPerToken.ratio).toBeCloseTo(1.1);
        expect(c.tokens.medianUncachedAfter).toBe(3000);
    });

    it('throws when the runs do not cover the same cases', () => {
        const input = inputOf();
        expect(() =>
            compareArms({ ...input, after: input.after.slice(1) })
        ).toThrow('after and before: the runs do not cover the same cases');
        expect(() =>
            compareArms({ ...input, repeat: input.before.slice(1) })
        ).toThrow('before and repeat');
    });

    it('counts the rates over the cases that have a result and takes the floor from the repeat run', () => {
        const c = compareArms(
            inputOf({
                after: id => (id === 'C0' ? { hasPlan: false } : {}),
                before: id => (id === 'C1' ? { failed: true } : {}),
                repeat: id => (id === 'C2' ? { hasPlan: false } : {}),
            })
        );
        expect(c.rates.missingPlan.after).toMatchObject({ count: 1, n: 10 });
        expect(c.rates.missingPlan.before).toMatchObject({ count: 0, n: 9 });
        expect(c.rates.failed.before).toMatchObject({ count: 1, n: 10 });
        expect(c.rates.missingPlan.floor).toBeCloseTo(0.1);
        expect(c.rates.missingPlan.diff).toBeCloseTo(0.1);
        // Without a repeat run the floor is the one given.
        expect(
            compareArms(inputOf({ noiseFloor: 0.02 })).rates.failed.floor
        ).toBe(0.02);
    });

    it('reports the median and the mean share of each model-written field', () => {
        const c = compareArms(
            inputOf({
                after: () => ({
                    chars: {
                        summary: 100,
                        indicatorResults: 0,
                        strategyResults: 200,
                        patternSummaries: 50,
                        candlePatterns: 20,
                        keyLevels: 40,
                        priceTargets: 30,
                        actionRecommendation: 60,
                    },
                    modelChars: 500,
                }),
            })
        );
        expect(c.fieldChars.indicatorResults).toEqual({
            before: 300,
            after: 0,
        });
        expect(c.fieldMeans.indicatorResults.before.share).toBeCloseTo(
            300 / 800
        );
        expect(c.fieldMeans.indicatorResults.after.mean).toBe(0);
        expect(c.fieldMeans.modelChars.after.mean).toBe(500);
    });

    it('measures the summary ratio and the strategy entry ratio and coverage', () => {
        const c = compareArms(
            inputOf({
                after: () => ({
                    summaryChars: 90,
                    strategyChars: { 'Strategy One': 80 },
                }),
                before: () => ({
                    strategyChars: { 'Strategy One': 100, Dropped: 10 },
                }),
            })
        );
        expect(c.summaryRatio.point).toBeCloseTo(0.9);
        expect(c.strategies.entryRatio.point).toBeCloseTo(0.8);
        expect(c.strategies.listedCoverage.after).toMatchObject({
            count: 10,
            n: 10,
        });
        const missing = compareArms(
            inputOf({ after: () => ({ strategyChars: {} }) })
        );
        expect(missing.strategies.listedCoverage.after.count).toBe(0);
    });

    it('measures the verdict coverage of qualified candidates, by skill or by candidate id', () => {
        const none = { patternEntries: [] };
        const byId = {
            patternEntries: [
                {
                    skillName: 'Other',
                    detected: true,
                    candidateId: 'pattern:double_top:9',
                },
            ],
        };
        expect(
            compareArms(inputOf({ after: () => none })).patterns
                .candidateCoverage.after.count
        ).toBe(0);
        expect(
            compareArms(inputOf({ after: () => byId })).patterns
                .candidateCoverage.after.count
        ).toBe(10);
        expect(
            compareArms(inputOf()).patterns.candidateCoverage.before
        ).toMatchObject({
            count: 10,
            n: 10,
        });
    });

    it('counts detected patterns no printed id selects as model-only, outside the panel items', () => {
        const modelOnly = {
            patternEntries: [
                { skillName: '이중바닥', detected: true, candidateId: null },
                {
                    skillName: '이중천장',
                    detected: true,
                    candidateId: 'pattern:double_top:1',
                },
            ],
        };
        const c = compareArms(inputOf({ before: () => modelOnly }));
        expect(c.patterns.modelOnlyDetected).toEqual({ before: 10, after: 0 });
        expect(c.patterns.panelItems.before).toBe(2);
        expect(c.patterns.panelItems.diff.point).toBe(0);
    });

    it('measures summaries naming an unqualified pattern in each arm by its own prompt', () => {
        const c = compareArms(
            inputOf({
                after: id =>
                    id === 'C0' ? { summary: '이중바닥이 보입니다' } : {},
            })
        );
        expect(c.patterns.ungroundedSummary.after).toMatchObject({
            count: 1,
            n: 10,
        });
        expect(c.patterns.ungroundedSummary.before.count).toBe(0);
        expect(c.patterns.ungroundedSummary.diff).toBeCloseTo(0.1);
    });

    it('measures level, position and detected-candidate agreement against the repeat noise floor', () => {
        const same = compareArms(inputOf({ repeat: () => ({}) }));
        expect(same.levels.vsBefore).toMatchObject({ n: 10, point: 0 });
        expect(same.position.diff).toMatchObject({ n: 10, point: 0 });
        expect(same.patterns.detectedWithCandidate).toMatchObject({ point: 0 });
        const worse = compareArms(
            inputOf({
                repeat: () => ({}),
                afterLevels: [200],
                after: () => ({ planPosition: 'above', patternEntries: [] }),
            })
        );
        expect(worse.levels.vsBefore?.point).toBe(-1);
        expect(worse.position.diff?.point).toBe(-1);
        expect(worse.patterns.detectedWithCandidate?.point).toBe(-1);
        expect(worse.position.equalToBefore.point).toBe(0);
    });

    it('has no non-inferiority measure without a repeat run, and no position without a plan state', () => {
        const c = compareArms(
            inputOf({ after: () => ({ planPosition: null }) })
        );
        expect(c.levels.vsBefore).toBeNull();
        expect(c.position.diff).toBeNull();
        expect(c.patterns.detectedWithCandidate).toBeNull();
        expect(c.position.equalToBefore.n).toBe(0);
        expect(c.promptsIdentical).toBeNull();
    });

    it('reports how many before and repeat prompts are identical', () => {
        const c = compareArms(
            inputOf({
                repeat: id => (id === 'C0' ? { promptFull: 'other' } : {}),
            })
        );
        expect(c.promptsIdentical).toMatchObject({ count: 9, n: 10 });
    });

    it('takes a deterministic prose sample of 10, 10 and 20 without repeats', () => {
        const many = Array.from({ length: 80 }, (_, i) => `K${i}`);
        const build = (f: (id: string) => Partial<ArmCase>) =>
            many.map(id => arm(id, f(id)));
        const base = inputOf();
        const c = compareArms({
            ...base,
            after: build(id => ({ computedCards: Number(id.slice(1)) % 2 })),
            before: build(() => ({})),
            levels: { after: [], before: [], repeat: null },
        });
        const { qualified, cycle, random } = c.proseSample;
        expect([qualified.length, cycle.length, random.length]).toEqual([
            10, 10, 20,
        ]);
        expect(new Set([...qualified, ...cycle, ...random]).size).toBe(40);
        expect(
            compareArms({
                ...base,
                after: build(id => ({
                    computedCards: Number(id.slice(1)) % 2,
                })),
                before: build(() => ({})),
                levels: { after: [], before: [], repeat: null },
            }).proseSample
        ).toEqual(c.proseSample);
    });
});

describe('outputGates at their margins', () => {
    /** The comparison of 100 equal cases, which a test then moves to one side of a margin. */
    const hundred = (over: Parameters<typeof inputOf>[0] = {}) =>
        compareArms(inputOf({ count: 100, repeat: () => ({}), ...over }));
    const withCi = (
        c: ReturnType<typeof compareArms>,
        low: number
    ): ReturnType<typeof compareArms> => ({
        ...c,
        levels: {
            ...c.levels,
            vsBefore: { n: 100, point: low, low, high: 0 },
        },
        position: {
            ...c.position,
            diff: { n: 100, point: low, low, high: 0 },
        },
        patterns: {
            ...c.patterns,
            detectedWithCandidate: { n: 100, point: low, low, high: 0 },
        },
    });

    it('L1 passes with its interval low at -3 pp and fails just beyond', () => {
        const at = gateOf(withCi(hundred(), C.gates.levelMargin), 'L1');
        const beyond = gateOf(
            withCi(hundred(), C.gates.levelMargin - 0.0001),
            'L1'
        );
        expect([at.pass, beyond.pass]).toEqual([true, false]);
    });

    it('L2 passes with its interval low at -5 pp and fails just beyond', () => {
        const at = gateOf(withCi(hundred(), C.gates.positionMargin), 'L2');
        const beyond = gateOf(
            withCi(hundred(), C.gates.positionMargin - 0.0001),
            'L2'
        );
        expect([at.pass, beyond.pass]).toEqual([true, false]);
    });

    it('V3 agreement passes at -3 pp and fails just beyond, and reports how many cases it covers', () => {
        const at = gateOf(
            withCi(hundred(), C.gates.detectedCandidateMargin),
            'V3'
        );
        const beyond = gateOf(
            withCi(hundred(), C.gates.detectedCandidateMargin - 0.0001),
            'V3'
        );
        expect([at.pass, beyond.pass]).toEqual([true, false]);
        expect(at.value).toContain('over 100 cases with a detected candidate');
    });

    it('the constant level drift of -3 pp passes through the real bootstrap, -4 pp fails', () => {
        const base = Array.from({ length: 100 }, (_, i) => i * 10);
        const shifted = (moved: number) =>
            base.map((v, i) => (i < moved ? v + 5 : v));
        const run = (moved: number) =>
            gateOf(
                hundred({
                    beforeLevels: base,
                    afterLevels: shifted(moved),
                    repeatLevels: base,
                }),
                'L1'
            );
        expect(run(3).pass).toBe(true);
        expect(run(4).pass).toBe(false);
    });

    it('V3 candidate coverage passes at -2 pp and fails at -3 pp', () => {
        const coverage = (covered: number) => {
            const c = hundred();
            return gateOf(
                {
                    ...c,
                    patterns: {
                        ...c.patterns,
                        candidateCoverage: {
                            before: share(100, 100),
                            after: share(covered, 100),
                        },
                    },
                },
                'V3'
            );
        };
        expect(coverage(98).pass).toBe(true);
        expect(coverage(97).pass).toBe(false);
    });

    it('V5 passes at +1 pp of summaries naming an unqualified pattern and fails at +1.5 pp', () => {
        const named = (count: number) =>
            gateOf(
                compareArms(
                    inputOf({
                        count: 200,
                        after: id =>
                            Number(id.slice(1)) < count
                                ? { summary: '이중바닥이 보입니다' }
                                : {},
                    })
                ),
                'V5'
            );
        expect(named(2).pass).toBe(true);
        expect(named(3).pass).toBe(false);
    });

    it('V5 reads a name split by a line break and extra spaces', () => {
        expect(
            ungroundedMentions(
                '이중\n  바닥',
                [],
                [{ name: '이중 바닥', triggers: ['double_bottom'] }]
            )
        ).toEqual(['이중 바닥']);
        expect(ungroundedMentions('double   bottom', [], patterns)).toEqual([
            '이중바닥',
        ]);
    });

    it('a gate needs 90% of the cases paired: 90 of 100 decide, 89 do not', () => {
        const failedAfter = (failed: number) =>
            hundred({
                after: id =>
                    Number(id.slice(1)) < failed ? { failed: true } : {},
                before: () => ({}),
            });
        const ids = ['O1', 'O2', 'V1', 'V2', 'V3', 'V4', 'V5', 'L2'];
        const decided = (failed: number) =>
            outputGates(failedAfter(failed))
                .filter(g => ids.includes(g.id))
                .map(g => g.pass);
        expect(decided(10)).toEqual(ids.map(() => expect.anything()));
        expect(decided(11).every(p => p === null)).toBe(true);
        const o1 = outputGates(failedAfter(11)).find(g => g.id === 'O1');
        expect(o1?.value).toContain('paired 89 of 100');
    });
});

describe('level coverage', () => {
    it('L1 is undecided when fewer than 90% of the cases have levels in both runs', () => {
        const input = inputOf({ count: 100, repeat: () => ({}) });
        const thin = (kept: number) =>
            gateOf(
                compareArms({
                    ...input,
                    levels: {
                        after: input.levels.after.slice(0, kept),
                        before: input.levels.before,
                        repeat: input.levels.repeat,
                    },
                }),
                'L1'
            );
        expect(thin(90).pass).toBe(true);
        expect(thin(89).pass).toBeNull();
    });
});

describe('outputGates', () => {
    const tokens = (ratio: number) =>
        compareArms(
            inputOf({
                after: () => ({ outputTokens: Math.round(1000 * ratio) }),
            })
        );

    it('O1 passes at the member bound and fails above it, with the interval bound too', () => {
        expect(gateOf(tokens(C.gates.outputMaxRatioMember), 'O1').pass).toBe(
            true
        );
        expect(gateOf(tokens(0.751), 'O1').pass).toBe(false);
        expect(gateOf(tokens(0.7), 'O1').pass).toBe(true);
    });

    it('O1 takes the looser bounds for free', () => {
        const free = compareArms(
            inputOf({ tier: 'free', after: () => ({ outputTokens: 790 }) })
        );
        expect(gateOf(free, 'O1').pass).toBe(true);
        const over = compareArms(
            inputOf({ tier: 'free', after: () => ({ outputTokens: 810 }) })
        );
        expect(gateOf(over, 'O1').pass).toBe(false);
    });

    it('O1 fails when the upper bound is over its limit though the median is under', () => {
        const spread = compareArms({
            ...inputOf(),
            after: ids.map((id, i) =>
                arm(id, { outputTokens: i < 6 ? 700 : 1500 })
            ),
        });
        expect(spread.tokens.ratio.point).toBeLessThanOrEqual(0.75);
        expect(spread.tokens.ratio.high).toBeGreaterThan(0.8);
        expect(gateOf(spread, 'O1').pass).toBe(false);
    });

    it('O2 passes at the latency bound and fails above it', () => {
        const at = (latencyMs: number) =>
            gateOf(
                compareArms(inputOf({ after: () => ({ latencyMs }) })),
                'O2'
            );
        expect(at(8000).pass).toBe(true);
        expect(at(8001).pass).toBe(false);
    });

    it('F1 allows one point, or the repeat floor when it is larger', () => {
        const rate = (n: number, repeatN = 0) =>
            gateOf(
                compareArms(
                    inputOf({
                        after: id => ({ hasPlan: Number(id.slice(1)) >= n }),
                        repeat: id => ({
                            hasPlan: Number(id.slice(1)) >= repeatN,
                        }),
                    })
                ),
                'F1'
            );
        expect(rate(0).pass).toBe(true);
        expect(rate(1).pass).toBe(false);
        expect(rate(2, 2).pass).toBe(true);
        expect(rate(3, 2).pass).toBe(false);
    });

    it('F2 compares the ungrounded plan share with one point or the repeat floor', () => {
        const f2 = (u: [number, number, number]) =>
            gateOf(compareArms(inputOf({ ungrounded: u })), 'F2');
        const withRepeat = (u: [number, number, number]) =>
            gateOf(
                compareArms(inputOf({ ungrounded: u, repeat: () => ({}) })),
                'F2'
            );
        expect(f2([1, 0, 0]).pass).toBe(true);
        expect(f2([2, 0, 0]).pass).toBe(false);
        expect(withRepeat([2, 0, 0]).pass).toBe(false);
        expect(withRepeat([2, 0, 2]).pass).toBe(true);
        expect(withRepeat([3, 0, 2]).pass).toBe(false);
    });

    it('L1 and L2 and the V3 agreement need a repeat run and pass when after is as close as the repeat', () => {
        const none = compareArms(inputOf());
        ['L1', 'L2', 'V3'].forEach(id =>
            expect(gateOf(none, id).pass).toBeNull()
        );
        const same = compareArms(inputOf({ repeat: () => ({}) }));
        expect(gateOf(same, 'L1').pass).toBe(true);
        expect(gateOf(same, 'L2').pass).toBe(true);
        expect(gateOf(same, 'V3').pass).toBe(true);
        const worse = compareArms(
            inputOf({
                repeat: () => ({}),
                afterLevels: [200],
                after: () => ({ planPosition: 'above', patternEntries: [] }),
            })
        );
        expect(gateOf(worse, 'L1').pass).toBe(false);
        expect(gateOf(worse, 'L2').pass).toBe(false);
        expect(gateOf(worse, 'V3').pass).toBe(false);
    });

    it('V1 holds the summary ratio in its band, bounds included', () => {
        const v1 = (chars: number) =>
            gateOf(
                compareArms(
                    inputOf({ after: () => ({ summaryChars: chars }) })
                ),
                'V1'
            );
        expect(v1(85).pass).toBe(true);
        expect(v1(84).pass).toBe(false);
        expect(v1(125).pass).toBe(true);
        expect(v1(126).pass).toBe(false);
    });

    it('V2 needs coverage within a point and the entry length at its floor', () => {
        const v2 = (length: number, covered: boolean) =>
            gateOf(
                compareArms(
                    inputOf({
                        after: (): Partial<ArmCase> => ({
                            strategyChars: covered
                                ? { 'Strategy One': length }
                                : {},
                        }),
                    })
                ),
                'V2'
            );
        expect(v2(85, true).pass).toBe(true);
        expect(v2(84, true).pass).toBe(false);
        expect(v2(100, false).pass).toBe(false);
    });

    it('V3 needs the candidate coverage within two points', () => {
        const withEntries = (count: number) =>
            gateOf(
                compareArms(
                    inputOf({
                        repeat: () => ({}),
                        after: id =>
                            Number(id.slice(1)) < count
                                ? {}
                                : { patternEntries: [] },
                    })
                ),
                'V3'
            );
        expect(withEntries(10).pass).toBe(true);
        expect(withEntries(9).pass).toBe(false);
    });

    it('V4 allows panel items to fall by 0.1 and no more', () => {
        const v4 = (entries: number) =>
            gateOf(
                compareArms(
                    inputOf({ after: () => ({ strategyEntries: entries }) })
                ),
                'V4'
            );
        expect(v4(1).pass).toBe(true);
        expect(v4(0).pass).toBe(false);
        expect(v4(3).pass).toBe(true);
    });

    it('V5 allows one point more summaries naming an unqualified pattern', () => {
        const named = (count: number) =>
            gateOf(
                compareArms(
                    inputOf({
                        after: id => ({
                            summary:
                                Number(id.slice(1)) < count
                                    ? '이중바닥'
                                    : '조용',
                        }),
                    })
                ),
                'V5'
            );
        expect(named(0).pass).toBe(true);
        expect(named(1).pass).toBe(false);
    });

    it('D7 needs 30 readings of a skill and fails it above 5% opposite', () => {
        const rows = (opposite: number, n = 40) =>
            Array.from({ length: n }, (_, i) => ({
                skill: 'OBV Signal Guide',
                model: i < opposite ? 'bearish' : 'bullish',
            }));
        const d7 = (
            trendRows: ArmCase['trendRows'],
            taggedKinds: string[] = []
        ) =>
            gateOf(
                compareArms(
                    inputOf({
                        taggedKinds,
                        before: id =>
                            id === 'C0'
                                ? { trendRows, prompt: '- OBV: 5 [rising]' }
                                : {},
                    })
                ),
                'D7'
            );
        expect(d7(rows(2)).pass).toBe(true);
        expect(d7(rows(3)).pass).toBe(false);
        expect(d7(rows(0, 29)).pass).toBeNull();
    });

    it('D7 is undecided while a tagged kind has no trend rule, and decides again once it has one', () => {
        const rows = Array.from({ length: 40 }, () => ({
            skill: 'OBV Signal Guide',
            model: 'bullish',
        }));
        const d7 = (taggedKinds: string[]) =>
            gateOf(
                compareArms(
                    inputOf({
                        taggedKinds,
                        before: id =>
                            id === 'C0'
                                ? {
                                      trendRows: rows,
                                      prompt: '- OBV: 5 [rising]',
                                  }
                                : {},
                    })
                ),
                'D7'
            );
        // Every kind core can tag has a rule, so the gate decides on all of them.
        expect(d7(['obv', 'macd_cycle', 'stochastic', 'rsi', 'cci']).pass).toBe(
            true
        );
        expect(d7([...COMPUTED_CARD_KINDS]).pass).toBe(true);
        const undecided = d7(['obv', 'mystery_kind', 'other_kind']);
        expect(undecided.pass).toBeNull();
        expect(undecided.value).toContain('mystery_kind, other_kind');
    });

    it('every gate id is produced', () => {
        expect(outputGates(compareArms(inputOf())).map(g => g.id)).toEqual([
            'D7',
            'O1',
            'O2',
            'F1',
            'F2',
            'L1',
            'L2',
            'V1',
            'V2',
            'V3',
            'V4',
            'V5',
        ]);
    });
});
