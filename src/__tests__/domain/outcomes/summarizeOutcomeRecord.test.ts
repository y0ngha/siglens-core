import { describe, expect, expectTypeOf, it } from 'vitest';
import { BASE_RATE_MIN_N } from '@/domain/analysis/measuredBaseRates';
import {
    OUTCOME_LABEL_VERSION,
    PLACEBO_SHIFT_ATR,
} from '@/domain/outcomes/constants';
import {
    summarizeOutcomeRecord,
    type OutcomeRecordRow,
    type OutcomeRecordSummary,
} from '@/domain/outcomes/summarizeOutcomeRecord';
import type {
    AnalysisOutcomeLabels,
    LevelOutcome,
    LevelOutcomeEntry,
    PlanOutcome,
    PlanOutcomeLabel,
} from '@/domain/outcomes/types';

const DAY = 86_400;
/** 2024-01-01 00:00 UTC, a Monday. */
const T0 = Date.UTC(2024, 0, 1) / 1000;
const SEED = 7;

const planLabel = (over: Partial<PlanOutcomeLabel> = {}): PlanOutcomeLabel => ({
    recommendation: 'enter',
    outcome: 'target_first',
    reason: null,
    approach: 'from_above',
    entryOffset: 1,
    exitOffset: 3,
    fill: 100,
    target: 104,
    anchorBarUnobserved: false,
    exit: 104,
    gap: false,
    returnPct: 4,
    holdBars: 3,
    rwNullTargetFirst: 0.25,
    baselineSameLengthPct: 0.1,
    baselineN: 50,
    sameWindowHoldPct: 0.5,
    ...over,
});

const level = (
    outcome: LevelOutcome,
    plus: LevelOutcome,
    minus: LevelOutcome
): LevelOutcomeEntry => ({
    role: 'support',
    price: 95,
    outcome,
    skipReason: null,
    distanceAtr: 1,
    touchOffset: 2,
    resolveOffset: 3,
    gap: false,
    placebo: [
        {
            shiftAtr: PLACEBO_SHIFT_ATR,
            outcome: plus,
            skipReason: null,
            touchOffset: 2,
        },
        {
            shiftAtr: -PLACEBO_SHIFT_ATR,
            outcome: minus,
            skipReason: null,
            touchOffset: 2,
        },
    ],
});

const labels = (
    over: Partial<AnalysisOutcomeLabels> = {},
    plan: Partial<PlanOutcomeLabel> = {}
): AnalysisOutcomeLabels => ({
    v: OUTCOME_LABEL_VERSION,
    windowBars: 20,
    referencePrice: 100,
    adjFactor: 1,
    anchorForming: false,
    anchorSource: 'prompt_bar',
    atr: 2,
    forward: [],
    plan: planLabel(plan),
    levels: [],
    scenarioTargets: [],
    patterns: [],
    ...over,
});

let counter = 0;
const row = (
    over: Partial<OutcomeRecordRow> = {},
    plan: Partial<PlanOutcomeLabel> = {},
    labelOver: Partial<AnalysisOutcomeLabels> = {}
): OutcomeRecordRow => {
    counter += 1;
    return {
        symbol: `S${counter}`,
        market: 'us',
        timeframe: '1Day',
        anchorBarTime: T0 + counter * DAY,
        generatedAtMs: (T0 + counter * DAY) * 1000,
        labelVersion: OUTCOME_LABEL_VERSION,
        labels: labels(labelOver, plan),
        ...over,
    };
};

const planOf = (outcome: PlanOutcome, rw: number | null = 0.25) =>
    row({}, { outcome, rwNullTargetFirst: rw });

/**
 * 100 triggered plans on distinct symbols and days, alternating us/kr; `target_first` on
 * `i % 10 < 7`, so each of the early and late halves and each market holds 70% hits
 * (hand-counted: even `i` hit on 0,2,4,6 of 0..8, odd `i` on 1,3,5 of 1..9).
 */
function beatingSet(
    rw = 0.3,
    markets: readonly ('us' | 'kr')[] = ['us', 'kr']
) {
    return Array.from({ length: 100 }, (_, i) =>
        row(
            { market: markets[i % markets.length] },
            {
                outcome: i % 10 < 7 ? 'target_first' : 'stop_first',
                rwNullTargetFirst: rw,
            }
        )
    );
}

describe('summarizeOutcomeRecord', () => {
    describe('exclusions', () => {
        it.each([
            [
                'stale_label',
                row({ labelVersion: OUTCOME_LABEL_VERSION - 1 }),
                { stale_label: 1, generated_at: 0, anchor_unobserved: 0 },
            ],
            [
                'a NaN version is stale',
                row({ labelVersion: Number.NaN }),
                { stale_label: 1, generated_at: 0, anchor_unobserved: 0 },
            ],
            [
                'generated_at',
                row({}, {}, { anchorSource: 'generated_at' }),
                { stale_label: 0, generated_at: 1, anchor_unobserved: 0 },
            ],
            [
                'anchor_unobserved',
                row({}, { anchorBarUnobserved: true }),
                { stale_label: 0, generated_at: 0, anchor_unobserved: 1 },
            ],
            [
                'stale beats generated_at and unobserved (counted once)',
                row(
                    { labelVersion: 0 },
                    { anchorBarUnobserved: true },
                    { anchorSource: 'generated_at' }
                ),
                { stale_label: 1, generated_at: 0, anchor_unobserved: 0 },
            ],
            [
                'generated_at beats unobserved (counted once)',
                row(
                    {},
                    { anchorBarUnobserved: true },
                    { anchorSource: 'generated_at' }
                ),
                { stale_label: 0, generated_at: 1, anchor_unobserved: 0 },
            ],
            [
                'a clean row is not excluded',
                row(),
                { stale_label: 0, generated_at: 0, anchor_unobserved: 0 },
            ],
        ])('%s', (_name, input, excluded) => {
            const summary = summarizeOutcomeRecord([input], { seed: SEED });
            expect(summary.counts).toEqual({ rows: 1, deduped: 1, excluded });
        });

        it('keeps excluded rows out of the plan counts, the levels and the scope', () => {
            const kept = row({ symbol: 'KEEP' });
            const dropped = row(
                { symbol: 'DROP', market: 'kr' },
                { anchorBarUnobserved: true }
            );
            const summary = summarizeOutcomeRecord([kept, dropped], {
                seed: SEED,
            });
            expect(summary.plans.planned).toBe(1);
            expect(summary.scope.markets).toEqual([
                { market: 'us', symbols: 1 },
            ]);
        });

        it('drops non-daily rows before anything is counted but still counts them as input rows', () => {
            const summary = summarizeOutcomeRecord(
                [
                    row(),
                    row({ timeframe: '1Week' }),
                    row({ timeframe: '1Hour' }),
                ],
                { seed: SEED }
            );
            expect(summary.counts.rows).toBe(3);
            expect(summary.counts.deduped).toBe(1);
        });
    });

    describe('dedupe by (symbol, timeframe, anchor bar)', () => {
        const dup = (over: Partial<OutcomeRecordRow>, outcome: PlanOutcome) =>
            row({ symbol: 'DUP', anchorBarTime: T0, ...over }, { outcome });

        it('keeps the earliest generatedAt whatever the input order', () => {
            const early = dup({ generatedAtMs: 1000 }, 'target_first');
            const late = dup({ generatedAtMs: 2000 }, 'not_triggered');
            [
                [early, late],
                [late, early],
            ].forEach(rows => {
                const summary = summarizeOutcomeRecord(rows, { seed: SEED });
                expect(summary.counts.deduped).toBe(1);
                // the kept plan is the early one: triggered, not not_triggered
                expect(summary.plans).toMatchObject({
                    planned: 1,
                    triggered: 1,
                });
            });
        });

        it('breaks a generatedAt tie by input order', () => {
            const first = dup({ generatedAtMs: 1000 }, 'open_at_horizon');
            const second = dup({ generatedAtMs: 1000 }, 'not_triggered');
            expect(
                summarizeOutcomeRecord([first, second], { seed: SEED }).plans
            ).toMatchObject({ planned: 1, triggered: 1 });
            expect(
                summarizeOutcomeRecord([second, first], { seed: SEED }).plans
            ).toMatchObject({ planned: 1, triggered: 0 });
        });

        it('does not fall back to a later copy when the earliest one is excluded', () => {
            const early = dup({ generatedAtMs: 1000 }, 'target_first');
            early.labels.anchorSource = 'generated_at';
            const late = dup({ generatedAtMs: 2000 }, 'target_first');
            const summary = summarizeOutcomeRecord([late, early], {
                seed: SEED,
            });
            expect(summary.counts).toEqual({
                rows: 2,
                deduped: 1,
                excluded: {
                    generated_at: 1,
                    anchor_unobserved: 0,
                    stale_label: 0,
                },
            });
            expect(summary.plans.planned).toBe(0);
        });

        it.each([
            ['another symbol', { symbol: 'OTHER' }],
            ['another anchor bar', { anchorBarTime: T0 + DAY }],
        ])('does not merge rows of %s', (_name, over) => {
            const summary = summarizeOutcomeRecord(
                [dup({}, 'target_first'), dup(over, 'target_first')],
                { seed: SEED }
            );
            expect(summary.counts.deduped).toBe(2);
        });
    });

    describe('plans', () => {
        it.each<[PlanOutcome, boolean, boolean]>([
            ['no_plan', false, false],
            ['not_triggered', true, false],
            ['void_at_entry', true, false],
            ['target_first', true, true],
            ['stop_first', true, true],
            ['ambiguous', true, true],
            ['open_at_horizon', true, true],
        ])('%s: planned %s, triggered %s', (outcome, planned, triggered) => {
            const summary = summarizeOutcomeRecord([planOf(outcome)], {
                seed: SEED,
            });
            expect(summary.plans.planned).toBe(planned ? 1 : 0);
            expect(summary.plans.triggered).toBe(triggered ? 1 : 0);
        });

        it('uses the triggered set as the denominator, open_at_horizon and ambiguous included', () => {
            const rows = [
                ...Array.from({ length: 25 }, () => planOf('target_first')),
                ...Array.from({ length: 25 }, () => planOf('stop_first')),
                ...Array.from({ length: 25 }, () => planOf('ambiguous')),
                ...Array.from({ length: 25 }, () => planOf('open_at_horizon')),
                ...Array.from({ length: 10 }, () => planOf('not_triggered')),
            ];
            const { plans } = summarizeOutcomeRecord(rows, { seed: SEED });
            expect(plans.planned).toBe(110);
            expect(plans.triggered).toBe(100);
            expect(plans.n).toBe(100);
            expect(plans.eventShare).toBe(0.25);
            expect(plans.placeboShare).toBe(0.25);
        });

        it('takes a row with a null or non-finite rw out of both sides', () => {
            const rows = [
                ...Array.from({ length: 100 }, () => planOf('stop_first', 0.5)),
                // would lift the event share to 101/... if it stayed on the event side only
                planOf('target_first', null),
                planOf('target_first', Number.NaN),
                planOf('target_first', 1.5),
            ];
            const { plans } = summarizeOutcomeRecord(rows, { seed: SEED });
            expect(plans.triggered).toBe(103);
            expect(plans.n).toBe(100);
            expect(plans.eventShare).toBe(0);
            expect(plans.placeboShare).toBe(0.5);
        });

        it('has equal event and placebo denominators: the placebo mean is over the same n rows', () => {
            const rows = [
                ...Array.from({ length: 60 }, () =>
                    planOf('target_first', 0.2)
                ),
                ...Array.from({ length: 40 }, () => planOf('stop_first', 0.6)),
            ];
            const { plans } = summarizeOutcomeRecord(rows, { seed: SEED });
            expect(plans.n).toBe(100);
            expect(plans.eventShare).toBeCloseTo(0.6, 12);
            expect(plans.placeboShare).toBeCloseTo(0.36, 12);
            expect(plans.difference?.mean).toBeCloseTo(0.24, 12);
        });
    });

    describe('levels', () => {
        const levelRow = (entry: LevelOutcomeEntry) =>
            row({}, {}, { levels: [entry] });

        it.each<[string, LevelOutcomeEntry, number]>([
            [
                'respected with both placebos resolved',
                level('respected', 'respected', 'broken'),
                1,
            ],
            [
                'broken with both placebos resolved',
                level('broken', 'broken', 'broken'),
                1,
            ],
            [
                'real level untouched',
                level('untouched', 'respected', 'broken'),
                0,
            ],
            [
                'real level inconclusive',
                level('inconclusive', 'respected', 'broken'),
                0,
            ],
            [
                'real level touched_late',
                level('touched_late', 'respected', 'broken'),
                0,
            ],
            ['real level skipped', level('skipped', 'respected', 'broken'), 0],
            ['far placebo skipped', level('respected', 'skipped', 'broken'), 0],
            [
                'near placebo untouched',
                level('respected', 'respected', 'untouched'),
                0,
            ],
            [
                'a placebo missing',
                {
                    ...level('respected', 'respected', 'broken'),
                    placebo: [
                        level('respected', 'respected', 'broken').placebo[0],
                    ],
                },
                0,
            ],
            [
                'placebos of a different shift',
                {
                    ...level('respected', 'respected', 'broken'),
                    placebo: level(
                        'respected',
                        'respected',
                        'broken'
                    ).placebo.map(p => ({ ...p, shiftAtr: 1 })),
                },
                0,
            ],
        ])('%s: %d level(s) counted', (_name, entry, counted) => {
            const rows = Array.from({ length: 100 }, () => levelRow(entry));
            const { levels } = summarizeOutcomeRecord(rows, { seed: SEED });
            expect(levels.n).toBe(counted * 100);
        });

        it('compares the respected share with the mean of the two placebos (hand-counted)', () => {
            // 60 respected / 40 broken; placebo shares: 0.5 on the first 60 rows (one
            // respected, one broken), 1 on the last 40 (both respected).
            const rows = [
                ...Array.from({ length: 60 }, () =>
                    levelRow(level('respected', 'respected', 'broken'))
                ),
                ...Array.from({ length: 40 }, () =>
                    levelRow(level('broken', 'respected', 'respected'))
                ),
            ];
            const { levels } = summarizeOutcomeRecord(rows, { seed: SEED });
            expect(levels.n).toBe(100);
            expect(levels.eventShare).toBeCloseTo(0.6, 12);
            expect(levels.placeboShare).toBeCloseTo(0.7, 12);
            expect(levels.difference?.mean).toBeCloseTo(-0.1, 12);
            expect(levels.verdict).toBe('no_edge');
        });

        it('counts every level of a row as its own observation', () => {
            const many = row(
                {},
                {},
                {
                    levels: Array.from({ length: 100 }, () =>
                        level('respected', 'respected', 'broken')
                    ),
                }
            );
            expect(
                summarizeOutcomeRecord([many], { seed: SEED }).levels.n
            ).toBe(100);
        });
    });

    describe('verdict branches', () => {
        it('beats the placebo when the interval clears zero and every split holds', () => {
            const { plans } = summarizeOutcomeRecord(beatingSet(0.3), {
                seed: SEED,
            });
            expect(plans.n).toBe(100);
            expect(plans.eventShare).toBeCloseTo(0.7, 12);
            expect(plans.placeboShare).toBeCloseTo(0.3, 12);
            expect(plans.difference?.mean).toBeCloseTo(0.4, 12);
            expect(plans.difference?.low).toBeGreaterThan(0);
            expect(plans.verdict).toBe('beats_placebo');
        });

        it('never beats the placebo without a Korean row (a missing market fails closed)', () => {
            const { plans } = summarizeOutcomeRecord(beatingSet(0.3, ['us']), {
                seed: SEED,
            });
            expect(plans.difference?.low).toBeGreaterThan(0);
            expect(plans.verdict).toBe('no_edge');
        });

        it('never beats the placebo without a US row either', () => {
            const { plans } = summarizeOutcomeRecord(beatingSet(0.3, ['kr']), {
                seed: SEED,
            });
            expect(plans.verdict).toBe('no_edge');
        });

        it('is no_edge when the sign fails in one market', () => {
            // kr rows all stop_first: the kr difference is negative while us is positive
            const rows = beatingSet(0.3).map(r =>
                r.market === 'kr'
                    ? {
                          ...r,
                          labels: {
                              ...r.labels,
                              plan: {
                                  ...r.labels.plan,
                                  outcome: 'stop_first' as const,
                              },
                          },
                      }
                    : r
            );
            expect(
                summarizeOutcomeRecord(rows, { seed: SEED }).plans.verdict
            ).toBe('no_edge');
        });

        it('is no_edge when the interval includes zero', () => {
            const rows = Array.from({ length: 100 }, (_, i) =>
                planOf(i % 2 === 0 ? 'target_first' : 'stop_first', 0.5)
            );
            const { plans } = summarizeOutcomeRecord(rows, { seed: SEED });
            expect(plans.difference?.mean).toBeCloseTo(0, 12);
            expect(plans.difference?.low).toBeLessThan(0);
            expect(plans.verdict).toBe('no_edge');
        });

        it('is no_edge when every anchor falls in one time half', () => {
            const rows = beatingSet(0.3).map(r => ({
                ...r,
                anchorBarTime: T0 + 5 * DAY,
                symbol: r.symbol,
            }));
            expect(
                summarizeOutcomeRecord(rows, { seed: SEED }).plans.verdict
            ).toBe('no_edge');
        });
    });

    describe('sample floor', () => {
        it(`is insufficient_sample at n = ${BASE_RATE_MIN_N - 1} with null shares`, () => {
            const { plans } = summarizeOutcomeRecord(
                beatingSet(0.3).slice(0, BASE_RATE_MIN_N - 1),
                { seed: SEED }
            );
            expect(plans).toEqual({
                n: 99,
                eventShare: null,
                placeboShare: null,
                difference: null,
                verdict: 'insufficient_sample',
                planned: 99,
                triggered: 99,
            });
        });

        it(`reports the shares at n = ${BASE_RATE_MIN_N}`, () => {
            const { plans } = summarizeOutcomeRecord(beatingSet(0.3), {
                seed: SEED,
            });
            expect(plans.n).toBe(100);
            expect(plans.eventShare).not.toBeNull();
            expect(plans.verdict).not.toBe('insufficient_sample');
        });

        it('applies the floor to levels as well', () => {
            const rows = (count: number) =>
                Array.from({ length: count }, () =>
                    row(
                        {},
                        {},
                        {
                            levels: [level('respected', 'respected', 'broken')],
                        }
                    )
                );
            expect(
                summarizeOutcomeRecord(rows(99), { seed: SEED }).levels
            ).toEqual({
                n: 99,
                eventShare: null,
                placeboShare: null,
                difference: null,
                verdict: 'insufficient_sample',
            });
            expect(
                summarizeOutcomeRecord(rows(100), { seed: SEED }).levels
                    .eventShare
            ).toBe(1);
        });

        it('turns an empty input into an insufficient record', () => {
            expect(summarizeOutcomeRecord([], { seed: SEED })).toEqual({
                v: 1,
                labelVersion: OUTCOME_LABEL_VERSION,
                scope: { timeframe: '1Day', markets: [], from: '', to: '' },
                counts: {
                    rows: 0,
                    deduped: 0,
                    excluded: {
                        generated_at: 0,
                        anchor_unobserved: 0,
                        stale_label: 0,
                    },
                },
                plans: {
                    n: 0,
                    eventShare: null,
                    placeboShare: null,
                    difference: null,
                    verdict: 'insufficient_sample',
                    planned: 0,
                    triggered: 0,
                },
                levels: {
                    n: 0,
                    eventShare: null,
                    placeboShare: null,
                    difference: null,
                    verdict: 'insufficient_sample',
                },
            });
        });
    });

    describe('interval', () => {
        it('collapses to the point when every observation has the same difference', () => {
            // event 1 against rw 0.25 on every row: 0.75 whatever the weeks drawn
            const rows = Array.from({ length: 100 }, () =>
                planOf('target_first', 0.25)
            );
            const { plans } = summarizeOutcomeRecord(rows, { seed: SEED });
            expect(plans.difference?.mean).toBeCloseTo(0.75, 12);
            expect(plans.difference?.low).toBeCloseTo(0.75, 12);
            expect(plans.difference?.high).toBeCloseTo(0.75, 12);
        });

        it('is deterministic for a seed and input order, and moves with the seed', () => {
            const rows = beatingSet(0.3);
            const a = summarizeOutcomeRecord(rows, { seed: 1 });
            expect(summarizeOutcomeRecord(rows, { seed: 1 })).toEqual(a);
            expect(
                JSON.stringify(summarizeOutcomeRecord(rows, { seed: 1 }))
            ).toBe(JSON.stringify(a));
            const b = summarizeOutcomeRecord(rows, { seed: 2 });
            expect(b.plans.difference).not.toEqual(a.plans.difference);
            expect(b.plans.difference?.mean).toBe(a.plans.difference?.mean);
        });

        it('draws the plan and level intervals from different streams', () => {
            // Plans and levels carry the same difference per row (hit against 0.5), so only
            // the resampling stream can make their intervals differ.
            const rows = Array.from({ length: 100 }, (_, i) =>
                row(
                    { anchorBarTime: T0 + i * 7 * DAY },
                    {
                        outcome: i % 3 === 0 ? 'target_first' : 'stop_first',
                        rwNullTargetFirst: 0.5,
                    },
                    {
                        levels: [
                            i % 3 === 0
                                ? level('respected', 'respected', 'broken')
                                : level('broken', 'respected', 'broken'),
                        ],
                    }
                )
            );
            const { plans, levels } = summarizeOutcomeRecord(rows, {
                seed: SEED,
            });
            expect(levels.difference?.mean).toBe(plans.difference?.mean);
            expect(levels.difference?.low).not.toBe(plans.difference?.low);
            expect(levels.difference?.high).not.toBe(plans.difference?.high);
        });

        it('does not depend on the input order of distinct rows', () => {
            const rows = beatingSet(0.3);
            expect(
                summarizeOutcomeRecord(rows.toReversed(), { seed: SEED }).plans
            ).toEqual(summarizeOutcomeRecord(rows, { seed: SEED }).plans);
        });

        it('keeps low <= mean <= high on a mixed set', () => {
            const { difference } = summarizeOutcomeRecord(beatingSet(0.3), {
                seed: SEED,
            }).plans;
            expect(difference).not.toBeNull();
            expect(difference!.low).toBeLessThanOrEqual(difference!.mean);
            expect(difference!.mean).toBeLessThanOrEqual(difference!.high);
        });

        it('clusters by anchor week: rows of one week resample as one cluster, so the interval collapses', () => {
            // 100 rows in 100 distinct weeks vs the same 100 rows within one week
            const spread = beatingSet(0.3);
            const clustered = spread.map(r => ({
                ...r,
                anchorBarTime: T0,
            }));
            // distinct symbols keep the rows apart from the dedupe
            const oneWeek = summarizeOutcomeRecord(clustered, { seed: SEED })
                .plans.difference!;
            expect(oneWeek.low).toBeCloseTo(oneWeek.mean, 12);
            expect(oneWeek.high).toBeCloseTo(oneWeek.mean, 12);
            const narrow = summarizeOutcomeRecord(
                spread.map((r, i) => ({
                    ...r,
                    anchorBarTime: T0 + i * 7 * DAY,
                })),
                { seed: SEED }
            ).plans.difference!;
            expect(narrow.high - narrow.low).toBeGreaterThan(0);
        });
    });

    describe('scope', () => {
        it('lists distinct symbols per market with the first and last anchor date', () => {
            const rows = [
                row({ symbol: 'A', market: 'us', anchorBarTime: T0 }),
                row({ symbol: 'A', market: 'us', anchorBarTime: T0 + DAY }),
                row({ symbol: 'B', market: 'us', anchorBarTime: T0 + 2 * DAY }),
                row({
                    symbol: '005930',
                    market: 'kr',
                    anchorBarTime: T0 + 9 * DAY,
                }),
            ];
            expect(summarizeOutcomeRecord(rows, { seed: SEED }).scope).toEqual({
                timeframe: '1Day',
                markets: [
                    { market: 'us', symbols: 2 },
                    { market: 'kr', symbols: 1 },
                ],
                from: '2024-01-01',
                to: '2024-01-10',
            });
        });
    });

    describe('excluded rows and scope', () => {
        it('takes the scope dates and markets from retained rows only', () => {
            const rows = [
                row({ symbol: 'A', anchorBarTime: T0 + 5 * DAY }),
                row({ symbol: 'B', anchorBarTime: T0 + 8 * DAY }),
                row(
                    { symbol: 'EARLY', market: 'kr', anchorBarTime: T0 },
                    { anchorBarUnobserved: true }
                ),
                row(
                    { symbol: 'LATE', anchorBarTime: T0 + 40 * DAY },
                    {},
                    { anchorSource: 'generated_at' }
                ),
            ];
            expect(summarizeOutcomeRecord(rows, { seed: SEED }).scope).toEqual({
                timeframe: '1Day',
                markets: [{ market: 'us', symbols: 2 }],
                from: '2024-01-06',
                to: '2024-01-09',
            });
        });
    });

    describe('anchor weeks are Monday-based (UTC)', () => {
        const SUN_END = T0 - 1; // Sunday 2023-12-31 23:59:59
        /** 50 hits at `hitTime`, 50 misses at `missTime`, all against rw 0.5. */
        const twoClusters = (hitTime: number, missTime: number) =>
            summarizeOutcomeRecord(
                Array.from({ length: 100 }, (_, i) =>
                    row(
                        { anchorBarTime: i < 50 ? hitTime : missTime },
                        {
                            outcome: i < 50 ? 'target_first' : 'stop_first',
                            rwNullTargetFirst: 0.5,
                        }
                    )
                ),
                { seed: SEED }
            ).plans.difference!;

        it('puts Sunday 23:59:59 and Monday 00:00 in different weeks', () => {
            const { low, high } = twoClusters(SUN_END, T0);
            expect(high - low).toBeGreaterThan(0);
        });

        it('keeps Monday 00:00 through Sunday 23:59:59 in one week', () => {
            const { mean, low, high } = twoClusters(T0, T0 + 7 * DAY - 1);
            expect(low).toBeCloseTo(mean, 12);
            expect(high).toBeCloseTo(mean, 12);
        });
    });

    describe('large inputs', () => {
        it('summarises 200,000 rows without a call-stack overflow in the scope and split extents', () => {
            const rows = Array.from({ length: 200_000 }, (_, i) =>
                row(
                    { anchorBarTime: T0 + i * DAY },
                    { outcome: 'stop_first', rwNullTargetFirst: 0.5 }
                )
            );
            const summary = summarizeOutcomeRecord(rows, { seed: SEED });
            expect(summary.plans.n).toBe(200_000);
            expect(summary.counts.deduped).toBe(200_000);
            expect(summary.scope.from).toBe('2024-01-01');
            expect(summary.scope.to).toBe(
                new Date((T0 + 199_999 * DAY) * 1000).toISOString().slice(0, 10)
            );
        }, 60_000);
    });

    describe('fail closed', () => {
        it.each([
            ['seed', { seed: Number.NaN }, [row()]],
            [
                'anchorBarTime',
                { seed: SEED },
                [row({ anchorBarTime: Number.NaN })],
            ],
            [
                'generatedAtMs',
                { seed: SEED },
                [row({ generatedAtMs: Number.POSITIVE_INFINITY })],
            ],
        ])('throws on a non-finite %s', (_name, opts, rows) => {
            expect(() => summarizeOutcomeRecord(rows, opts)).toThrow(
                RangeError
            );
        });
    });

    describe('no return figure', () => {
        type Keys =
            | keyof OutcomeRecordSummary
            | keyof OutcomeRecordSummary['scope']
            | keyof OutcomeRecordSummary['counts']
            | keyof OutcomeRecordSummary['plans']
            | keyof OutcomeRecordSummary['levels'];
        type ReturnLike = Extract<
            Lowercase<Keys & string>,
            `${string}${'return' | 'pnl' | 'profit' | 'price' | 'pct'}${string}`
        >;

        it('has no return, profit or price field in the type', () => {
            expectTypeOf<ReturnLike>().toEqualTypeOf<never>();
        });

        it('has none at runtime either, at any depth', () => {
            const collect = (value: unknown): string[] =>
                typeof value === 'object' && value !== null
                    ? Object.entries(value).flatMap(([key, v]) => [
                          key,
                          ...collect(v),
                      ])
                    : [];
            const keys = collect(
                summarizeOutcomeRecord(beatingSet(0.3), { seed: SEED })
            );
            expect(
                keys.filter(k => /return|pnl|profit|price|pct/i.test(k))
            ).toEqual([]);
        });
    });
});
