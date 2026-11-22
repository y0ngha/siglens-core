import { describe, expect, it } from 'vitest';
import {
    bucketOf,
    collectWarnings,
    compareRuns,
    computeFlipRates,
    headlineRows,
    noiseVerdict,
    pairRows,
    summarizeCounts,
    summarizeForward,
    summarizeInvariants,
    summarizeLevels,
    summarizePatterns,
    summarizePlans,
    summarizeProvenance,
    summarizeVariance,
    verdictOf,
} from '../../../../scripts/replay/reportCompute';
import type { LabelRow } from '../../../../scripts/replay/types';
import { makeLabels, makeRow } from './replayFixtures';

type PlanPatch = NonNullable<Parameters<typeof makeLabels>[0]>['plan'];

const planRow = (plan: PlanPatch, extra: Partial<LabelRow> = {}): LabelRow =>
    makeRow({ labels: makeLabels({ plan }), ...extra });

const targetFirst = (rw: number, gap = false): LabelRow =>
    planRow({
        outcome: 'target_first',
        rwNullTargetFirst: rw,
        returnPct: 3,
        gap,
        baselineSameLengthPct: 1,
    });
const stopFirst = (rw: number): LabelRow =>
    planRow({
        outcome: 'stop_first',
        rwNullTargetFirst: rw,
        returnPct: -2,
        gap: false,
        baselineSameLengthPct: 1,
    });

describe('bucketOf and verdictOf', () => {
    it('puts failed, unlabelled, excluded and headline rows in their own buckets', () => {
        expect(bucketOf(makeRow({ status: 'failed', labels: null }))).toBe(
            'failed'
        );
        expect(
            bucketOf(makeRow({ status: 'anchor_missing', labels: null }))
        ).toBe('unlabelled');
        expect(
            bucketOf(
                makeRow({
                    labels: makeLabels({ anchorSource: 'generated_at' }),
                })
            )
        ).toBe('excluded');
        expect(bucketOf(planRow({ anchorBarUnobserved: true }))).toBe(
            'excluded'
        );
        expect(bucketOf(makeRow())).toBe('headline');
    });

    it('reads the verdict from the plan label, then the subject, else none', () => {
        expect(verdictOf(planRow({ recommendation: 'wait' }))).toBe('wait');
        expect(
            verdictOf(makeRow({ labels: null, status: 'anchor_missing' }))
        ).toBe('enter');
        expect(
            verdictOf(planRow({ recommendation: null }, { subject: null }))
        ).toBe('none');
    });

    it('keeps excluded rows out of the headline set', () => {
        const rows = [
            makeRow(),
            makeRow({ labels: makeLabels({ anchorSource: 'generated_at' }) }),
        ];
        expect(headlineRows(rows)).toHaveLength(1);
    });
});

describe('summarizeCounts', () => {
    it('counts each bucket with its n and the missing-plan share of headline rows', () => {
        const rows = [
            makeRow(),
            planRow({ outcome: 'no_plan', reason: 'none' }),
            makeRow({ status: 'failed', labels: null }),
            makeRow({ status: 'subject_invalid', labels: null }),
            makeRow({ labels: makeLabels({ anchorSource: 'generated_at' }) }),
        ];
        const c = summarizeCounts(rows);
        expect(c.rows).toBe(5);
        expect(c.failed).toEqual({ count: 1, n: 5, share: 0.2 });
        expect(c.unlabelled.count).toBe(1);
        expect(c.excluded.count).toBe(1);
        expect(c.headline.count).toBe(2);
        expect(c.missingPlan).toEqual({ count: 1, n: 2, share: 0.5 });
    });

    it('has a null share, not 0, for no rows', () => {
        expect(summarizeCounts([]).failed.share).toBeNull();
    });
});

describe('summarizePlans', () => {
    const rows = [
        targetFirst(0.4),
        stopFirst(0.4),
        planRow({ outcome: 'ambiguous', rwNullTargetFirst: 0.4 }),
        planRow({
            outcome: 'open_at_horizon',
            rwNullTargetFirst: 0.4,
            returnPct: 0.5,
            gap: false,
            baselineSameLengthPct: 0.2,
        }),
        planRow({ outcome: 'not_triggered' }),
        planRow({ outcome: 'void_at_entry', reason: 'gap_below_stop' }),
        planRow({ outcome: 'no_plan', reason: 'avoid' }),
    ];
    const s = summarizePlans(rows);

    it('counts every outcome', () => {
        expect(s.n).toBe(7);
        expect(s.outcomes).toMatchObject({
            target_first: 1,
            stop_first: 1,
            ambiguous: 1,
            open_at_horizon: 1,
            not_triggered: 1,
            void_at_entry: 1,
            no_plan: 1,
        });
    });

    it('measures target_first over all triggered plans, open and ambiguous included', () => {
        expect(s.triggered).toBe(4);
        expect(s.targetFirst).toEqual({ count: 1, n: 4, share: 0.25 });
    });

    it('never counts not_triggered, void_at_entry or no_plan as wins or in the denominator', () => {
        expect(s.targetFirst.n).toBe(4);
        expect(s.targetFirst.count).toBe(1);
    });

    it('compares with the mean no-horizon null of the same plans', () => {
        expect(s.nullMean.mean).toBeCloseTo(0.4, 12);
        expect(s.nullMean.n).toBe(4);
        expect(s.diff).toBeCloseTo(0.25 - 0.4, 12);
    });

    it('leaves out a triggered plan with no null from both sides of the comparison', () => {
        const withMissing = summarizePlans([
            targetFirst(0.4),
            planRow({ outcome: 'stop_first', rwNullTargetFirst: null }),
        ]);
        expect(withMissing.targetFirst).toEqual({ count: 1, n: 1, share: 1 });
    });

    it('reports a null difference when nothing triggered', () => {
        expect(
            summarizePlans([planRow({ outcome: 'not_triggered' })]).diff
        ).toBeNull();
    });

    it('shows gap exits apart from level exits wherever a mean return is printed', () => {
        const mixed = summarizePlans([
            targetFirst(0.4, false),
            targetFirst(0.4, true),
            stopFirst(0.4),
        ]);
        expect(mixed.returnNonGap).toMatchObject({ n: 2 });
        expect(mixed.returnNonGap.mean).toBeCloseTo(0.5, 12);
        expect(mixed.returnGap).toMatchObject({ n: 1, mean: 3 });
        expect(mixed.excessGap.mean).toBe(2);
        expect(mixed.excessNonGap.n).toBe(2);
    });

    it('counts the reasons of no_plan and void_at_entry', () => {
        expect(s.reasons).toEqual({
            'void_at_entry:gap_below_stop': 1,
            'no_plan:avoid': 1,
        });
    });
});

describe('summarizeLevels', () => {
    const level = (
        outcome: 'respected' | 'broken' | 'skipped' | 'untouched',
        placebo: ('respected' | 'broken' | 'skipped')[],
        gap = false
    ) => ({
        role: 'support' as const,
        price: 98,
        outcome,
        skipReason: null,
        distanceAtr: 1,
        touchOffset: 1,
        resolveOffset: 1,
        gap,
        placebo: [
            {
                shiftAtr: 0.5,
                outcome: placebo[0],
                skipReason: null,
                touchOffset: null,
            },
            {
                shiftAtr: -0.5,
                outcome: placebo[1],
                skipReason: null,
                touchOffset: null,
            },
        ],
    });
    const rows = [
        makeRow({
            labels: makeLabels({
                levels: [
                    level('respected', ['broken', 'respected']),
                    level('broken', ['broken', 'broken'], true),
                ],
            }),
        }),
        // real evaluated, placebo skipped: leaves the pair set
        makeRow({
            labels: makeLabels({
                levels: [level('respected', ['skipped', 'respected'])],
            }),
        }),
        // real skipped: leaves the pair set
        makeRow({
            labels: makeLabels({
                levels: [level('skipped', ['respected', 'respected'])],
            }),
        }),
    ];

    it('compares only where both the real level and the placebo were evaluated', () => {
        const far = summarizeLevels(rows, 0.5);
        expect(far.pairs).toBe(2);
        expect(far.real).toMatchObject({
            evaluated: 2,
            respected: 1,
            resolved: 2,
            brokenByGap: 1,
        });
        expect(far.placebo).toMatchObject({ evaluated: 2, respected: 0 });
        expect(far.diff).toBe(0.5);
    });

    it('reads the closer placebo separately', () => {
        const near = summarizeLevels(rows, -0.5);
        expect(near.pairs).toBe(3);
        expect(near.real.respected).toBe(2);
        expect(near.placebo.respected).toBe(2);
    });

    it('has a null difference for no pairs', () => {
        expect(summarizeLevels([makeRow()], 0.5)).toMatchObject({
            pairs: 0,
            diff: null,
        });
    });
});

describe('summarizePatterns', () => {
    const pattern = (outcome: string, extra: Record<string, unknown> = {}) => ({
        name: 'p',
        candidateId: null,
        direction: 'up' as const,
        outcome,
        skipReason: null,
        alreadyBroken: false,
        breakoutOffset: null,
        resolveOffset: null,
        gap: null,
        measuredTarget: null,
        rwNullTargetFirst: null,
        ...extra,
    });
    const rows = [
        makeRow({
            labels: makeLabels({
                patterns: [
                    pattern('target_first', {
                        rwNullTargetFirst: 0.5,
                        gap: true,
                    }),
                    pattern('invalidation_first', { rwNullTargetFirst: 0.5 }),
                    pattern('skipped', { skipReason: 'target_reached' }),
                    pattern('skipped', {
                        skipReason: 'target_reached_on_breakout',
                    }),
                    pattern('skipped', { skipReason: 'geometry_invalid' }),
                    pattern('no_breakout'),
                ] as never,
            }),
        }),
    ];
    const s = summarizePatterns(rows);

    it('counts the two target-reached skip reasons separately', () => {
        expect(s.skipReasons).toEqual({
            geometry_invalid: 1,
            target_reached: 1,
            target_reached_on_breakout: 1,
        });
    });

    it('compares target_first over raced patterns only, with the gap exits counted', () => {
        expect(s.raced).toBe(2);
        expect(s.targetFirst).toEqual({ count: 1, n: 2, share: 0.5 });
        expect(s.diff).toBeCloseTo(0, 12);
        expect(s.gapExits).toBe(1);
        expect(s.n).toBe(6);
    });
});

describe('summarizeForward', () => {
    it('reports return and the excess over the window and the period baselines with n', () => {
        const rows = [
            makeRow({
                labels: makeLabels({
                    forward: [
                        { h: 5, returnPct: 3, baselinePct: 1, baselineN: 40 },
                    ],
                }),
                periodBaselinePct: { '5': 0.5 },
            }),
            makeRow({
                labels: makeLabels({
                    forward: [
                        { h: 5, returnPct: 1, baselinePct: null, baselineN: 3 },
                    ],
                }),
                periodBaselinePct: { '5': 0.5 },
            }),
        ];
        const s = summarizeForward(rows, 5);
        expect(s.returns).toMatchObject({ n: 2, mean: 2 });
        expect(s.excessWindow).toMatchObject({ n: 1, mean: 2, se: null });
        expect(s.excessPeriod).toMatchObject({ n: 2, mean: 1.5 });
        expect(s.excessPeriod.se).toBeCloseTo(1, 12);
    });

    it('has n=0 and a null mean for a horizon without values', () => {
        expect(
            summarizeForward([makeRow({ labels: null, status: 'failed' })], 5)
                .returns
        ).toEqual({ n: 0, mean: null, se: null });
    });
});

describe('summarizeProvenance and invariants', () => {
    const prov = (checked: number, ungrounded: number) => ({
        checked: { plan: checked, other: 2, keyPrices: 1 },
        ungrounded: { plan: ungrounded, other: 1, keyPrices: 0 },
    });

    it('adds up ungrounded and checked prices per class, with the control apart', () => {
        const s = summarizeProvenance([
            makeRow({ provenance: prov(4, 1), provenanceControl: prov(4, 3) }),
            makeRow({ provenance: prov(6, 0), provenanceControl: null }),
            makeRow({ provenance: null }),
        ]);
        expect(s.rows).toBe(2);
        expect(s.plan).toEqual({ count: 1, n: 10, share: 0.1 });
        expect(s.planControl).toEqual({ count: 3, n: 4, share: 0.75 });
        expect(s.other).toMatchObject({ count: 2, n: 4 });
    });

    it('counts rows breaking each invariant among rows with a result', () => {
        const s = summarizeInvariants([
            makeRow({ invariants: ['stop_below_zone', 'finite'] }),
            makeRow({ invariants: ['stop_below_zone'] }),
            makeRow({ status: 'failed', labels: null, invariants: ['finite'] }),
        ]);
        expect(s.n).toBe(2);
        expect(s.byRule).toEqual({ stop_below_zone: 2, finite: 1 });
    });
});

describe('variance', () => {
    const run = (
        n: number,
        over: {
            trend?: 'bullish' | 'bearish';
            outcome?: 'target_first' | 'stop_first';
            stop?: number;
            level?: number;
        }
    ) =>
        makeRow({
            repeat: n,
            subject: {
                v: 1,
                anchor: null,
                trend: over.trend ?? 'bullish',
                riskLevel: 'low',
                plan: {
                    recommendation: 'enter',
                    position: 'in_zone',
                    entryLow: 98,
                    entryHigh: 100,
                    stop: over.stop ?? 95,
                    targets: [104],
                    reconciled: false,
                },
                levels: [
                    { role: 'support', price: over.level ?? 97, refLabels: [] },
                    { role: 'resistance', price: 105, refLabels: [] },
                ],
                scenarioTargets: [],
                patterns: [],
            },
            labels: makeLabels({
                plan: { outcome: over.outcome ?? 'target_first' },
                levels: [
                    {
                        role: 'support',
                        price: over.level ?? 97,
                        outcome: 'respected',
                        skipReason: null,
                        distanceAtr: 1,
                        touchOffset: 1,
                        resolveOffset: 1,
                        gap: false,
                        placebo: [],
                    },
                    {
                        role: 'resistance',
                        price: 105,
                        outcome: 'untouched',
                        skipReason: null,
                        distanceAtr: 2,
                        touchOffset: null,
                        resolveOffset: null,
                        gap: false,
                        placebo: [],
                    },
                ],
            }),
        });

    it('needs at least two runs of a case', () => {
        expect(summarizeVariance([run(1, {})]).cases).toBe(0);
    });

    it('reports full agreement and a zero flip rate for identical runs', () => {
        const s = summarizeVariance([run(1, {}), run(2, {}), run(3, {})]);
        expect(s.cases).toBe(1);
        expect(s.agreement.trend).toEqual({ count: 1, n: 1, share: 1 });
        expect(s.flips.planOutcome).toEqual({ flips: 0, n: 3, rate: 0 });
        expect(s.levelJaccard.mean).toBe(1);
        expect(s.spreadAtr.stop).toMatchObject({ n: 1, median: 0 });
    });

    it('counts pairwise flips: one differing run of three flips two of three pairs', () => {
        const flips = computeFlipRates([
            run(1, {}),
            run(2, {}),
            run(3, { trend: 'bearish', outcome: 'stop_first' }),
        ]);
        expect(flips.trend).toEqual({ flips: 2, n: 3, rate: 2 / 3 });
        expect(flips.planOutcome).toEqual({ flips: 2, n: 3, rate: 2 / 3 });
        expect(flips.entryRecommendation.flips).toBe(0);
    });

    it('measures plan price spread in ATR units and key-level overlap', () => {
        const s = summarizeVariance([
            run(1, { stop: 95 }),
            run(2, { stop: 93, level: 96 }),
        ]);
        // max - min = 2 over ATR 2
        expect(s.spreadAtr.stop).toMatchObject({ n: 1, median: 1, p90: 1 });
        // sets {s97,r105} and {s96,r105}: 1 shared over 3
        expect(s.levelJaccard.mean).toBeCloseTo(1 / 3, 12);
        expect(s.agreement.levelOutcome.n).toBe(1);
    });

    it('compares a level only when both runs produced it', () => {
        const flips = computeFlipRates([
            run(1, { level: 97 }),
            run(2, { level: 96 }),
        ]);
        expect(flips.levelOutcome.n).toBe(1);
    });

    it('has a null rate where nothing could be compared', () => {
        expect(computeFlipRates([run(1, {})]).trend).toEqual({
            flips: 0,
            n: 0,
            rate: null,
        });
    });
});

describe('noiseVerdict', () => {
    it('calls a difference below the flip rate within noise and one at or above it not', () => {
        expect(noiseVerdict(0.04, 0.05)).toBe('within_noise');
        expect(noiseVerdict(-0.04, 0.05)).toBe('within_noise');
        expect(noiseVerdict(0.05, 0.05)).toBe('above_noise');
        expect(noiseVerdict(0.06, 0.05)).toBe('above_noise');
    });

    it('is unknown, not insignificant, without a flip rate or a difference', () => {
        expect(noiseVerdict(0.01, null)).toBe('unknown');
        expect(noiseVerdict(null, 0.05)).toBe('unknown');
    });
});

describe('collectWarnings', () => {
    it('counts anchors that should not occur in a replay', () => {
        const w = collectWarnings([
            makeRow(),
            makeRow({ labels: makeLabels({ anchorSource: 'generated_at' }) }),
            planRow({ anchorBarUnobserved: true }),
            makeRow({ dataAsOfMatches: false }),
        ]);
        expect(w).toEqual({
            excluded: 2,
            generatedAt: 1,
            anchorBarUnobserved: 1,
            dataAsOfMismatch: 1,
        });
    });
});

describe('compareRuns', () => {
    const a = [
        makeRow({ caseId: 'X|1' }),
        makeRow({
            caseId: 'Y|1',
            labels: makeLabels({ plan: { outcome: 'stop_first' } }),
        }),
        makeRow({ caseId: 'Z|1', status: 'failed', labels: null }),
    ];
    const b = [
        makeRow({
            caseId: 'X|1',
            labels: makeLabels({ plan: { outcome: 'target_first' } }),
        }),
        makeRow({
            caseId: 'Y|1',
            labels: makeLabels({ plan: { outcome: 'stop_first' } }),
        }),
        makeRow({ caseId: 'Z|1' }),
        makeRow({ caseId: 'ONLY_B|1' }),
    ];

    it('pairs by case and repeat', () => {
        expect(pairRows(a, b)).toHaveLength(3);
        expect(pairRows(a, [{ ...b[0], repeat: 2 }])).toHaveLength(0);
    });

    it('counts flips per label over the pairs', () => {
        const c = compareRuns(a, b);
        expect(c.pairs).toBe(3);
        expect(c.flips.planOutcome).toEqual({ flips: 1, n: 2, rate: 0.5 });
        expect(c.flips.trend).toMatchObject({ flips: 0 });
    });

    it('reports paired differences B minus A with n', () => {
        const item = (name: string) =>
            compareRuns(a, b).paired.find(p => p.name.startsWith(name));
        expect(item('failure rate')).toMatchObject({
            n: 3,
            meanA: 1 / 3,
            meanB: 0,
        });
        expect(item('failure rate')?.diff.mean).toBeCloseTo(-1 / 3, 12);
        expect(item('target_first')).toMatchObject({
            n: 2,
            meanA: 0,
            meanB: 0.5,
        });
        expect(item('target_first')?.diff.mean).toBe(0.5);
        expect(item('stop_first')?.diff.mean).toBe(0);
    });

    it('skips a failed pair in the label-based rates', () => {
        expect(
            compareRuns(a, b).paired.find(p =>
                p.name.startsWith('plan triggered')
            )?.n
        ).toBe(2);
    });
});

describe('sampling standard error of the model-minus-null difference', () => {
    const tf = (hit: boolean, rw: number) =>
        planRow({
            outcome: hit ? 'target_first' : 'stop_first',
            rwNullTargetFirst: rw,
        });

    it('is the mean and sample standard error of 1[target_first] − rwNull per triggered plan', () => {
        // d = 1 - 0.4 = 0.6, 0 - 0.4 = -0.4, 0 - 0.6 = -0.6, 1 - 0.2 = 0.8
        const s = summarizePlans([
            tf(true, 0.4),
            tf(false, 0.4),
            tf(false, 0.6),
            tf(true, 0.2),
        ]);
        const d = [0.6, -0.4, -0.6, 0.8];
        const mean = d.reduce((a, b) => a + b, 0) / 4;
        const sd = Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / 3);
        expect(s.diffStat.n).toBe(4);
        expect(s.diffStat.mean).toBeCloseTo(mean, 12);
        expect(s.diffStat.se).toBeCloseTo(sd / 2, 12);
        expect(s.diff).toBeCloseTo(mean, 12);
    });

    it('has no standard error for one plan and no mean for none', () => {
        expect(summarizePlans([tf(true, 0.5)]).diffStat).toEqual({
            n: 1,
            mean: 0.5,
            se: null,
        });
        expect(
            summarizePlans([planRow({ outcome: 'not_triggered' })]).diffStat
        ).toEqual({
            n: 0,
            mean: null,
            se: null,
        });
    });

    it('is the paired respected indicator difference per level pair', () => {
        const level = (
            outcome: 'respected' | 'broken',
            placebo: 'respected' | 'broken'
        ) => ({
            role: 'support' as const,
            price: 98,
            outcome,
            skipReason: null,
            distanceAtr: 1,
            touchOffset: 1,
            resolveOffset: 1,
            gap: false,
            placebo: [
                {
                    shiftAtr: 0.5,
                    outcome: placebo,
                    skipReason: null,
                    touchOffset: 1,
                },
            ],
        });
        const rows = [
            makeRow({
                labels: makeLabels({
                    levels: [
                        level('respected', 'broken'),
                        level('broken', 'respected'),
                        level('respected', 'respected'),
                        level('respected', 'broken'),
                    ],
                }),
            }),
        ];
        const s = summarizeLevels(rows, 0.5);
        // pair differences: 1, -1, 0, 1
        expect(s.diffStat.n).toBe(4);
        expect(s.diffStat.mean).toBeCloseTo(0.25, 12);
        expect(s.diffStat.se).toBeCloseTo(
            Math.sqrt((0.75 ** 2 * 2 + 1.25 ** 2 + 0.25 ** 2) / 3 / 4),
            12
        );
        expect(s.diff).toBe(s.diffStat.mean);
    });

    it('is the per-pattern difference over raced patterns with a null', () => {
        const pattern = (outcome: string, rw: number | null) => ({
            name: 'p',
            candidateId: null,
            direction: 'up' as const,
            outcome,
            skipReason: null,
            alreadyBroken: false,
            breakoutOffset: null,
            resolveOffset: null,
            gap: null,
            measuredTarget: null,
            rwNullTargetFirst: rw,
        });
        const rows = [
            makeRow({
                labels: makeLabels({
                    patterns: [
                        pattern('target_first', 0.5),
                        pattern('invalidation_first', 0.5),
                        pattern('target_first', null),
                    ] as never,
                }),
            }),
        ];
        const s = summarizePatterns(rows);
        expect(s.diffStat).toMatchObject({ n: 2, mean: 0 });
        expect(s.diffStat.se).toBeCloseTo(0.5, 12);
    });
});

describe('variance run counts', () => {
    const run = (caseId: string, repeat: number) => makeRow({ caseId, repeat });

    it('counts how many cases have each number of usable runs, ascending', () => {
        const s = summarizeVariance([
            run('A|1', 1),
            run('A|1', 2),
            run('A|1', 3),
            run('B|1', 1),
            run('B|1', 2),
            run('B|1', 3),
            run('C|1', 1),
            run('C|1', 2),
            run('D|1', 1),
        ]);
        expect(s.cases).toBe(3);
        expect(s.runCounts).toEqual([
            { runs: 2, cases: 1 },
            { runs: 3, cases: 2 },
        ]);
    });

    it('does not count a run that carries no analysis', () => {
        const s = summarizeVariance([
            run('A|1', 1),
            run('A|1', 2),
            makeRow({
                caseId: 'A|1',
                repeat: 3,
                status: 'failed',
                subject: null,
                labels: null,
            }),
        ]);
        expect(s.runCounts).toEqual([{ runs: 2, cases: 1 }]);
    });
});
