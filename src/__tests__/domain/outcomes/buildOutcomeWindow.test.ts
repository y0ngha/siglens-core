import { describe, expect, it } from 'vitest';
import { calculateATR } from '@/domain/indicators/atr';
import { buildOutcomeWindow } from '@/domain/outcomes/buildOutcomeWindow';
import {
    ADJ_FACTOR_EPSILON,
    ANCHOR_FORMING_REF_TOLERANCE,
    OUTCOME_PRE_BARS,
    OUTCOME_WINDOW_BARS,
} from '@/domain/outcomes/constants';
import type { OutcomeAnchor, OutcomeWindow } from '@/domain/outcomes/types';
import type { Bar } from '@/domain/types';
import { risingBars, SECONDS_PER_DAY } from '../../helpers/outcomeWindows';

/** Index 70 closes at exactly 100 (`close = 30 + index`); 30 bars follow it. */
const ANCHOR_INDEX = 70;
const BARS = risingBars(100);
const ANCHOR_BAR = BARS[ANCHOR_INDEX];
const ANCHOR_TIME = ANCHOR_BAR.time;

function closedAnchor(
    closeAtAnalysis = ANCHOR_BAR.close,
    barTime = ANCHOR_TIME
): OutcomeAnchor {
    return { barTime, closeAtAnalysis, closedAtAnalysis: true };
}

function okWindow(bars: readonly Bar[], anchor: OutcomeAnchor): OutcomeWindow {
    const result = buildOutcomeWindow(bars, anchor);
    if (result.status !== 'ok') {
        throw new Error(`expected ok, got ${result.status}`);
    }
    return result.window;
}

describe('buildOutcomeWindow', () => {
    describe('a closed anchor on an unadjusted series', () => {
        const window = okWindow(BARS, closedAnchor());

        it('measures from the anchor close with no adjustment', () => {
            expect(window.referencePrice).toBe(100);
            expect(window.adjFactor).toBe(1);
            expect(window.anchorForming).toBe(false);
        });

        it('takes the ATR at the anchor bar', () => {
            expect(window.atr).toBeCloseTo(2, 10);
            expect(window.atr).toBe(
                calculateATR(
                    BARS.slice(ANCHOR_INDEX - 59, ANCHOR_INDEX + 1)
                ).at(-1)
            );
        });

        it('keeps the 60 closes up to and including the anchor', () => {
            expect(window.preCloses).toHaveLength(OUTCOME_PRE_BARS);
            expect(window.preCloses.at(-1)).toBe(100);
            expect(window.preCloses[0]).toBe(BARS[ANCHOR_INDEX - 59].close);
        });

        it('keeps exactly the first 20 bars after the anchor as tuples', () => {
            expect(window.forward).toHaveLength(OUTCOME_WINDOW_BARS);
            const first = BARS[ANCHOR_INDEX + 1];
            expect(window.forward[0]).toEqual([
                first.time,
                first.open,
                first.high,
                first.low,
                first.close,
            ]);
            expect(window.forward.at(-1)?.[0]).toBe(
                BARS[ANCHOR_INDEX + OUTCOME_WINDOW_BARS].time
            );
        });

        it('survives a JSON round trip unchanged', () => {
            expect(JSON.parse(JSON.stringify(window))).toEqual(window);
        });
    });

    describe('anchor bar', () => {
        const expected = [
            ANCHOR_BAR.time,
            ANCHOR_BAR.open,
            ANCHOR_BAR.high,
            ANCHOR_BAR.low,
            ANCHOR_BAR.close,
        ];

        it('holds the final range of the anchor bar, closed or forming', () => {
            expect(okWindow(BARS, closedAnchor()).anchorBar).toEqual(expected);
            const forming = okWindow(BARS, {
                barTime: ANCHOR_TIME,
                closeAtAnalysis: 99,
                closedAtAnalysis: false,
            });
            expect(forming.anchorBar).toEqual(expected);
            expect(forming.referencePrice).toBe(99);
        });
    });

    describe('anchor source', () => {
        it('is prompt_bar when the analysis named the bar', () => {
            expect(okWindow(BARS, closedAnchor()).anchorSource).toBe(
                'prompt_bar'
            );
            expect(
                okWindow(BARS, {
                    barTime: ANCHOR_TIME,
                    closeAtAnalysis: 99,
                    closedAtAnalysis: false,
                }).anchorSource
            ).toBe('prompt_bar');
        });

        it('is generated_at when the bar was found from the generation time', () => {
            expect(
                okWindow(BARS, { generatedAtMs: ANCHOR_TIME * 1_000 })
                    .anchorSource
            ).toBe('generated_at');
        });
    });

    describe('where the anchor is', () => {
        it('reports a bar time no bar has as anchor_missing', () => {
            expect(
                buildOutcomeWindow(BARS, closedAnchor(100, ANCHOR_TIME + 1))
            ).toEqual({ status: 'anchor_missing' });
        });

        it('reports an empty series as anchor_missing', () => {
            expect(buildOutcomeWindow([], closedAnchor())).toEqual({
                status: 'anchor_missing',
            });
        });

        it('reports a generation time before the first bar as anchor_missing', () => {
            expect(buildOutcomeWindow(BARS, { generatedAtMs: 1_000 })).toEqual({
                status: 'anchor_missing',
            });
        });

        it('reports an anchor bar without usable prices as anchor_missing', () => {
            const broken = BARS.map((bar, i) =>
                i === ANCHOR_INDEX ? { ...bar, high: Number.NaN } : bar
            );
            expect(buildOutcomeWindow(broken, closedAnchor())).toEqual({
                status: 'anchor_missing',
            });
        });

        it('takes the bar a generation time falls in, as a bar that was still forming', () => {
            const generatedAtMs = (ANCHOR_TIME + SECONDS_PER_DAY / 2) * 1_000;
            const window = okWindow(BARS, { generatedAtMs });
            expect(window.anchorForming).toBe(true);
            expect(window.adjFactor).toBe(1);
            expect(window.referencePrice).toBe(ANCHOR_BAR.close);
            expect(window.forward[0][0]).toBe(BARS[ANCHOR_INDEX + 1].time);
        });

        it('takes the bar starting exactly at the generation time', () => {
            const window = okWindow(BARS, {
                generatedAtMs: ANCHOR_TIME * 1_000,
            });
            expect(window.forward[0][0]).toBe(BARS[ANCHOR_INDEX + 1].time);
        });
    });

    describe('forward bars', () => {
        it('accepts exactly the window length', () => {
            const bars = BARS.slice(0, ANCHOR_INDEX + 1 + OUTCOME_WINDOW_BARS);
            expect(okWindow(bars, closedAnchor()).forward).toHaveLength(
                OUTCOME_WINDOW_BARS
            );
        });

        it('reports one bar fewer as insufficient_forward with the count it has', () => {
            const bars = BARS.slice(0, ANCHOR_INDEX + OUTCOME_WINDOW_BARS);
            expect(buildOutcomeWindow(bars, closedAnchor())).toEqual({
                status: 'insufficient_forward',
                have: OUTCOME_WINDOW_BARS - 1,
                need: OUTCOME_WINDOW_BARS,
            });
        });

        it('reports an anchor on the last bar as having no forward bars', () => {
            expect(
                buildOutcomeWindow(
                    BARS.slice(0, ANCHOR_INDEX + 1),
                    closedAnchor()
                )
            ).toEqual({
                status: 'insufficient_forward',
                have: 0,
                need: OUTCOME_WINDOW_BARS,
            });
        });

        it('ends the usable run at a bar with a non-finite or non-positive price', () => {
            const broken = BARS.map((bar, i) =>
                i === ANCHOR_INDEX + 6 ? { ...bar, low: 0 } : bar
            );
            expect(buildOutcomeWindow(broken, closedAnchor())).toEqual({
                status: 'insufficient_forward',
                have: 5,
                need: OUTCOME_WINDOW_BARS,
            });
        });

        it.each([
            ['a high under the low', { high: 90, low: 95 }],
            ['an open over the high', { open: 500 }],
            ['an open under the low', { open: 0.5 }],
            ['a close over the high', { close: 500 }],
            ['a close under the low', { close: 0.5 }],
        ])('ends the usable run at a forward bar with %s', (_name, patch) => {
            const broken = BARS.map((bar, i) =>
                i === ANCHOR_INDEX + 4 ? { ...bar, ...patch } : bar
            );
            expect(buildOutcomeWindow(broken, closedAnchor())).toEqual({
                status: 'insufficient_forward',
                have: 3,
                need: OUTCOME_WINDOW_BARS,
            });
        });

        it('accepts a bar whose open and close sit exactly on the high and the low', () => {
            const edge = BARS.map((bar, i) =>
                i === ANCHOR_INDEX + 1
                    ? { ...bar, open: bar.low, close: bar.high }
                    : bar
            );
            expect(okWindow(edge, closedAnchor()).forward).toHaveLength(
                OUTCOME_WINDOW_BARS
            );
        });

        it.each([
            [
                'a duplicate time',
                (bar: Bar, prev: Bar) => ({ ...bar, time: prev.time }),
            ],
            [
                'an earlier time',
                (bar: Bar, prev: Bar) => ({ ...bar, time: prev.time - 1 }),
            ],
        ])('ends the usable run at a forward bar with %s', (_name, patch) => {
            const broken = BARS.map((bar, i) =>
                i === ANCHOR_INDEX + 7 ? patch(bar, BARS[i - 1]) : bar
            );
            expect(buildOutcomeWindow(broken, closedAnchor())).toEqual({
                status: 'insufficient_forward',
                have: 6,
                need: OUTCOME_WINDOW_BARS,
            });
        });

        it('does not take a forward bar that repeats the anchor time as a later bar', () => {
            // The lookup lands on the repeat, whose prefix then holds a duplicate time.
            const broken = BARS.map((bar, i) =>
                i === ANCHOR_INDEX + 1 ? { ...bar, time: ANCHOR_TIME } : bar
            );
            expect(buildOutcomeWindow(broken, closedAnchor())).toEqual({
                status: 'anchor_missing',
            });
        });

        it('ignores a broken bar beyond the window', () => {
            const broken = BARS.map((bar, i) =>
                i === ANCHOR_INDEX + OUTCOME_WINDOW_BARS + 1
                    ? { ...bar, close: Number.NaN }
                    : bar
            );
            expect(okWindow(broken, closedAnchor()).forward).toHaveLength(
                OUTCOME_WINDOW_BARS
            );
        });
    });

    describe('bars before the anchor', () => {
        const brokenAt = (at: number, bars: readonly Bar[] = BARS) =>
            bars.map((bar, i) =>
                i === at ? { ...bar, high: 0, low: 0 } : bar
            );
        // The window reads the 60 bars up to and including the anchor: indexes 11..70.
        const FIRST_READ = ANCHOR_INDEX - (OUTCOME_PRE_BARS - 1);

        it('ignores a malformed bar before the bars the window reads', () => {
            expect(
                okWindow(brokenAt(FIRST_READ - 1), closedAnchor()).atr
            ).toBeCloseTo(2, 10);
        });

        it('ignores a malformed bar 200 bars before the anchor', () => {
            const long = risingBars(300);
            const anchor = long[250];
            const window = okWindow(brokenAt(40, long), {
                barTime: anchor.time,
                closeAtAnalysis: anchor.close,
                closedAtAnalysis: true,
            });
            expect(window.preCloses).toHaveLength(OUTCOME_PRE_BARS);
            expect(window.atr).toBeCloseTo(2, 10);
        });

        it('ignores times out of order before the bars the window reads', () => {
            const unordered = BARS.map((bar, i) =>
                i === 5 ? { ...bar, time: BARS[4].time } : bar
            );
            expect(okWindow(unordered, closedAnchor()).forward).toHaveLength(
                OUTCOME_WINDOW_BARS
            );
        });

        it.each([
            ['the first bar of the pre-window', FIRST_READ],
            ['a bar in the middle of it', 40],
        ])('distrusts a series with an unusable bar at %s', (_name, at) => {
            expect(buildOutcomeWindow(brokenAt(at), closedAnchor())).toEqual({
                status: 'anchor_missing',
            });
        });

        it.each([
            [
                'a duplicate time',
                40,
                (bar: Bar, prev: Bar) => ({ ...bar, time: prev.time }),
            ],
            [
                'a time out of order',
                30,
                (bar: Bar, prev: Bar) => ({ ...bar, time: prev.time - 5 }),
            ],
        ])(
            'distrusts a series with %s inside the pre-window',
            (_name, at, patch) => {
                const broken = BARS.map((bar, i) =>
                    i === at ? patch(bar, BARS[i - 1]) : bar
                );
                expect(buildOutcomeWindow(broken, closedAnchor())).toEqual({
                    status: 'anchor_missing',
                });
            }
        );

        it('reads and validates every earlier bar when fewer than the pre-window exist', () => {
            const anchor = BARS[30];
            const spec = {
                barTime: anchor.time,
                closeAtAnalysis: anchor.close,
                closedAtAnalysis: true,
            };
            expect(okWindow(BARS, spec).preCloses).toHaveLength(31);
            expect(buildOutcomeWindow(brokenAt(5), spec)).toEqual({
                status: 'anchor_missing',
            });
        });

        it('computes the ATR from the pre-window alone', () => {
            const window = okWindow(BARS, closedAnchor());
            expect(window.atr).toBe(
                calculateATR(BARS.slice(FIRST_READ, ANCHOR_INDEX + 1)).at(-1)
            );
        });
    });

    describe('pre-anchor closes', () => {
        it('keeps all of them when fewer than 60 exist, and has no ATR below the warm-up', () => {
            const window = okWindow(
                risingBars(10 + 1 + OUTCOME_WINDOW_BARS),
                closedAnchor(40, 11 * SECONDS_PER_DAY)
            );
            expect(window.preCloses).toHaveLength(11);
            expect(window.atr).toBeNull();
        });
    });

    describe('corporate-action adjustment of a closed anchor', () => {
        it.each([
            ['an exact match', 100, 1],
            [
                'rounding noise just inside the epsilon',
                100 / (1 + 0.9 * ADJ_FACTOR_EPSILON),
                1,
            ],
            ['a 4:1 split (analysis saw 4x today)', 400, 0.25],
            ['a 0.6% dividend adjustment', 100 / 0.994, 0.994],
            [
                'a drift just outside the epsilon',
                100 / (1 + 1.5 * ADJ_FACTOR_EPSILON),
                1 + 1.5 * ADJ_FACTOR_EPSILON,
            ],
            ['the lowest plausible factor', 5_000, 0.02],
            ['the highest plausible factor', 2, 50],
        ])('%s', (_label, closeAtAnalysis, expectedFactor) => {
            const window = okWindow(BARS, closedAnchor(closeAtAnalysis));
            expect(window.adjFactor).toBeCloseTo(expectedFactor, 12);
            expect(window.anchorForming).toBe(false);
            expect(window.referencePrice).toBe(100);
        });

        it('treats the two doubles around the epsilon on either side of it as rounding and as an adjustment', () => {
            // `|ratio - 1|` is a multiple of 2^-52 and the epsilon is not, so the ratio can
            // never equal it exactly: pin the nearest representable ratios on both sides.
            const ulp = 2 ** -52;
            const below = 1 + Math.floor(ADJ_FACTOR_EPSILON / ulp) * ulp;
            const above = 1 + (Math.floor(ADJ_FACTOR_EPSILON / ulp) + 1) * ulp;
            const barsAt = (close: number) =>
                BARS.map((bar, i) =>
                    i === ANCHOR_INDEX
                        ? {
                              ...bar,
                              open: close,
                              high: close,
                              low: close,
                              close,
                          }
                        : bar
                );
            expect(below - 1).toBeLessThanOrEqual(ADJ_FACTOR_EPSILON);
            expect(above - 1).toBeGreaterThan(ADJ_FACTOR_EPSILON);
            expect(okWindow(barsAt(below), closedAnchor(1)).adjFactor).toBe(1);
            expect(okWindow(barsAt(above), closedAnchor(1)).adjFactor).toBe(
                above
            );
        });

        it('uses today close as the reference price, not the analysis one', () => {
            expect(okWindow(BARS, closedAnchor(400)).referencePrice).toBe(100);
        });

        it.each([
            ['below the lowest plausible factor', 5_025],
            ['above the highest plausible factor', 1.9],
            ['a close that is not positive', 0],
            ['a close that is not finite', Number.NaN],
        ])('reports %s as anchor_mismatch', (_label, closeAtAnalysis) => {
            const result = buildOutcomeWindow(
                BARS,
                closedAnchor(closeAtAnalysis)
            );
            expect(result.status).toBe('anchor_mismatch');
        });

        it('reports a factor that is not finite as null, which survives JSON', () => {
            const result = buildOutcomeWindow(BARS, closedAnchor(0));
            expect(result).toEqual({ status: 'anchor_mismatch', factor: null });
            expect(JSON.parse(JSON.stringify(result))).toEqual(result);
            const nan = buildOutcomeWindow(BARS, closedAnchor(Number.NaN));
            expect(nan).toEqual({ status: 'anchor_mismatch', factor: null });
        });

        it('carries the offending factor', () => {
            expect(buildOutcomeWindow(BARS, closedAnchor(5_025))).toEqual({
                status: 'anchor_mismatch',
                factor: 100 / 5_025,
            });
        });

        it('reports a mismatch before it reports missing forward bars', () => {
            const short = BARS.slice(0, ANCHOR_INDEX + 5);
            expect(buildOutcomeWindow(short, closedAnchor(5_025)).status).toBe(
                'anchor_mismatch'
            );
        });
    });

    describe('an anchor that was still forming at analysis time', () => {
        const forming: OutcomeAnchor = {
            barTime: ANCHOR_TIME,
            closeAtAnalysis: 98.5,
            closedAtAnalysis: false,
        };
        const window = okWindow(BARS, forming);

        it('cannot verify an adjustment, so it assumes none', () => {
            expect(window.adjFactor).toBe(1);
            expect(window.anchorForming).toBe(true);
        });

        it('measures from the close seen at analysis time, in the closes too', () => {
            expect(window.referencePrice).toBe(98.5);
            expect(window.preCloses.at(-1)).toBe(98.5);
            expect(window.preCloses.at(-2)).toBe(BARS[ANCHOR_INDEX - 1].close);
        });

        it('keeps the factor at 1 for a small adjustment it cannot correct (a dividend)', () => {
            const dividend = okWindow(BARS, {
                ...forming,
                closeAtAnalysis: 100 / 0.994,
            });
            expect(dividend.adjFactor).toBe(1);
            expect(dividend.anchorForming).toBe(true);
        });

        it('reports a jump of price basis (a 4:1 split) as anchor_mismatch', () => {
            expect(
                buildOutcomeWindow(BARS, { ...forming, closeAtAnalysis: 400 })
            ).toEqual({ status: 'anchor_mismatch', factor: 0.25 });
        });

        describe('the close seen against the final range of the anchor bar', () => {
            // Final range 100 +/- 1 around close 100; tolerance is 1% of the edge price.
            const withRange = (low: number, high: number) =>
                BARS.map((bar, i) =>
                    i === ANCHOR_INDEX
                        ? { ...bar, open: low, high, low, close: high }
                        : bar
                );
            const seen = (low: number, high: number, closeAtAnalysis: number) =>
                buildOutcomeWindow(withRange(low, high), {
                    ...forming,
                    closeAtAnalysis,
                });

            it.each([
                ['inside the range', 100, 99.5, 101, 'ok'],
                [
                    'just under the low, inside the tolerance',
                    99.5 * 0.994,
                    99.5,
                    101,
                    'ok',
                ],
                [
                    'under the low by more than the tolerance',
                    99.5 * 0.98,
                    99.5,
                    101,
                    'anchor_mismatch',
                ],
                [
                    'just over the high, inside the tolerance',
                    101 * 1.006,
                    99.5,
                    101,
                    'ok',
                ],
                [
                    'over the high by more than the tolerance',
                    101 * 1.02,
                    99.5,
                    101,
                    'anchor_mismatch',
                ],
                [
                    '101 against a final range of 102.5-105',
                    101,
                    102.5,
                    105,
                    'anchor_mismatch',
                ],
                [
                    '100 against a range of about 123-127 after a 4:5 reverse split',
                    100,
                    123,
                    127,
                    'anchor_mismatch',
                ],
            ])('%s', (_name, closeAtAnalysis, low, high, status) => {
                expect(seen(low, high, closeAtAnalysis).status).toBe(status);
            });

            it('treats the two doubles around each tolerance edge as inside and outside', () => {
                const lowEdge = 100 * (1 - ANCHOR_FORMING_REF_TOLERANCE);
                const highEdge = 100 * (1 + ANCHOR_FORMING_REF_TOLERANCE);
                const down = (x: number) => x - Math.abs(x) * Number.EPSILON;
                const up = (x: number) => x + Math.abs(x) * Number.EPSILON;
                expect(seen(100, 100, lowEdge).status).toBe('ok');
                expect(seen(100, 100, down(lowEdge)).status).toBe(
                    'anchor_mismatch'
                );
                expect(seen(100, 100, highEdge).status).toBe('ok');
                expect(seen(100, 100, up(highEdge)).status).toBe(
                    'anchor_mismatch'
                );
            });

            it('reports the usual factor on a mismatch', () => {
                expect(seen(102.5, 105, 101)).toEqual({
                    status: 'anchor_mismatch',
                    factor: 105 / 101,
                });
            });
        });

        it.each([
            ['the lower edge of the band', 67, 'ok'],
            ['just under the lower edge', 66.9, 'anchor_mismatch'],
            ['the upper edge of the band', 150, 'ok'],
            ['just over the upper edge', 150.1, 'anchor_mismatch'],
        ])(
            '%s: bar close against the analysis close of 100',
            (_name, barClose, status) => {
                const bars = BARS.map((bar, i) =>
                    i === ANCHOR_INDEX
                        ? {
                              ...bar,
                              // A very wide final range, so the close seen (100) lies inside
                              // it and only the ratio band is under test.
                              open: barClose,
                              high: 1000,
                              low: 1,
                              close: barClose,
                          }
                        : bar
                );
                expect(
                    buildOutcomeWindow(bars, {
                        ...forming,
                        closeAtAnalysis: 100,
                    }).status
                ).toBe(status);
            }
        );

        it('rejects a close the analysis cannot have seen', () => {
            expect(
                buildOutcomeWindow(BARS, { ...forming, closeAtAnalysis: 0 })
                    .status
            ).toBe('anchor_mismatch');
        });
    });
});
