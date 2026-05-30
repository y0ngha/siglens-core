import { describe, it, expect, beforeEach } from 'vitest';
import { computePivotFibLevels } from '@/domain/analysis/pivotFib';
import { EMPTY_INDICATOR_RESULT } from '@/domain/indicators/constants';
import type { Bar, IndicatorResult, SMCSwingPoint } from '@/domain/types';

const PRIOR_HIGH = 110;
const PRIOR_LOW = 90;
const PRIOR_CLOSE = 105;
const PRIOR_RANGE = PRIOR_HIGH - PRIOR_LOW;
const PP = (PRIOR_HIGH + PRIOR_LOW + PRIOR_CLOSE) / 3;

const SWING_HIGH_PRICE = 200;
const SWING_LOW_PRICE = 100;
const SWING_RANGE = SWING_HIGH_PRICE - SWING_LOW_PRICE;

const FLOAT_TOLERANCE = 1e-9;

const makeBar = (overrides?: Partial<Bar>): Bar => ({
    time: 1_700_000_000,
    open: 100,
    high: PRIOR_HIGH,
    low: PRIOR_LOW,
    close: PRIOR_CLOSE,
    volume: 1000,
    ...overrides,
});

/**
 * Build a bar list whose prior completed period (`bars[len - 2]`) carries the
 * given overrides; the trailing current-period bar is intentionally distinct so
 * tests assert the pivots anchor on the prior bar, not the last one.
 */
const withPriorBar = (priorOverrides?: Partial<Bar>): Bar[] => [
    makeBar(priorOverrides),
    makeBar({ high: 999, low: 1, close: 500 }),
];

const makeSwing = (
    price: number,
    type: SMCSwingPoint['type'],
    index: number
): SMCSwingPoint => ({ index, price, type });

const makeIndicators = (
    swingHighs: SMCSwingPoint[] = [],
    swingLows: SMCSwingPoint[] = []
): IndicatorResult => ({
    ...EMPTY_INDICATOR_RESULT,
    smc: { ...EMPTY_INDICATOR_RESULT.smc, swingHighs, swingLows },
});

const ratioOf = (
    levels: { ratio: number; price: number }[],
    ratio: number
): number => levels.find(l => l.ratio === ratio)!.price;

describe('pivotFib', () => {
    describe('computePivotFibLevels', () => {
        describe('standardPivot', () => {
            it('computes PP/R/S from the prior-period bar H/L/C', () => {
                const result = computePivotFibLevels(
                    withPriorBar(),
                    makeIndicators()
                );
                const pivot = result.standardPivot!;

                expect(pivot.pp).toBeCloseTo(PP, 9);
                expect(pivot.r1).toBeCloseTo(2 * PP - PRIOR_LOW, 9);
                expect(pivot.r2).toBeCloseTo(PP + PRIOR_RANGE, 9);
                expect(pivot.r3).toBeCloseTo(
                    PRIOR_HIGH + 2 * (PP - PRIOR_LOW),
                    9
                );
                expect(pivot.s1).toBeCloseTo(2 * PP - PRIOR_HIGH, 9);
                expect(pivot.s2).toBeCloseTo(PP - PRIOR_RANGE, 9);
                expect(pivot.s3).toBeCloseTo(
                    PRIOR_LOW - 2 * (PRIOR_HIGH - PP),
                    9
                );
            });

            it('anchors on the prior bar (len - 2), not the last bar', () => {
                const bars = [
                    makeBar(),
                    makeBar({ high: 1, low: 1, close: 1 }),
                ];
                const result = computePivotFibLevels(bars, makeIndicators());
                expect(result.standardPivot!.pp).toBeCloseTo(PP, 9);
            });

            it('orders resistances above and supports below PP', () => {
                const { pp, r1, r2, r3, s1, s2, s3 } = computePivotFibLevels(
                    withPriorBar(),
                    makeIndicators()
                ).standardPivot!;
                expect(r1).toBeGreaterThan(pp);
                expect(r2).toBeGreaterThan(r1);
                expect(r3).toBeGreaterThan(r2);
                expect(s1).toBeLessThan(pp);
                expect(s2).toBeLessThan(s1);
                expect(s3).toBeLessThan(s2);
            });

            it('returns null when the bar list is empty', () => {
                const result = computePivotFibLevels([], makeIndicators());
                expect(result.standardPivot).toBeNull();
            });

            it('returns null when there is no prior period (fewer than 2 bars)', () => {
                const result = computePivotFibLevels(
                    [makeBar()],
                    makeIndicators()
                );
                expect(result.standardPivot).toBeNull();
                expect(result.fibonacciPivot).toBeNull();
            });

            it('returns null when a prior-bar OHLC value is non-positive', () => {
                const result = computePivotFibLevels(
                    withPriorBar({ low: 0 }),
                    makeIndicators()
                );
                expect(result.standardPivot).toBeNull();
                expect(result.fibonacciPivot).toBeNull();
            });

            it('returns null when a prior-bar OHLC value is non-finite', () => {
                const result = computePivotFibLevels(
                    withPriorBar({ high: Number.NaN }),
                    makeIndicators()
                );
                expect(result.standardPivot).toBeNull();
                expect(result.fibonacciPivot).toBeNull();
            });
        });

        describe('fibonacciPivot', () => {
            it('offsets PP by 0.382/0.618/1.0 of the range', () => {
                const pivot = computePivotFibLevels(
                    withPriorBar(),
                    makeIndicators()
                ).fibonacciPivot!;

                expect(pivot.pp).toBeCloseTo(PP, 9);
                expect(pivot.r1).toBeCloseTo(PP + 0.382 * PRIOR_RANGE, 9);
                expect(pivot.r2).toBeCloseTo(PP + 0.618 * PRIOR_RANGE, 9);
                expect(pivot.r3).toBeCloseTo(PP + 1.0 * PRIOR_RANGE, 9);
                expect(pivot.s1).toBeCloseTo(PP - 0.382 * PRIOR_RANGE, 9);
                expect(pivot.s2).toBeCloseTo(PP - 0.618 * PRIOR_RANGE, 9);
                expect(pivot.s3).toBeCloseTo(PP - 1.0 * PRIOR_RANGE, 9);
            });

            it('returns null when the bar list is empty', () => {
                expect(
                    computePivotFibLevels([], makeIndicators()).fibonacciPivot
                ).toBeNull();
            });

            it('returns null when a prior-bar OHLC value is non-positive', () => {
                expect(
                    computePivotFibLevels(
                        withPriorBar({ close: -5 }),
                        makeIndicators()
                    ).fibonacciPivot
                ).toBeNull();
            });
        });

        describe('fibonacci projection', () => {
            describe('when the most recent low precedes the most recent high (up-leg)', () => {
                let fib: NonNullable<
                    ReturnType<typeof computePivotFibLevels>['fibonacci']
                >;

                beforeEach(() => {
                    const result = computePivotFibLevels(
                        [makeBar()],
                        makeIndicators(
                            [makeSwing(SWING_HIGH_PRICE, 'high', 20)],
                            [makeSwing(SWING_LOW_PRICE, 'low', 10)]
                        )
                    );
                    fib = result.fibonacci!;
                });

                it('reports the up-leg direction and anchors', () => {
                    expect(fib.direction).toBe('up');
                    expect(fib.high).toBe(SWING_HIGH_PRICE);
                    expect(fib.low).toBe(SWING_LOW_PRICE);
                });

                it('computes retracements down from the high', () => {
                    expect(ratioOf(fib.retracements, 0.236)).toBeCloseTo(
                        SWING_HIGH_PRICE - 0.236 * SWING_RANGE,
                        9
                    );
                    expect(ratioOf(fib.retracements, 0.5)).toBeCloseTo(150, 9);
                    expect(ratioOf(fib.retracements, 0.786)).toBeCloseTo(
                        SWING_HIGH_PRICE - 0.786 * SWING_RANGE,
                        9
                    );
                });

                it('computes extension targets up from the low', () => {
                    expect(ratioOf(fib.extensions, 1.0)).toBeCloseTo(
                        SWING_HIGH_PRICE,
                        9
                    );
                    expect(ratioOf(fib.extensions, 1.272)).toBeCloseTo(
                        SWING_LOW_PRICE + 1.272 * SWING_RANGE,
                        9
                    );
                    expect(ratioOf(fib.extensions, 1.618)).toBeCloseTo(
                        SWING_LOW_PRICE + 1.618 * SWING_RANGE,
                        9
                    );
                    expect(ratioOf(fib.extensions, 2.0)).toBeCloseTo(
                        SWING_LOW_PRICE + 2.0 * SWING_RANGE,
                        9
                    );
                    expect(ratioOf(fib.extensions, 2.618)).toBeCloseTo(
                        SWING_LOW_PRICE + 2.618 * SWING_RANGE,
                        9
                    );
                });

                it('exposes five retracement and five extension levels', () => {
                    expect(fib.retracements).toHaveLength(5);
                    expect(fib.extensions).toHaveLength(5);
                });
            });

            describe('when the most recent high precedes the most recent low (down-leg)', () => {
                let fib: NonNullable<
                    ReturnType<typeof computePivotFibLevels>['fibonacci']
                >;

                beforeEach(() => {
                    const result = computePivotFibLevels(
                        [makeBar()],
                        makeIndicators(
                            [makeSwing(SWING_HIGH_PRICE, 'high', 10)],
                            [makeSwing(SWING_LOW_PRICE, 'low', 20)]
                        )
                    );
                    fib = result.fibonacci!;
                });

                it('reports the down-leg direction', () => {
                    expect(fib.direction).toBe('down');
                });

                it('computes retracements up from the low', () => {
                    expect(ratioOf(fib.retracements, 0.236)).toBeCloseTo(
                        SWING_LOW_PRICE + 0.236 * SWING_RANGE,
                        9
                    );
                    expect(ratioOf(fib.retracements, 0.5)).toBeCloseTo(150, 9);
                });

                it('computes extension targets down from the high', () => {
                    expect(ratioOf(fib.extensions, 1.0)).toBeCloseTo(
                        SWING_LOW_PRICE,
                        9
                    );
                    expect(ratioOf(fib.extensions, 1.618)).toBeCloseTo(
                        SWING_HIGH_PRICE - 1.618 * SWING_RANGE,
                        9
                    );
                });
            });

            it('uses the most recent swing point when several exist', () => {
                const fib = computePivotFibLevels(
                    [makeBar()],
                    makeIndicators(
                        [
                            makeSwing(180, 'high', 5),
                            makeSwing(SWING_HIGH_PRICE, 'high', 20),
                        ],
                        [
                            makeSwing(120, 'low', 3),
                            makeSwing(SWING_LOW_PRICE, 'low', 10),
                        ]
                    )
                ).fibonacci!;
                expect(fib.high).toBe(SWING_HIGH_PRICE);
                expect(fib.low).toBe(SWING_LOW_PRICE);
            });

            it('returns null when there is no swing high', () => {
                const result = computePivotFibLevels(
                    [makeBar()],
                    makeIndicators([], [makeSwing(SWING_LOW_PRICE, 'low', 1)])
                );
                expect(result.fibonacci).toBeNull();
            });

            it('returns null when there is no swing low', () => {
                const result = computePivotFibLevels(
                    [makeBar()],
                    makeIndicators([makeSwing(SWING_HIGH_PRICE, 'high', 1)], [])
                );
                expect(result.fibonacci).toBeNull();
            });

            it('returns null when the swing high is not above the swing low', () => {
                const result = computePivotFibLevels(
                    [makeBar()],
                    makeIndicators(
                        [makeSwing(100, 'high', 5)],
                        [makeSwing(100, 'low', 1)]
                    )
                );
                expect(result.fibonacci).toBeNull();
            });

            it('returns null when a swing price is non-positive', () => {
                const result = computePivotFibLevels(
                    [makeBar()],
                    makeIndicators(
                        [makeSwing(SWING_HIGH_PRICE, 'high', 5)],
                        [makeSwing(0, 'low', 1)]
                    )
                );
                expect(result.fibonacci).toBeNull();
            });
        });

        describe('when no inputs are usable', () => {
            it('returns all-null components', () => {
                const result = computePivotFibLevels([], makeIndicators());
                expect(result).toEqual({
                    standardPivot: null,
                    fibonacciPivot: null,
                    fibonacci: null,
                });
            });
        });

        it('keeps the 50% retracement exactly at the midpoint', () => {
            const fib = computePivotFibLevels(
                [makeBar()],
                makeIndicators(
                    [makeSwing(SWING_HIGH_PRICE, 'high', 20)],
                    [makeSwing(SWING_LOW_PRICE, 'low', 10)]
                )
            ).fibonacci!;
            const midpoint = (SWING_HIGH_PRICE + SWING_LOW_PRICE) / 2;
            expect(
                Math.abs(ratioOf(fib.retracements, 0.5) - midpoint)
            ).toBeLessThan(FLOAT_TOLERANCE);
        });
    });
});
