import { describe, expect, it } from 'vitest';
import { labelPlanOutcome } from '@/domain/outcomes/labelPlanOutcome';
import type { OutcomeSubject, PlanOutcomeLabel } from '@/domain/outcomes/types';
import {
    flat,
    makeWindow,
    type Ohlc,
    type WindowSpec,
} from '../../helpers/outcomeWindows';

type Plan = NonNullable<OutcomeSubject['plan']>;

/** Zone [97, 99], stop 95, targets 105 and 110; the reference price is 100 (above the zone). */
const PLAN: Plan = {
    recommendation: 'enter',
    entryLow: 97,
    entryHigh: 99,
    stop: 95,
    targets: [105, 110],
    reconciled: false,
};

function label(
    forward: readonly Ohlc[],
    plan: Partial<Plan> = {},
    window: Omit<WindowSpec, 'forward'> = {}
): PlanOutcomeLabel {
    return labelPlanOutcome(
        { ...PLAN, ...plan },
        makeWindow({ ...window, forward })
    );
}

/** From above: touches the zone at the high edge (fill 99) and reaches neither level. */
const ENTRY_FOR_LONG: Ohlc = [100, 100, 98, 99];

const NOT_EVALUATED = {
    target: null,
    anchorBarUnobserved: false,
    approach: null,
    entryOffset: null,
    exitOffset: null,
    fill: null,
    exit: null,
    gap: null,
    returnPct: null,
    holdBars: null,
    rwNullTargetFirst: null,
    baselineSameLengthPct: null,
    baselineN: null,
    sameWindowHoldPct: null,
};

describe('labelPlanOutcome — no_plan', () => {
    it.each<[string, Plan | null, string]>([
        ['no plan at all', null, 'none'],
        ['an avoid verdict', { ...PLAN, recommendation: 'avoid' }, 'avoid'],
        ['no zone', { ...PLAN, entryLow: null, entryHigh: null }, 'no_entry'],
        [
            'no stop (missing or rejected by core)',
            { ...PLAN, stop: null },
            'no_stop',
        ],
        ['no target', { ...PLAN, targets: [] }, 'no_target'],
        ['a stop at the zone low', { ...PLAN, stop: 97 }, 'stop_inside_zone'],
        ['a stop inside the zone', { ...PLAN, stop: 98 }, 'stop_inside_zone'],
        ['a stop above the zone', { ...PLAN, stop: 120 }, 'stop_inside_zone'],
    ])('%s', (_name, plan, reason) => {
        expect(labelPlanOutcome(plan, makeWindow())).toEqual({
            ...NOT_EVALUATED,
            recommendation: plan?.recommendation ?? null,
            outcome: 'no_plan',
            reason,
        });
    });

    it('evaluates a stop one cent under the zone low', () => {
        expect(label([], { stop: 96.99 }).outcome).not.toBe('no_plan');
    });

    it('checks the rules in order: avoid before everything, no zone before no stop, no stop before no target', () => {
        const everythingWrong = {
            recommendation: 'avoid' as const,
            entryLow: null,
            entryHigh: null,
            stop: null,
            targets: [],
        };
        expect(label([], everythingWrong).reason).toBe('avoid');
        expect(
            label([], { ...everythingWrong, recommendation: 'wait' }).reason
        ).toBe('no_entry');
        expect(
            label([], {
                ...everythingWrong,
                recommendation: 'wait',
                entryLow: 97,
                entryHigh: 99,
            }).reason
        ).toBe('no_stop');
        expect(
            label([], {
                ...everythingWrong,
                recommendation: 'wait',
                entryLow: 97,
                entryHigh: 99,
                stop: 98,
            }).reason
        ).toBe('no_target');
    });

    it.each(['wait', null] as const)(
        'evaluates a %s verdict like an enter',
        recommendation => {
            const bars: Ohlc[] = [
                [100, 100, 98, 99],
                [100, 106, 99.5, 105],
            ];
            expect(label(bars, { recommendation })).toEqual({
                ...label(bars),
                recommendation,
            });
        }
    );
});

describe('labelPlanOutcome — approach (a stratification label only)', () => {
    it.each([
        ['above the zone', 100, 'from_above'],
        ['just above the zone high', 99.01, 'from_above'],
        ['at the zone high', 99, 'inside'],
        ['in the zone', 98, 'inside'],
        ['at the zone low', 97, 'inside'],
        ['just under the zone low', 96.99, 'from_below'],
        ['under the zone', 96, 'from_below'],
    ])('reference price %s is %s', (_name, referencePrice, approach) => {
        const window = makeWindow({ referencePrice, pad: referencePrice });
        expect(labelPlanOutcome(PLAN, window).approach).toBe(approach);
    });

    it('does not decide the fill: a bar is judged by where it opens', () => {
        // Reference price above the zone, but the first bar opens inside it.
        expect(label([[98, 98.5, 97.5, 98]])).toMatchObject({
            approach: 'from_above',
            entryOffset: 1,
            fill: 98,
        });
    });
});

describe('labelPlanOutcome — entry (fills only inside the zone)', () => {
    it('does not trigger while every bar opens above the zone and its low stays above the zone high', () => {
        expect(label([[100, 101, 99.01, 100]])).toMatchObject({
            outcome: 'not_triggered',
            approach: 'from_above',
            entryOffset: null,
            fill: null,
            reason: null,
        });
    });

    it('fills at the zone high on a bar that opens above and reaches it', () => {
        expect(label([[100, 101, 99, 100]])).toMatchObject({
            outcome: 'open_at_horizon',
            entryOffset: 1,
            fill: 99,
        });
    });

    it('does not trigger while every bar opens below the zone and its high stays under the zone low', () => {
        const window = { referencePrice: 96, pad: 96 };
        expect(label([[96, 96.99, 96, 96]], {}, window)).toMatchObject({
            outcome: 'not_triggered',
            approach: 'from_below',
        });
    });

    it('fills at the zone low on a bar that opens below (above the stop) and reaches it', () => {
        expect(
            label([[96, 97, 96, 96]], {}, { referencePrice: 96, pad: 96 })
        ).toMatchObject({ entryOffset: 1, fill: 97 });
    });

    it('enters at the first bar that reaches the zone, not the first bar', () => {
        const bars: Ohlc[] = [flat(100), flat(100), [100, 100, 98, 99]];
        expect(label(bars)).toMatchObject({ entryOffset: 3, fill: 99 });
    });

    it.each([
        ['at the zone high', 99],
        ['inside the zone', 98],
        ['at the zone low', 97],
    ])('fills at the open of a bar that opens %s', (_name, open) => {
        expect(label([[open, open + 0.5, open - 0.5, open]])).toMatchObject({
            entryOffset: 1,
            fill: open,
        });
    });

    it('never records a fill outside the zone: a bar that opens above it and does not come back is no fill', () => {
        // Zone 100-102, reference price inside it, bar 1 gaps up to 104 and stays there.
        const plan = {
            entryLow: 100,
            entryHigh: 102,
            stop: 97,
            targets: [110],
        };
        const result = label([[104, 111, 103.5, 108]], plan, {
            referencePrice: 101,
            pad: 104,
        });
        expect(result).toMatchObject({
            outcome: 'not_triggered',
            approach: 'inside',
            fill: null,
            entryOffset: null,
        });
    });

    it('fills at the zone high when a gapped-up price later comes back to it', () => {
        const plan = {
            entryLow: 100,
            entryHigh: 102,
            stop: 97,
            targets: [110],
        };
        expect(
            label(
                [
                    [104, 105, 103.5, 104],
                    [103, 103, 101.5, 102.5],
                ],
                plan,
                { referencePrice: 101, pad: 104 }
            )
        ).toMatchObject({ entryOffset: 2, fill: 102 });
    });

    it('an empty window never triggers', () => {
        const window = makeWindow({ referencePrice: 98 });
        expect(
            labelPlanOutcome(PLAN, { ...window, forward: [] })
        ).toMatchObject({
            outcome: 'not_triggered',
            approach: 'inside',
        });
    });
});

describe('labelPlanOutcome — void at entry', () => {
    it.each([
        ['an open below the stop', [94, 96, 93, 95]],
        ['an open exactly at the stop', [95, 96, 94, 95]],
    ] as const)('%s on a bar below the zone voids the plan', (_name, bar) => {
        expect(label([bar])).toMatchObject({
            outcome: 'void_at_entry',
            reason: 'gap_below_stop',
            entryOffset: 1,
            fill: null,
            exitOffset: null,
            exit: null,
            returnPct: null,
            holdBars: null,
            rwNullTargetFirst: null,
        });
    });

    it('voids on the first bar that opens at or under the stop, reporting its offset', () => {
        expect(label([flat(100), [94, 96, 93, 95]])).toMatchObject({
            outcome: 'void_at_entry',
            entryOffset: 2,
        });
    });

    it('voids an open one cent above the stop as gap_below_zone: the gap still jumped the zone', () => {
        expect(label([[95.01, 96, 94, 95]])).toMatchObject({
            outcome: 'void_at_entry',
            reason: 'gap_below_zone',
            fill: null,
        });
    });

    it('does not void a gap under the stop after the fill: that is a stop gap', () => {
        expect(
            label([
                [100, 100, 98, 99],
                [93, 94, 92, 93],
            ])
        ).toMatchObject({ outcome: 'stop_first', gap: true, exit: 93 });
    });

    describe('the gap that skips the zone and the stop (zone 100-102, stop 97, target 110)', () => {
        const plan = {
            entryLow: 100,
            entryHigh: 102,
            stop: 97,
            targets: [110],
        };
        const run = (
            forward: readonly Ohlc[],
            referencePrice: number,
            pad = 98
        ) => label(forward, plan, { referencePrice, pad });

        it('holds the original probe end to end: fill at the zone low on bar 1, stopped on its close', () => {
            // C0 95 is under the stop: a normal breakout plan, not a void.
            expect(
                run(
                    [
                        [96, 101, 95, 96.5],
                        [98, 111, 97.5, 108],
                    ],
                    95
                )
            ).toMatchObject({
                outcome: 'stop_first',
                approach: 'from_below',
                entryOffset: 1,
                fill: 100,
                exitOffset: 1,
                exit: 97,
                gap: false,
            });
        });

        it.each([
            ['above the zone', 105],
            ['inside the zone', 101],
            ['exactly at the zone low', 100],
        ])(
            'voids a bar that opens at the stop when the reference price was %s',
            (_name, referencePrice) => {
                expect(
                    run([[96, 101, 95, 96.5]], referencePrice)
                ).toMatchObject({
                    outcome: 'void_at_entry',
                    reason: 'gap_below_stop',
                    entryOffset: 1,
                    fill: null,
                });
            }
        );

        it('does not void when the reference price is one cent under the zone low', () => {
            expect(run([[96, 101, 95, 96.5]], 99.99).outcome).not.toBe(
                'void_at_entry'
            );
        });

        it('does not void a plan whose reference price is under the stop and never reaches the zone', () => {
            expect(run([[90, 96, 90, 95]], 90, 90)).toMatchObject({
                outcome: 'not_triggered',
                fill: null,
            });
        });

        it('does not void when the reference price sat between the stop and the zone; the entry bar is ambiguous', () => {
            // C0 98; bar 1 stays under the zone; bar 2 opens under the stop but the close
            // before it was 96, under the zone low, so nothing was skipped. It fills at the
            // zone low; the low through the stop (95.5) may have come after the fill, and
            // the high stays under the target: ambiguous, never assumed harmless.
            expect(
                run(
                    [
                        [98, 99, 95, 96],
                        [96, 101, 95.5, 100.5],
                    ],
                    98,
                    100
                )
            ).toMatchObject({
                outcome: 'ambiguous',
                entryOffset: 2,
                exitOffset: 2,
                fill: 100,
            });
        });

        it('reads the previous forward bar close, not the reference price, after bar 1', () => {
            // C0 98 is under the zone, but bar 1 gapped above it without touching it and
            // closed at 104: bar 2 opening under the zone jumps it from above.
            expect(
                run(
                    [
                        [104, 105, 103, 104],
                        [96, 101, 95.5, 100.5],
                    ],
                    98,
                    100
                )
            ).toMatchObject({
                outcome: 'void_at_entry',
                reason: 'gap_below_stop',
                entryOffset: 2,
            });
        });

        it.each([
            ['an open exactly at the stop', 97, 'gap_below_stop'],
            ['an open one cent above the stop', 97.01, 'gap_below_zone'],
        ])('%s, after a close above the zone low', (_name, open, reason) => {
            expect(run([[open, 101, 95.5, 100.5]], 105, 100)).toMatchObject({
                outcome: 'void_at_entry',
                reason,
                fill: null,
            });
        });

        it.each<[string, Ohlc]>([
            ['bar O98 H99 L90 C91', [98, 99, 90, 91]],
            [
                'bar O98 H103 L97 C102 (which reaches the zone again)',
                [98, 103, 97, 102],
            ],
        ])(
            'voids a gap through the zone only: previous close 104, %s',
            (_name, bar) => {
                // zone 100-102, stop 95: the open of 98 is under the zone and above the stop.
                expect(
                    label(
                        [bar],
                        { ...plan, stop: 95 },
                        { referencePrice: 104, pad: 104 }
                    )
                ).toMatchObject({
                    outcome: 'void_at_entry',
                    reason: 'gap_below_zone',
                    entryOffset: 1,
                    fill: null,
                    target: null,
                });
            }
        );

        it('uses the anchor bar final close, not the reference price, for the first bar', () => {
            // A forming anchor: the analysis saw 98, the bar finished at 104.
            expect(
                label([[96, 101, 95.5, 100.5]], plan, {
                    referencePrice: 98,
                    anchorForming: true,
                    anchorBar: [98, 105, 97.5, 104],
                    pad: 100,
                })
            ).toMatchObject({
                outcome: 'void_at_entry',
                reason: 'gap_below_stop',
            });
            expect(
                label([[96, 101, 95.5, 100.5]], plan, {
                    referencePrice: 104,
                    anchorForming: true,
                    anchorBar: [98, 99, 97.5, 98],
                    pad: 100,
                }).outcome
            ).not.toBe('void_at_entry');
        });
    });

    it.each([
        ['every target at or under the fill (fill 99, target 99)', [99], 99],
        ['a target under the fill', [98], 99],
    ])('leaves no target above the fill: %s', (_name, targets, open) => {
        expect(
            label([[open, open + 0.5, open - 0.5, open]], { targets })
        ).toMatchObject({
            outcome: 'void_at_entry',
            reason: 'no_target_above_fill',
            entryOffset: 1,
            fill: open,
        });
    });

    it('keeps a target one cent above the fill', () => {
        const result = label([[98, 98.5, 97.5, 98]], { targets: [98.01] });
        expect(result.outcome).not.toBe('void_at_entry');
        expect(result.rwNullTargetFirst).toBeCloseTo(
            (98 - 95) / (98.01 - 95),
            12
        );
    });

    it('measures against the first target above the fill, not the first target', () => {
        const result = label([[98, 98.5, 97.5, 98]], { targets: [98.5, 105] });
        expect(result.rwNullTargetFirst).toBeCloseTo(
            (98 - 95) / (98.5 - 95),
            12
        );
        const higher = label([[99, 99.5, 98.5, 99]], { targets: [98.5, 105] });
        expect(higher.rwNullTargetFirst).toBeCloseTo(
            (99 - 95) / (105 - 95),
            12
        );
    });
});

describe('labelPlanOutcome — the entry bar when the fill is not at its open', () => {
    // From above: the bar opens over the zone and falls to its high edge (fill 99). The
    // bar's high may predate the fill, so a target counts only from the close.
    describe('from above (the low cannot predate the fill)', () => {
        it('does not count a high through the target that closes under it', () => {
            expect(label([[100, 106, 98, 101]])).toMatchObject({
                outcome: 'open_at_horizon',
                entryOffset: 1,
                fill: 99,
            });
        });

        it.each([
            ['a close exactly at the target', 105, 'target_first'],
            ['a close just under the target', 104.99, 'open_at_horizon'],
        ])('%s', (_name, close, outcome) => {
            expect(label([[100, 106, 98, close]]).outcome).toBe(outcome);
        });

        it('exits at the target level, not the close', () => {
            expect(
                label([[100, 110, 98, 108]], { targets: [107] })
            ).toMatchObject({
                outcome: 'target_first',
                exit: 107,
                exitOffset: 1,
                gap: false,
            });
        });

        it('counts a low through the stop alone', () => {
            expect(label([[100, 101, 94, 98]])).toMatchObject({
                outcome: 'stop_first',
                exitOffset: 1,
                exit: 95,
                gap: false,
            });
        });

        it('is ambiguous when the bar reaches the stop and its high reaches the target', () => {
            expect(label([[100, 106, 94, 101]])).toMatchObject({
                outcome: 'ambiguous',
                exitOffset: 1,
                exit: null,
            });
        });

        it('resolves a target close on the entry bar (zone 100-102, stop 97, target 110)', () => {
            const plan = {
                entryLow: 100,
                entryHigh: 102,
                stop: 97,
                targets: [110],
            };
            expect(
                label([[104, 111, 101, 110]], plan, {
                    referencePrice: 105,
                    pad: 105,
                })
            ).toMatchObject({ outcome: 'target_first', fill: 102, exit: 110 });
        });
    });

    // From below: the bar opens under the zone and rises to its low edge (fill 97). The
    // bar's low may predate the fill, so a stop counts only from the close.
    describe('from below (the high cannot predate the fill)', () => {
        const window = { referencePrice: 96, pad: 100 };

        it('is ambiguous on a low through the stop with a close over it: the low may follow the fill', () => {
            expect(label([[96, 98, 94, 97]], {}, window)).toMatchObject({
                outcome: 'ambiguous',
                entryOffset: 1,
                exitOffset: 1,
                fill: 97,
                exit: null,
            });
        });

        it('does not turn a later bar into a win after such an entry bar (zone 100-102, stop 95, target 110)', () => {
            const plan = {
                entryLow: 100,
                entryHigh: 102,
                stop: 95,
                targets: [110],
            };
            expect(
                label(
                    [
                        [98, 101, 94, 100],
                        [100, 111, 99, 108],
                    ],
                    plan,
                    { referencePrice: 98, pad: 100 }
                )
            ).toMatchObject({
                outcome: 'ambiguous',
                entryOffset: 1,
                exitOffset: 1,
            });
        });

        it.each([
            ['a close exactly at the stop', 95, 'stop_first'],
            ['a close just over the stop', 95.01, 'ambiguous'],
        ])('%s', (_name, close, outcome) => {
            expect(label([[96, 98, 94, close]], {}, window).outcome).toBe(
                outcome
            );
        });

        it('exits at the stop level, not the close', () => {
            expect(label([[96, 98, 94, 94.5]], {}, window)).toMatchObject({
                outcome: 'stop_first',
                exit: 95,
                exitOffset: 1,
                gap: false,
            });
        });

        it('counts a high through the target alone', () => {
            expect(label([[96, 106, 95.5, 100]], {}, window)).toMatchObject({
                outcome: 'target_first',
                exitOffset: 1,
                exit: 105,
                rwNullTargetFirst: expect.closeTo(0.2, 12),
            });
        });

        it('is ambiguous when the bar reaches the target and its low reaches the stop', () => {
            expect(label([[96, 106, 94, 100]], {}, window)).toMatchObject({
                outcome: 'ambiguous',
                exitOffset: 1,
                exit: null,
            });
        });

        it('resolves a stop close on the entry bar (zone 100-102, stop 97, target 110)', () => {
            const plan = {
                entryLow: 100,
                entryHigh: 102,
                stop: 97,
                targets: [110],
            };
            expect(
                label([[98, 101, 96, 96.5]], plan, {
                    referencePrice: 95,
                    pad: 98,
                })
            ).toMatchObject({
                outcome: 'stop_first',
                fill: 100,
                exit: 97,
                exitOffset: 1,
            });
        });
    });

    it('treats an entry bar that opens inside the zone as a whole bar', () => {
        expect(label([[98, 106, 94, 100]])).toMatchObject({
            outcome: 'ambiguous',
            entryOffset: 1,
            exitOffset: 1,
        });
        expect(label([[98, 106, 97.5, 105]])).toMatchObject({
            outcome: 'target_first',
            fill: 98,
            exit: 105,
            exitOffset: 1,
            rwNullTargetFirst: expect.closeTo(0.3, 12),
        });
    });
});

describe('labelPlanOutcome — recommendation', () => {
    it.each(['enter', 'wait', 'avoid', null] as const)(
        'is carried on the label for a %s verdict',
        recommendation => {
            expect(
                label([[98, 106, 97.5, 105]], { recommendation }).recommendation
            ).toBe(recommendation);
        }
    );

    it('is null for a missing plan', () => {
        expect(labelPlanOutcome(null, makeWindow()).recommendation).toBeNull();
    });
});

describe('labelPlanOutcome — scan after the fill', () => {
    const ENTRY: Ohlc = [100, 100, 98, 99]; // from above, fill 99, nothing reached

    it.each<[string, Ohlc, Partial<PlanOutcomeLabel>]>([
        [
            'a range just short of both levels',
            [100, 104.99, 95.01, 100],
            { outcome: 'open_at_horizon' },
        ],
        [
            'a low exactly at the stop',
            [100, 100, 95, 100],
            { outcome: 'stop_first', exit: 95, gap: false },
        ],
        [
            'a high exactly at the target',
            [100, 105, 99.5, 100],
            { outcome: 'target_first', exit: 105, gap: false },
        ],
        [
            'a low through the stop',
            [100, 100, 90, 92],
            { outcome: 'stop_first', exit: 95, gap: false },
        ],
        [
            'a high through the target',
            [100, 120, 99.5, 119],
            { outcome: 'target_first', exit: 105, gap: false },
        ],
        [
            'an open exactly at the stop (a gap)',
            [95, 96, 94.5, 95],
            { outcome: 'stop_first', exit: 95, gap: true },
        ],
        [
            'an open below the stop (a gap)',
            [93, 94, 92, 93],
            { outcome: 'stop_first', exit: 93, gap: true },
        ],
        [
            'an open exactly at the target (a gap)',
            [105, 106, 104, 105],
            { outcome: 'target_first', exit: 105, gap: true },
        ],
        [
            'an open above the target (a gap)',
            [106, 107, 105, 106],
            { outcome: 'target_first', exit: 106, gap: true },
        ],
        [
            'an open through the stop with a high through the target',
            [95, 106, 94, 100],
            { outcome: 'stop_first', exit: 95, gap: true },
        ],
        [
            'both levels inside the bar',
            [100, 106, 94, 100],
            { outcome: 'ambiguous', exit: null, returnPct: null, gap: false },
        ],
        [
            'both levels exactly touched',
            [100, 105, 95, 100],
            { outcome: 'ambiguous', exit: null, gap: false },
        ],
    ])('bar 2 with %s', (_name, bar, expected) => {
        expect(label([ENTRY, bar])).toMatchObject({
            entryOffset: 1,
            fill: 99,
            ...(expected.outcome === 'open_at_horizon'
                ? {}
                : { exitOffset: 2, holdBars: 2 }),
            ...expected,
        });
    });

    it('returns the exit against the fill for a stop, a target and a gap', () => {
        expect(label([ENTRY, [93, 94, 92, 93]]).returnPct).toBeCloseTo(
            (93 / 99 - 1) * 100,
            12
        );
        expect(label([ENTRY, [100, 105.5, 99.5, 100]]).returnPct).toBeCloseTo(
            (105 / 99 - 1) * 100,
            12
        );
        expect(label([ENTRY, [106, 107, 105, 106]]).returnPct).toBeCloseTo(
            (106 / 99 - 1) * 100,
            12
        );
    });

    it('reports the probability a driftless walk reaches the target first', () => {
        expect(
            label([ENTRY, [100, 105.5, 99.5, 100]]).rwNullTargetFirst
        ).toBeCloseTo(0.4, 12);
    });

    it('stays open to the last bar and marks the last close', () => {
        const result = label([
            ENTRY,
            ...Array.from({ length: 18 }, () => flat(100)),
            [100, 100, 100, 101],
        ]);
        expect(result).toMatchObject({
            outcome: 'open_at_horizon',
            exitOffset: 20,
            exit: 101,
            gap: false,
            holdBars: 20,
        });
        expect(result.returnPct).toBeCloseTo((101 / 99 - 1) * 100, 12);
    });

    it('resolves on the last bar of the window', () => {
        const bars: Ohlc[] = [
            ENTRY,
            ...Array.from({ length: 18 }, () => flat(100)),
            [100, 106, 99.5, 100],
        ];
        expect(label(bars)).toMatchObject({
            outcome: 'target_first',
            exitOffset: 20,
            holdBars: 20,
        });
    });

    it('enters on the last bar and holds one bar', () => {
        const bars: Ohlc[] = [
            ...Array.from({ length: 19 }, () => flat(100)),
            [100, 100, 98.5, 99],
        ];
        expect(label(bars)).toMatchObject({
            outcome: 'open_at_horizon',
            entryOffset: 20,
            exitOffset: 20,
            holdBars: 1,
            exit: 99,
        });
    });
});

describe('labelPlanOutcome — same-length baseline and same-window hold', () => {
    it('measures the hold from the close before the entry bar to the exit bar close', () => {
        const result = label([[100, 106, 94, 101]]);
        expect(result.sameWindowHoldPct).toBeCloseTo(1, 12);
        expect(result.holdBars).toBe(1);
    });

    it('averages the symbol one-bar returns for a one-bar hold', () => {
        // closes: 60 x 100, then 101, then 19 x 100 -> one +1% start and one -0.990099% start.
        const result = label([[100, 106, 94, 101]]);
        expect(result.baselineN).toBe(79);
        expect(result.baselineSameLengthPct).toBeCloseTo(
            (1 + (100 / 101 - 1) * 100) / 79,
            12
        );
    });

    it('matches a constant-growth series exactly: return, hold and baseline agree', () => {
        const ref = 98;
        const growth = 1.01;
        const preCloses = Array.from(
            { length: 60 },
            (_, i) => ref / growth ** (59 - i)
        );
        const forward: Ohlc[] = Array.from({ length: 20 }, (_, i) => {
            const open = ref * growth ** i;
            const close = ref * growth ** (i + 1);
            return [open, close + 0.01, open - 0.01, close];
        });
        const result = labelPlanOutcome(
            { ...PLAN, stop: 90, targets: [200] },
            makeWindow({ referencePrice: ref, preCloses, forward })
        );
        const expected = (growth ** 20 - 1) * 100;
        expect(result).toMatchObject({
            outcome: 'open_at_horizon',
            approach: 'inside',
            holdBars: 20,
            baselineN: 60,
        });
        expect(result.returnPct).toBeCloseTo(expected, 9);
        expect(result.sameWindowHoldPct).toBeCloseTo(expected, 9);
        expect(result.baselineSameLengthPct).toBeCloseTo(expected, 9);
    });

    it('is null when no window is evaluated', () => {
        expect(label([[100, 101, 99.5, 100]])).toMatchObject({
            baselineSameLengthPct: null,
            baselineN: null,
            sameWindowHoldPct: null,
        });
    });

    it('withholds the baseline below the minimum sample count but reports its size', () => {
        const result = label(
            [[100, 106, 94, 101]],
            {},
            { preCloses: [100, 100, 100] }
        );
        // 3 + 20 closes: 22 one-bar starts, still reported; a 20-bar hold has 3.
        expect(result.baselineN).toBe(22);
        const long = label(
            [ENTRY_FOR_LONG, ...Array.from({ length: 19 }, () => flat(100))],
            {},
            { preCloses: [100, 100, 100] }
        );
        expect(long.holdBars).toBe(20);
        expect(long.baselineN).toBe(3);
        expect(long.baselineSameLengthPct).toBeNull();
    });
});

describe('labelPlanOutcome — target', () => {
    const plan = {
        entryLow: 97,
        entryHigh: 112,
        stop: 90,
        targets: [105, 110, 120],
    };
    const atOpen = (open: number) =>
        label([[open, open + 0.5, open - 0.5, open]], plan, {
            referencePrice: open,
            pad: open,
        });

    it.each([
        ['the nearest target above a fill of 101', 101, 105],
        ['a target one cent above the fill is kept', 104.99, 105],
        ['the first target not above the fill is skipped (fill 105)', 105, 110],
        ['the last target when the fill is past the others', 111, 120],
    ])('is %s', (_name, open, target) => {
        expect(atOpen(open).target).toBe(target);
    });

    it('is null without a fill and when no target is above the fill', () => {
        expect(
            label([flat(120)], plan, { referencePrice: 120, pad: 120 }).target
        ).toBeNull();
        expect(
            label(
                [[112, 112.5, 111.5, 112]],
                { ...plan, targets: [105] },
                { referencePrice: 112, pad: 112 }
            )
        ).toMatchObject({ reason: 'no_target_above_fill', target: null });
    });

    it('is the level the plan resolved against, even when a later bar opens beyond it', () => {
        const result = label(
            [
                [101, 101.5, 100.5, 101],
                [108, 109, 107, 108],
            ],
            plan,
            { referencePrice: 101, pad: 101 }
        );
        expect(result).toMatchObject({
            outcome: 'target_first',
            target: 105,
            exit: 108,
            gap: true,
        });
        expect(result.returnPct).toBeGreaterThan((105 / 101 - 1) * 100);
    });
});

describe('labelPlanOutcome — anchorBarUnobserved', () => {
    // Zone 100-102, stop 97: the stop is under the zone, so a final low at or under the
    // zone high covers both reaching the zone and reaching the stop.
    const plan = { entryLow: 100, entryHigh: 102, stop: 97, targets: [110] };
    const flag = (
        anchorBar: Ohlc,
        anchorForming: boolean,
        patch: Partial<Plan> = {}
    ) =>
        label(
            [flat(104)],
            { ...plan, ...patch },
            {
                referencePrice: 104,
                pad: 104,
                anchorForming,
                anchorBar,
            }
        ).anchorBarUnobserved;

    it('is false for a closed anchor, whatever the bar range', () => {
        expect(flag([104, 105, 96, 104], false)).toBe(false);
    });

    it.each([
        ['final low just above the zone high', 102.01, false],
        ['final low exactly at the zone high', 102, true],
        ['final low inside the zone', 101, true],
        ['final low under the stop', 96, true],
    ])('for a forming anchor with a %s', (_name, low, expected) => {
        expect(flag([104, 105, low, 104], true)).toBe(expected);
    });

    describe('the final range has to overlap the zone', () => {
        const probe = (low: number, high: number, forming = true) =>
            label(
                [flat(98)],
                { ...plan, stop: 95 },
                {
                    referencePrice: 98,
                    pad: 98,
                    anchorForming: forming,
                    anchorBar: [low, high, low, high],
                }
            ).anchorBarUnobserved;

        it.each([
            [
                'range 97-99 under the zone (a stop touch alone changes nothing)',
                97,
                99,
                false,
            ],
            ['range 103-106 over the zone', 103, 106, false],
            ['range 99-101 reaching the zone from below', 99, 101, true],
            ['range 101-103 reaching the zone from above', 101, 103, true],
            ['a low exactly at the zone high', 102, 105, true],
            ['a high exactly at the zone low', 97, 100, true],
            ['a low one cent over the zone high', 102.01, 105, false],
            ['a high one cent under the zone low', 97, 99.99, false],
            ['a range covering the whole zone', 90, 110, true],
        ])('forming anchor with %s', (_name, low, high, expected) => {
            expect(probe(low, high)).toBe(expected);
        });

        it('is false for a closed anchor with an overlapping range', () => {
            expect(probe(99, 101, false)).toBe(false);
        });
    });

    it('is false for a plan that cannot be evaluated (no zone, no stop)', () => {
        const bar: Ohlc = [104, 105, 96, 104];
        expect(
            flag(bar, true, {
                entryLow: null,
                entryHigh: null,
            })
        ).toBe(false);
        expect(flag(bar, true, { stop: null })).toBe(false);
    });

    it('is carried on a plan that is not triggered, voided or resolved', () => {
        const window = {
            referencePrice: 104,
            anchorForming: true,
            anchorBar: [104, 105, 101, 104] as Ohlc,
            pad: 104,
        };
        expect(label([flat(104)], plan, window)).toMatchObject({
            outcome: 'not_triggered',
            anchorBarUnobserved: true,
        });
        expect(label([[101, 101.5, 100.5, 101]], plan, window)).toMatchObject({
            anchorBarUnobserved: true,
        });
    });
});
