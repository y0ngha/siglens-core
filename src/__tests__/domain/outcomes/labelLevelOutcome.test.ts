import { describe, expect, it } from 'vitest';
import { labelLevelOutcome } from '@/domain/outcomes/labelLevelOutcome';
import type { LevelOutcomeLabel } from '@/domain/outcomes/types';
import {
    flat,
    makeWindow,
    type Ohlc,
    type WindowSpec,
} from '../../helpers/outcomeWindows';

/**
 * Reference price 100, ATR 2. A support at 95 is 2.5 ATR away: touching means `low ≤ 95.2`,
 * a break is a close (or an open) under 94, a hold a close over 96. A resistance at 105
 * mirrors it: touch `high ≥ 104.8`, break above 106, hold under 104.
 *
 * A bar that touches the support without resolving it (close between 94 and 96):
 */
const TOUCH: Ohlc = [95.5, 96, 95.1, 95.5];
const R_TOUCH: Ohlc = [104.5, 104.9, 104, 104.5];

function support(
    forward: readonly Ohlc[],
    window: Omit<WindowSpec, 'forward'> = {},
    price = 95
): LevelOutcomeLabel {
    return labelLevelOutcome(
        { side: 'support', price },
        makeWindow({ ...window, forward })
    );
}

function resistance(
    forward: readonly Ohlc[],
    window: Omit<WindowSpec, 'forward'> = {},
    price = 105
): LevelOutcomeLabel {
    return labelLevelOutcome(
        { side: 'resistance', price },
        makeWindow({ ...window, forward })
    );
}

/** `bars` placed so the first one is forward offset `offset`, quiet bars (100) before it. */
function at(offset: number, ...bars: Ohlc[]): Ohlc[] {
    return [...Array.from({ length: offset - 1 }, () => flat(100)), ...bars];
}

describe('labelLevelOutcome — skipped', () => {
    it.each([null, 0, -1, Number.NaN])('has no ATR when atr is %s', atr => {
        expect(support([TOUCH], { atr })).toMatchObject({
            outcome: 'skipped',
            skipReason: 'no_atr',
            distanceAtr: null,
            touchOffset: null,
        });
    });

    it.each([
        ['a support above the reference price', 'support', 101],
        ['a resistance under the reference price', 'resistance', 99],
    ] as const)('%s is on the wrong side', (_name, side, price) => {
        expect(labelLevelOutcome({ side, price }, makeWindow())).toMatchObject({
            outcome: 'skipped',
            skipReason: 'wrong_side',
        });
    });

    it.each(['support', 'resistance'] as const)(
        'a %s exactly at the reference price is at_price, not wrong_side',
        side => {
            expect(
                labelLevelOutcome({ side, price: 100 }, makeWindow())
            ).toMatchObject({
                outcome: 'skipped',
                skipReason: 'at_price',
                distanceAtr: 0,
            });
        }
    );

    it('reports the distance in ATRs of a skipped level when it can', () => {
        expect(
            labelLevelOutcome({ side: 'support', price: 101 }, makeWindow())
                .distanceAtr
        ).toBeCloseTo(0.5, 12);
    });

    it.each([
        ['just under a quarter ATR (0.245)', 99.51, 'at_price'],
        ['exactly a quarter ATR', 99.5, null],
        ['0.4 ATR', 99.2, null],
    ])('a support %s from the price', (_name, price, skipReason) => {
        expect(support([], {}, price).skipReason).toBe(skipReason);
    });

    it('treats a resistance a quarter ATR away as testable and closer as at_price', () => {
        expect(resistance([], {}, 100.5).skipReason).toBeNull();
        expect(resistance([], {}, 100.49).skipReason).toBe('at_price');
    });

    it('lets wrong_side win over at_price, and no_atr over both', () => {
        expect(support([], {}, 100.1).skipReason).toBe('wrong_side');
        expect(support([], { atr: null }, 100.1).skipReason).toBe('no_atr');
    });
});

describe('labelLevelOutcome — touch', () => {
    it('is untouched while no low gets within a tenth of an ATR of a support', () => {
        expect(support([[96, 97, 95.21, 96]])).toMatchObject({
            outcome: 'untouched',
            skipReason: null,
            touchOffset: null,
            resolveOffset: null,
            gap: false,
            distanceAtr: 2.5,
        });
    });

    it('touches a support at 0.1 ATR above it', () => {
        expect(support([[96, 97, 95.19, 96]]).touchOffset).toBe(1);
    });

    it('touches a resistance at 0.1 ATR under it', () => {
        expect(resistance([[104, 104.79, 103, 104]]).outcome).toBe('untouched');
        expect(resistance([[104, 104.81, 103, 104]]).touchOffset).toBe(1);
    });

    it('takes the first bar that touches', () => {
        expect(support(at(4, TOUCH)).touchOffset).toBe(4);
    });
});

describe('labelLevelOutcome — resolving a touch (support)', () => {
    it.each<[string, Ohlc, Partial<LevelOutcomeLabel>]>([
        [
            'a close above the hold barrier',
            [95.5, 96.6, 95.1, 96.5],
            { outcome: 'respected', gap: false },
        ],
        [
            'a close exactly at the hold barrier',
            [95.5, 96.6, 95.1, 96],
            { outcome: 'inconclusive' },
        ],
        [
            'a close under the break barrier',
            [95.5, 95.6, 93, 93.9],
            { outcome: 'broken', gap: false },
        ],
        [
            'a close exactly at the break barrier',
            [95.5, 95.6, 93, 94],
            { outcome: 'inconclusive' },
        ],
        [
            'an open under the break barrier (a gap)',
            [93.9, 96, 93, 95.5],
            { outcome: 'broken', gap: true },
        ],
        [
            'an open exactly at the break barrier',
            [94, 96, 93, 95.5],
            { outcome: 'inconclusive' },
        ],
        [
            'an open under the barrier that closes back over the hold barrier',
            [93, 97, 93, 96.5],
            { outcome: 'broken', gap: true },
        ],
    ])('%s on the touch bar', (_name, bar, expected) => {
        // Quiet filler at the touch close, so an unresolved touch stays unresolved.
        expect(support([bar], { pad: 95.5 })).toMatchObject({
            touchOffset: 1,
            ...(expected.outcome === 'inconclusive'
                ? { resolveOffset: null }
                : { resolveOffset: 1 }),
            ...expected,
        });
    });

    it('resolves on a later follow bar and reports its offset', () => {
        expect(support(at(3, TOUCH, [95.5, 97, 95.4, 96.5]))).toMatchObject({
            outcome: 'respected',
            touchOffset: 3,
            resolveOffset: 4,
        });
    });

    it('resolves on the last follow bar (touch + 9)', () => {
        const bars = at(
            3,
            TOUCH,
            ...Array.from({ length: 8 }, () => TOUCH),
            [95.5, 97, 95.4, 96.5]
        );
        expect(support(bars)).toMatchObject({
            outcome: 'respected',
            touchOffset: 3,
            resolveOffset: 12,
        });
    });

    it('does not count an event on the bar after the follow bars', () => {
        const bars = at(
            3,
            TOUCH,
            ...Array.from({ length: 9 }, () => TOUCH),
            [95.5, 97, 95.4, 96.5]
        );
        expect(support(bars)).toMatchObject({
            outcome: 'inconclusive',
            touchOffset: 3,
            resolveOffset: null,
        });
    });

    it('lets the first event win over a later one', () => {
        expect(
            support(at(2, TOUCH, [95.5, 95.6, 93, 93.5], [95, 97, 95, 96.5]))
        ).toMatchObject({ outcome: 'broken', resolveOffset: 3 });
    });

    it('is inconclusive when all ten follow bars ran without an event', () => {
        // touch at 11: follow bars 11..20, the last one observed.
        expect(
            support(at(11, ...Array.from({ length: 10 }, () => TOUCH)))
        ).toMatchObject({
            outcome: 'inconclusive',
            touchOffset: 11,
        });
    });

    it('is touched_late when the window ended before ten follow bars', () => {
        expect(
            support(at(12, ...Array.from({ length: 9 }, () => TOUCH)))
        ).toMatchObject({
            outcome: 'touched_late',
            touchOffset: 12,
            resolveOffset: null,
        });
    });

    it('can still resolve inside a window that ends early', () => {
        expect(support(at(20, [95.5, 97, 95.1, 96.5]))).toMatchObject({
            outcome: 'respected',
            touchOffset: 20,
            resolveOffset: 20,
        });
    });

    it('is touched_late for a touch on the last bar with no event', () => {
        expect(support(at(20, TOUCH)).outcome).toBe('touched_late');
    });
});

describe('labelLevelOutcome — resolving a touch (resistance mirror)', () => {
    it.each<[string, Ohlc, Partial<LevelOutcomeLabel>]>([
        [
            'a close under the hold barrier',
            [104.5, 105, 103.4, 103.5],
            { outcome: 'respected', gap: false },
        ],
        [
            'a close exactly at the hold barrier',
            [104.5, 105, 103.4, 104],
            { outcome: 'inconclusive' },
        ],
        [
            'a close above the break barrier',
            [104.5, 107, 104.4, 106.1],
            { outcome: 'broken', gap: false },
        ],
        [
            'a close exactly at the break barrier',
            [104.5, 107, 104.4, 106],
            { outcome: 'inconclusive' },
        ],
        [
            'an open above the break barrier (a gap)',
            [106.1, 107, 104.4, 104.5],
            { outcome: 'broken', gap: true },
        ],
        [
            'an open exactly at the break barrier',
            [106, 107, 104.4, 105],
            { outcome: 'inconclusive' },
        ],
    ])('%s on the touch bar', (_name, bar, expected) => {
        expect(resistance([bar], { pad: 104.5 })).toMatchObject({
            touchOffset: 1,
            resolveOffset: expected.outcome === 'inconclusive' ? null : 1,
            ...expected,
        });
    });

    it('is touched_late and untouched like a support', () => {
        expect(
            resistance(at(12, ...Array.from({ length: 9 }, () => R_TOUCH)))
                .outcome
        ).toBe('touched_late');
        expect(resistance([flat(100)]).outcome).toBe('untouched');
    });
});

describe('labelLevelOutcome — placebo', () => {
    it('labels the level moved 0.5 ATR farther (+) and closer (−), in that order', () => {
        const result = support([[96, 97, 95.1, 96.6]]);
        expect(result.placebo.map(p => p.shiftAtr)).toEqual([0.5, -0.5]);
    });

    it('evaluates each placebo as its own level on the same bars', () => {
        // The low reaches 95.1: touches the real 95 and the closer 96, not the farther 94.
        const result = support([[96, 97, 95.1, 96.6]]);
        expect(result).toMatchObject({
            outcome: 'respected',
            placebo: [
                {
                    shiftAtr: 0.5,
                    outcome: 'untouched',
                    touchOffset: null,
                    skipReason: null,
                },
                {
                    shiftAtr: -0.5,
                    outcome: 'respected',
                    touchOffset: 1,
                    skipReason: null,
                },
            ],
        });
    });

    it('moves a resistance placebo the same way: farther is higher, closer is lower', () => {
        // The high reaches 104.9: touches the real 105 and the closer 104, not the farther 106.
        const result = resistance([[104, 104.9, 103, 103.4]]);
        expect(result.placebo).toEqual([
            {
                shiftAtr: 0.5,
                outcome: 'untouched',
                skipReason: null,
                touchOffset: null,
            },
            {
                shiftAtr: -0.5,
                outcome: 'respected',
                skipReason: null,
                touchOffset: 1,
            },
        ]);
    });

    it('skips a closer placebo that lands at the price (at_price)', () => {
        // support 98.8 is 0.6 ATR away; 0.5 ATR closer is 99.8, 0.1 ATR away.
        const result = support([], {}, 98.8);
        expect(result.skipReason).toBeNull();
        expect(result.placebo[1]).toEqual({
            shiftAtr: -0.5,
            outcome: 'skipped',
            skipReason: 'at_price',
            touchOffset: null,
        });
    });

    it('skips a closer placebo that crosses the price (wrong_side)', () => {
        const result = support([], {}, 99.2);
        expect(result.placebo[1]).toMatchObject({
            outcome: 'skipped',
            skipReason: 'wrong_side',
        });
        expect(result.placebo[0].skipReason).toBeNull();
    });

    it('carries the real level skip into both placebos when there is no ATR', () => {
        const result = support([TOUCH], { atr: null });
        expect(result.placebo.map(p => p.skipReason)).toEqual([
            'no_atr',
            'no_atr',
        ]);
    });

    it('is the same function: a placebo outcome equals labelling the shifted price directly', () => {
        const forward = [[96, 97, 94.1, 96.6]] as const;
        const real = support(forward);
        const farther = support(forward, {}, 94);
        expect(real.placebo[0]).toMatchObject({
            outcome: farther.outcome,
            touchOffset: farther.touchOffset,
        });
    });
});
