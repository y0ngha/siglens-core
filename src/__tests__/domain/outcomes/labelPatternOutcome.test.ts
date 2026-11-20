import { describe, expect, it } from 'vitest';
import { labelPatternOutcome } from '@/domain/outcomes/labelPatternOutcome';
import type {
    OutcomeSubject,
    PatternOutcomeLabel,
} from '@/domain/outcomes/types';
import {
    flat,
    makeWindow,
    type Ohlc,
    type WindowSpec,
} from '../../helpers/outcomeWindows';

type Pattern = OutcomeSubject['patterns'][number];

/** Up pattern: breakout 100, extreme 90, so the measured target is 110; invalidation 95. */
const UP: Pattern = {
    name: 'double_bottom',
    candidateId: 'c1',
    breakout: 100,
    extreme: 90,
    direction: 'up',
    invalidation: 95,
};

/** Down pattern, mirrored: breakout 100, extreme 110, target 90, invalidation 105. */
const DOWN: Pattern = {
    name: 'double_top',
    candidateId: null,
    breakout: 100,
    extreme: 110,
    direction: 'down',
    invalidation: 105,
};

function label(
    pattern: Partial<Pattern>,
    forward: readonly Ohlc[],
    window: Omit<WindowSpec, 'forward'> = {},
    scale = 1
): PatternOutcomeLabel {
    return labelPatternOutcome(
        { ...UP, ...pattern },
        makeWindow({ ...window, forward }),
        scale
    );
}

function down(
    pattern: Partial<Pattern>,
    forward: readonly Ohlc[],
    window: Omit<WindowSpec, 'forward'> = {}
): PatternOutcomeLabel {
    return labelPatternOutcome(
        { ...DOWN, ...pattern },
        makeWindow({ ...window, forward }),
        1
    );
}

/** `bars` from forward offset `offset`, quiet bars (the pad) before them. */
function from(offset: number, pad: number, ...bars: Ohlc[]): Ohlc[] {
    return [...Array.from({ length: offset - 1 }, () => flat(pad)), ...bars];
}

describe('labelPatternOutcome — geometry', () => {
    it.each([
        ['a target that is not past the breakout level', { extreme: 100 }],
        ['an invalidation at the breakout level', { invalidation: 100 }],
        ['an invalidation above the breakout level', { invalidation: 101 }],
    ])('skips %s (up)', (_name, patch) => {
        expect(label(patch, [])).toMatchObject({
            outcome: 'skipped',
            skipReason: 'geometry_invalid',
            breakoutOffset: null,
            resolveOffset: null,
            rwNullTargetFirst: null,
        });
    });

    it('accepts an invalidation one cent under the breakout level', () => {
        expect(label({ invalidation: 99.99 }, []).skipReason).toBeNull();
    });

    it.each([
        ['an invalidation at the breakout level', { invalidation: 100 }],
        ['an invalidation under the breakout level', { invalidation: 99 }],
        ['a target that is not past the breakout level', { extreme: 100 }],
    ])('skips %s (down)', (_name, patch) => {
        expect(down(patch, []).skipReason).toBe('geometry_invalid');
    });

    it('accepts a down invalidation one cent over the breakout level', () => {
        expect(down({ invalidation: 100.01 }, []).skipReason).toBeNull();
    });

    it('reports the measured target', () => {
        expect(label({}, []).measuredTarget).toBe(110);
        expect(down({}, []).measuredTarget).toBe(90);
    });

    it('carries the name, candidate and direction', () => {
        expect(label({}, [])).toMatchObject({
            name: 'double_bottom',
            candidateId: 'c1',
            direction: 'up',
        });
    });

    it('scales the stored geometry by the adjustment factor, keeping the stored rounding', () => {
        const result = labelPatternOutcome(
            { ...UP, breakout: 200, extreme: 180, invalidation: 190 },
            makeWindow({ referencePrice: 101, forward: [] }),
            0.5
        );
        expect(result.measuredTarget).toBe(110);
        expect(result).toMatchObject({ alreadyBroken: true });
    });
});

describe('labelPatternOutcome — the breakout', () => {
    it('is already broken when the reference price is past the level', () => {
        expect(
            label({}, [], { referencePrice: 100.01, pad: 100.01 })
        ).toMatchObject({
            alreadyBroken: true,
            breakoutOffset: 0,
        });
    });

    it('is not already broken at the level itself', () => {
        expect(label({}, [], { referencePrice: 100 })).toMatchObject({
            alreadyBroken: false,
            outcome: 'no_breakout',
            breakoutOffset: null,
        });
    });

    it('takes the first close past the level as the breakout bar and races from the next bar', () => {
        // bar 2 closes at 100.5 (breakout), its own 120 high is not part of the race.
        const result = label(
            {},
            [[99, 99.5, 98.5, 99], [99, 120, 98.5, 100.5], flat(102)],
            {
                referencePrice: 99,
            }
        );
        expect(result).toMatchObject({
            alreadyBroken: false,
            breakoutOffset: 2,
            outcome: 'open_at_horizon',
        });
        expect(result.rwNullTargetFirst).toBeCloseTo(
            (100.5 - 95) / (110 - 95),
            12
        );
    });

    it('does not break out on a close exactly at the level', () => {
        expect(
            label({}, [[99, 100, 98.5, 100]], { referencePrice: 99, pad: 99 })
        ).toMatchObject({
            outcome: 'no_breakout',
        });
    });

    it('is invalidated before the breakout by a low at the invalidation with a close under the level', () => {
        expect(
            label({}, from(2, 99, [99, 99.5, 95, 99]), {
                referencePrice: 99,
                pad: 99,
            })
        ).toMatchObject({
            outcome: 'invalidated_before_breakout',
            breakoutOffset: null,
            resolveOffset: null,
        });
    });

    it('is not invalidated by a low one cent above the invalidation', () => {
        expect(
            label({}, [[99, 99.5, 95.01, 99]], { referencePrice: 99, pad: 99 })
                .outcome
        ).toBe('no_breakout');
    });

    it('is invalidated, not broken out, when one bar touches the invalidation and closes past the level', () => {
        // B 100, I 95, M 110: low 94 reaches the invalidation, close 100.5 is past the level.
        expect(
            label({}, [[98, 101, 94, 100.5]], { referencePrice: 99, pad: 105 })
        ).toMatchObject({
            outcome: 'invalidated_before_breakout',
            breakoutOffset: null,
            rwNullTargetFirst: null,
        });
    });

    it('breaks out when the same bar stops one cent short of the invalidation', () => {
        expect(
            label({}, [[98, 101, 95.01, 100.5]], {
                referencePrice: 99,
                pad: 105,
            })
        ).toMatchObject({ outcome: 'open_at_horizon', breakoutOffset: 1 });
    });

    it('is invalidated on a bar that touches the invalidation exactly and closes past the level', () => {
        expect(
            label({}, [[98, 101, 95, 100.5]], { referencePrice: 99, pad: 105 })
                .outcome
        ).toBe('invalidated_before_breakout');
    });

    it('mirrors for a down pattern: a high at the invalidation with a close under the level', () => {
        expect(
            down({}, [[101, 105, 99, 99.5]], { referencePrice: 101, pad: 95 })
                .outcome
        ).toBe('invalidated_before_breakout');
    });

    it('is no_breakout, never invalidated, without an invalidation level', () => {
        expect(
            label({ invalidation: null }, [[99, 99.5, 50, 99]], {
                referencePrice: 99,
                pad: 99,
            })
        ).toMatchObject({ outcome: 'no_breakout', rwNullTargetFirst: null });
    });

    it('leaves nothing to race when the breakout is on the last bar', () => {
        const result = label({}, from(20, 99, [99, 101, 98, 100.5]), {
            referencePrice: 99,
            pad: 99,
        });
        expect(result).toMatchObject({
            outcome: 'open_at_horizon',
            breakoutOffset: 20,
            resolveOffset: null,
            gap: false,
        });
    });
});

describe('labelPatternOutcome — the race (up, already broken from 101)', () => {
    const window = { referencePrice: 101, pad: 101 };
    const race = (...bars: Ohlc[]) => label({}, bars, window);

    it.each<[string, Ohlc, Partial<PatternOutcomeLabel>]>([
        [
            'a high just short of the target and a low just above the invalidation',
            [101, 109.99, 95.01, 101],
            { outcome: 'open_at_horizon' },
        ],
        [
            'a high exactly at the target',
            [101, 110, 100, 101],
            { outcome: 'target_first', gap: false },
        ],
        [
            'a high through the target',
            [101, 115, 100, 112],
            { outcome: 'target_first', gap: false },
        ],
        [
            'a low exactly at the invalidation',
            [101, 105, 95, 101],
            { outcome: 'invalidation_first', gap: false },
        ],
        [
            'a low through the invalidation',
            [101, 105, 90, 92],
            { outcome: 'invalidation_first', gap: false },
        ],
        [
            'an open exactly at the target (a gap)',
            [110, 111, 109, 110],
            { outcome: 'target_first', gap: true },
        ],
        [
            'an open above the target (a gap)',
            [112, 113, 111, 112],
            { outcome: 'target_first', gap: true },
        ],
        [
            'an open exactly at the invalidation (a gap)',
            [95, 99, 94, 98],
            { outcome: 'invalidation_first', gap: true },
        ],
        [
            'an open under the invalidation (a gap)',
            [93, 94, 92, 93],
            { outcome: 'invalidation_first', gap: true },
        ],
        [
            'both levels touched inside the bar',
            [101, 111, 94, 101],
            { outcome: 'ambiguous', gap: false },
        ],
        [
            'an open through the invalidation with a high through the target',
            [94, 111, 93, 101],
            { outcome: 'invalidation_first', gap: true },
        ],
    ])('bar 2 with %s', (_name, bar, expected) => {
        const result = race(flat(101), bar);
        expect(result).toMatchObject({
            alreadyBroken: true,
            breakoutOffset: 0,
            ...expected,
        });
        expect(result.resolveOffset).toBe(
            expected.outcome === 'open_at_horizon' ? null : 2
        );
    });

    it('reports the random-walk probability from the start price', () => {
        expect(race().rwNullTargetFirst).toBeCloseTo(
            (101 - 95) / (110 - 95),
            12
        );
    });

    it.each([
        ['at the measured target', 110],
        ['past the measured target', 115],
    ])(
        'is skipped as target_reached when the reference price is already %s',
        (_name, referencePrice) => {
            expect(
                label(
                    {},
                    [
                        [
                            referencePrice,
                            referencePrice + 1,
                            referencePrice - 1,
                            referencePrice,
                        ],
                    ],
                    { referencePrice, pad: referencePrice }
                )
            ).toMatchObject({
                outcome: 'skipped',
                skipReason: 'target_reached',
                alreadyBroken: true,
                breakoutOffset: 0,
                resolveOffset: null,
                rwNullTargetFirst: null,
            });
        }
    );

    it('is not skipped one cent under the target', () => {
        expect(
            label({}, [], { referencePrice: 109.99, pad: 109.99 }).outcome
        ).toBe('open_at_horizon');
    });

    it('is skipped as target_reached_on_breakout, not target_reached, when the breakout bar closes past the target', () => {
        expect(
            label(
                {},
                [
                    [99, 99.5, 98.5, 99],
                    [99, 116, 98.5, 112],
                ],
                {
                    referencePrice: 99,
                    pad: 112,
                }
            )
        ).toMatchObject({
            outcome: 'skipped',
            skipReason: 'target_reached_on_breakout',
            alreadyBroken: false,
            breakoutOffset: 2,
        });
    });

    it('mirrors for a down pattern', () => {
        expect(down({}, [], { referencePrice: 90, pad: 90 })).toMatchObject({
            outcome: 'skipped',
            skipReason: 'target_reached',
        });
        expect(
            down({}, [], { referencePrice: 90.01, pad: 90.01 }).outcome
        ).toBe('open_at_horizon');
    });

    it('keeps the random-walk probability under 1 for every pattern it is reported for', () => {
        const result = label({}, [], { referencePrice: 109.99, pad: 109.99 });
        expect(result.rwNullTargetFirst).toBeGreaterThan(0);
        expect(result.rwNullTargetFirst).toBeLessThan(1);
    });

    it('races from bar 1 when already broken', () => {
        expect(race([101, 111, 100, 105])).toMatchObject({
            outcome: 'target_first',
            resolveOffset: 1,
        });
    });

    it('without an invalidation only the target can resolve the race', () => {
        const result = label(
            { invalidation: null },
            [flat(101), [101, 101, 50, 60]],
            window
        );
        expect(result).toMatchObject({
            outcome: 'open_at_horizon',
            rwNullTargetFirst: null,
        });
    });
});

describe('labelPatternOutcome — down patterns mirror', () => {
    const window = { referencePrice: 99, pad: 99 };

    it('is already broken under the level and not at it', () => {
        expect(down({}, [], window).alreadyBroken).toBe(true);
        expect(
            down({}, [], { referencePrice: 100, pad: 100 }).alreadyBroken
        ).toBe(false);
    });

    it.each<[string, Ohlc, Partial<PatternOutcomeLabel>]>([
        [
            'a low exactly at the target',
            [99, 100, 90, 99],
            { outcome: 'target_first', gap: false },
        ],
        [
            'a high exactly at the invalidation',
            [99, 105, 98, 99],
            { outcome: 'invalidation_first', gap: false },
        ],
        [
            'an open at the target (a gap)',
            [90, 91, 89, 90],
            { outcome: 'target_first', gap: true },
        ],
        [
            'an open at the invalidation (a gap)',
            [105, 106, 104, 105],
            { outcome: 'invalidation_first', gap: true },
        ],
        [
            'both levels touched',
            [99, 106, 89, 99],
            { outcome: 'ambiguous', gap: false },
        ],
        [
            'a range just inside both levels',
            [99, 104.99, 90.01, 99],
            { outcome: 'open_at_horizon' },
        ],
    ])('bar 2 with %s', (_name, bar, expected) => {
        expect(down({}, [flat(99), bar], window)).toMatchObject({
            alreadyBroken: true,
            ...expected,
        });
    });

    it('breaks out on the first close under the level and races from the next bar', () => {
        const result = down(
            {},
            [[101, 101.5, 100.5, 101], [101, 101, 80, 99.5], flat(99.5)],
            {
                referencePrice: 101,
                pad: 99.5,
            }
        );
        expect(result).toMatchObject({
            breakoutOffset: 2,
            outcome: 'open_at_horizon',
        });
        expect(result.rwNullTargetFirst).toBeCloseTo(
            (105 - 99.5) / (105 - 90),
            12
        );
    });

    it('is invalidated before the breakout by a high at the invalidation with a close over the level', () => {
        expect(
            down({}, [[101, 105, 100.5, 101]], {
                referencePrice: 101,
                pad: 101,
            }).outcome
        ).toBe('invalidated_before_breakout');
    });

    it('is no_breakout when neither happens', () => {
        expect(down({}, [], { referencePrice: 101, pad: 101 }).outcome).toBe(
            'no_breakout'
        );
    });
});
