import { describe, it, expect } from 'vitest';
import type { Bar } from '@/domain/types';
import { extractPivots } from '@/domain/patterns/pivots';
import { PIVOT_REVERSAL_ATR_MULT } from '@/domain/patterns/constants';
import { makeBars, makeHLBars } from '@/__tests__/domain/patterns/helpers';
import { calculateATR } from '@/domain/indicators/atr';
import { chartFixture } from '@/__tests__/domain/patterns/fixtures/chartFixture';
import wideBarFile from '@/__tests__/domain/patterns/fixtures/charts/daily-wide-bar-opened-in-far-half.json';

const ATR = 1;
const confirmedHigh = (price: number, index: number) => ({
    index,
    price,
    kind: 'high' as const,
});
const confirmedLow = (price: number, index: number) => ({
    index,
    price,
    kind: 'low' as const,
});

/**
 * `makeHLBars` closes every bar on its low, so a wide bar there proves no
 * low reversal by its close. Moves one bar's close to its high: a close that
 * proves a swing low (the bar then confirms its own low).
 */
const closeAtHigh = (bars: Bar[], index: number): Bar[] =>
    bars.map((b, i) => (i === index ? { ...b, close: b.high } : b));

describe('extractPivots', () => {
    it('V자 형태에서 저점 하나만 확정한다', () => {
        const bars = makeBars([10, 9, 8, 7, 8, 9, 10, 11]);
        const pivots = extractPivots(bars, 0.5);
        expect(pivots).toEqual([{ index: 3, price: 6.95, kind: 'low' }]);
    });

    it('임계값보다 작은 노이즈는 피벗으로 확정하지 않는다', () => {
        const bars = makeBars([10, 9.9, 10, 9.9, 10]);
        const pivots = extractPivots(bars, 0.5);
        expect(pivots).toEqual([]);
    });

    it('여러 스윙이 있으면 고점/저점이 인덱스 순서로 번갈아 확정된다', () => {
        const closes = [
            10,
            11,
            12,
            13,
            14,
            15, // 0-5: up to 15
            14,
            13,
            12,
            11,
            10,
            9,
            8, // 6-12: down to 8
            9,
            10,
            11,
            12,
            13,
            14, // 13-18: up to 14
            13,
            12,
            11,
            10,
            9, // 19-23: down to 9
        ];
        const bars = makeBars(closes);
        const pivots = extractPivots(bars, ATR);

        expect(pivots).toEqual([
            { index: 5, price: 15.05, kind: 'high' },
            { index: 12, price: 7.95, kind: 'low' },
            { index: 18, price: 14.05, kind: 'high' },
        ]);

        // Alternates strictly and stays in ascending index order.
        for (let i = 1; i < pivots.length; i++) {
            expect(pivots[i].index).toBeGreaterThan(pivots[i - 1].index);
            expect(pivots[i].kind).not.toBe(pivots[i - 1].kind);
        }
    });

    it('빈 배열이면 빈 배열을 반환한다', () => {
        expect(extractPivots([], 0.5)).toEqual([]);
    });

    it('단일 bar면 빈 배열을 반환한다', () => {
        const bars = makeBars([10]);
        expect(extractPivots(bars, 0.5)).toEqual([]);
    });

    it('atr가 0이면 빈 배열을 반환한다', () => {
        const bars = makeBars([10, 9, 8, 7, 8, 9, 10, 11]);
        expect(extractPivots(bars, 0)).toEqual([]);
    });

    it('atr가 음수면 빈 배열을 반환한다', () => {
        const bars = makeBars([10, 9, 8, 7, 8, 9, 10, 11]);
        expect(extractPivots(bars, -1)).toEqual([]);
    });

    it('입력 bars 배열을 변경하지 않는다', () => {
        const bars = makeBars([10, 9, 8, 7, 8, 9, 10, 11]);
        const snapshot = JSON.parse(JSON.stringify(bars));
        extractPivots(bars, 0.5);
        expect(bars).toEqual(snapshot);
    });

    it('되돌림이 정확히 임계값과 같으면 확정한다 (>= 경계)', () => {
        // atr=ATR(1) → threshold=PIVOT_REVERSAL_ATR_MULT(1.5). High pivot
        // confirms at index 2 (price 14) because runningHigh(14) -
        // bar.low(12.5) === 1.5 exactly.
        const bars = makeHLBars([
            [10, 10], // idx0: seed
            [13, 13], // idx1: establishes 'up' direction (13-10=3 >= PIVOT_REVERSAL_ATR_MULT(1.5))
            [14, 14], // idx2: new running high
            [
                14 - PIVOT_REVERSAL_ATR_MULT * ATR,
                14 - PIVOT_REVERSAL_ATR_MULT * ATR,
            ], // idx3: retraces exactly threshold → confirms
        ]);
        const pivots = extractPivots(bars, ATR);
        expect(pivots).toEqual([{ index: 2, price: 14, kind: 'high' }]);
    });

    it('한 bar 안에서 극값 갱신과 방향 전환이 동시에 일어나는 갭 bar를 처리한다', () => {
        // atr=ATR(1) → threshold=PIVOT_REVERSAL_ATR_MULT(1.5). idx2 is a
        // single wide-range bar that both sets the new running low (2) AND
        // triggers the up-flip in the same iteration (bar.high 20 -
        // runningLow 2 = 18 >= PIVOT_REVERSAL_ATR_MULT(1.5)).
        const bars = makeHLBars([
            [10, 10], // idx0: seed
            [
                10 - PIVOT_REVERSAL_ATR_MULT * ATR,
                10 - PIVOT_REVERSAL_ATR_MULT * ATR,
            ], // idx1: establishes 'down' direction (10-8.5=1.5 >= PIVOT_REVERSAL_ATR_MULT(1.5))
            [20, 2], // idx2: gap bar — sets extreme + flips in one bar
        ]);
        const pivots = extractPivots(bars, ATR);
        expect(pivots).toEqual([{ index: 2, price: 2, kind: 'low' }]);
    });

    it('onePivotPerBar: 넓은 bar 하나가 고점·저점 피벗 둘이 되지 않는다 (종가가 자기 저점을 확정하면 고점은 다음 bar부터)', () => {
        const bars = closeAtHigh(
            makeHLBars([
                [10, 10], // idx0: seed
                [
                    10 - PIVOT_REVERSAL_ATR_MULT * ATR,
                    10 - PIVOT_REVERSAL_ATR_MULT * ATR,
                ], // idx1: 'down'
                [20, 2], // idx2: confirms its own low; its high 20 is not a swing
                [19, 19], // idx3
                [18, 17], // idx4: 19 − 17 ≥ 1.5 confirms the high at idx3
            ]),
            2
        );
        expect(extractPivots(bars, ATR, { onePivotPerBar: true })).toEqual([
            { index: 2, price: 2, kind: 'low' },
            { index: 3, price: 19, kind: 'high' },
        ]);
    });

    it('기본(원래 zigzag)은 같은 넓은 bar를 고점·저점 피벗 둘로 둔다 — 오버레이 빌더가 측정된 동작', () => {
        const bars = makeHLBars([
            [10, 10],
            [
                10 - PIVOT_REVERSAL_ATR_MULT * ATR,
                10 - PIVOT_REVERSAL_ATR_MULT * ATR,
            ],
            [20, 2],
            [19, 19],
            [18, 17],
        ]);
        expect(extractPivots(bars, ATR)).toEqual([
            { index: 2, price: 2, kind: 'low' },
            { index: 2, price: 20, kind: 'high' },
        ]);
    });

    it('동률 고점은 먼저 나온 인덱스를 유지한다', () => {
        // atr=ATR(1) → threshold=PIVOT_REVERSAL_ATR_MULT(1.5). idx1 and idx2
        // both have high=13; the strict `>` comparison means idx2 does NOT
        // overwrite runningHighIndex, so the confirmed pivot must report
        // index 1, not 2.
        const bars = makeHLBars([
            [10, 10], // idx0: seed
            [13, 13], // idx1: establishes 'up' direction, running high = 13
            [13, 13], // idx2: ties the running high — must NOT become the pivot index
            [13, 13 - PIVOT_REVERSAL_ATR_MULT * ATR], // idx3: retraces exactly threshold → confirms
        ]);
        const pivots = extractPivots(bars, ATR);
        expect(pivots).toEqual([{ index: 1, price: 13, kind: 'high' }]);
    });

    describe('per-bar ATR series', () => {
        // A rise to 12 (idx1), then a 2-point drop at idx2: confirms the
        // high only if the ATR AT idx2 makes the threshold ≤ 2.
        const bars = makeHLBars([
            [10, 10],
            [12, 12],
            [10, 10],
            [11, 11],
        ]);

        it('confirms with the ATR at the confirming bar', () => {
            expect(extractPivots(bars, [1, 1, 1, 9])).toEqual([
                { index: 1, price: 12, kind: 'high' },
            ]);
        });

        it('does not confirm when the ATR at that bar makes the reversal too small, whatever the ATR later', () => {
            expect(extractPivots(bars, [1, 1, 2, 1])).toEqual([]);
        });

        it('warm-up bars (null) use the first ATR in the series', () => {
            expect(extractPivots(bars, [null, null, null, 1])).toEqual([
                { index: 1, price: 12, kind: 'high' },
            ]);
            expect(extractPivots(bars, [null, null, null, 2])).toEqual([]);
        });

        it("a gap mid-series (null) reuses the previous bar's ATR, not the first one", () => {
            // First value 2 (threshold 3) would not confirm the 2-point drop
            // at idx2; the previous bar's 1 (threshold 1.5) does.
            expect(extractPivots(bars, [2, 1, null, 2])).toEqual([
                { index: 1, price: 12, kind: 'high' },
            ]);
        });

        it('a series with no ATR at all confirms nothing', () => {
            expect(extractPivots(bars, [null, null, null, null])).toEqual([]);
        });
    });

    describe('includeProvisional', () => {
        it('마지막 확정 피벗과 동일 인덱스면 추가하지 않는다 (원래 zigzag)', () => {
            // idx2 confirms its own low and becomes the running high (20)
            // in the same iteration; idx3 only ties it, so the provisional
            // high would sit on the confirmed low's own bar.
            const bars = makeHLBars([
                [10, 10],
                [
                    10 - PIVOT_REVERSAL_ATR_MULT * ATR,
                    10 - PIVOT_REVERSAL_ATR_MULT * ATR,
                ],
                [20, 2],
                [20, 20],
            ]);
            expect(
                extractPivots(bars, ATR, { includeProvisional: true })
            ).toEqual([{ index: 2, price: 2, kind: 'low' }]);
        });

        it('진행 중인 극값을 마지막 피벗으로 추가한다 (V자 → 마지막 인덱스의 고점)', () => {
            const bars = makeBars([10, 9, 8, 7, 8, 9, 10, 11]);

            const confirmedOnly = extractPivots(bars, 0.5);
            expect(confirmedOnly).toEqual([
                { index: 3, price: 6.95, kind: 'low' },
            ]);

            const withProvisional = extractPivots(bars, 0.5, {
                includeProvisional: true,
            });
            expect(withProvisional).toEqual([
                { index: 3, price: 6.95, kind: 'low' },
                { index: 7, price: 11.05, kind: 'high' },
            ]);
        });

        it('기본값(옵션 미지정)은 진행 중인 극값을 생략한다', () => {
            const bars = makeBars([10, 9, 8, 7, 8, 9, 10, 11]);
            expect(extractPivots(bars, 0.5)).toEqual(
                extractPivots(bars, 0.5, { includeProvisional: false })
            );
        });

        it('onePivotPerBar: 자기 저점을 확정한 넓은 bar의 고점은 잠정 피벗이 되지 않는다 — 다음 bar부터 센다', () => {
            // atr=ATR(1) → threshold=PIVOT_REVERSAL_ATR_MULT(1.5). idx2 is
            // the gap bar from the earlier test: it confirms its own low.
            // The up leg starts on idx3, so the provisional high is idx3's,
            // never idx2's own high (one pivot per bar).
            const bars = closeAtHigh(
                makeHLBars([
                    [10, 10], // idx0: seed
                    [
                        10 - PIVOT_REVERSAL_ATR_MULT * ATR,
                        10 - PIVOT_REVERSAL_ATR_MULT * ATR,
                    ], // idx1: establishes 'down' direction
                    [20, 2], // idx2: gap bar → its close confirms its own low
                    [19, 19], // idx3: first bar of the up leg
                ]),
                2
            );
            expect(
                extractPivots(bars, ATR, {
                    includeProvisional: true,
                    onePivotPerBar: true,
                })
            ).toEqual([
                { index: 2, price: 2, kind: 'low' },
                { index: 3, price: 19, kind: 'high' },
            ]);
        });

        it('onePivotPerBar: 마지막 bar가 자기 극값을 확정했으면 잠정 피벗이 없다', () => {
            const bars = closeAtHigh(
                makeHLBars([
                    [10, 10],
                    [
                        10 - PIVOT_REVERSAL_ATR_MULT * ATR,
                        10 - PIVOT_REVERSAL_ATR_MULT * ATR,
                    ],
                    [20, 2],
                ]),
                2
            );
            expect(
                extractPivots(bars, ATR, {
                    includeProvisional: true,
                    onePivotPerBar: true,
                })
            ).toEqual([{ index: 2, price: 2, kind: 'low' }]);
        });
    });

    describe('onePivotPerBar: an outside reversal bar', () => {
        const bar = (
            open: number,
            high: number,
            low: number,
            close: number
        ): Bar => ({ time: 0, open, high, low, close, volume: 1000 });
        const series = (bars: Bar[]): Bar[] =>
            bars.map((b, i) => ({ ...b, time: i }));
        const opts = { onePivotPerBar: true };
        // h1 13, a down leg to 11 (idx2), then a green bar that dips under 11
        // and rallies over 13 — the leg's low (idx2) is the swing low and the
        // bar's high the next swing high.
        const withDip = (dip: number): Bar[] =>
            series([
                bar(10, 10, 10, 10),
                bar(13, 13, 13, 13),
                bar(11, 11, 11, 11),
                bar(10.9, 13.5, dip, 13.4),
                bar(12, 12, 12, 12),
            ]);

        it('keeps the earlier low and takes the bar high as the swing high when the dip stays within the containment slack', () => {
            expect(extractPivots(withDip(10.8), ATR, opts)).toEqual([
                { index: 1, price: 13, kind: 'high' },
                { index: 2, price: 11, kind: 'low' },
                { index: 3, price: 13.5, kind: 'high' },
            ]);
        });

        it('lets the bar confirm its own deeper low when the dip goes past the slack', () => {
            expect(extractPivots(withDip(10.6), ATR, opts)).toEqual([
                { index: 1, price: 13, kind: 'high' },
                { index: 3, price: 10.6, kind: 'low' },
            ]);
        });
    });

    describe("onePivotPerBar: a reversal on the extreme's own bar counts only the close", () => {
        const T = PIVOT_REVERSAL_ATR_MULT * ATR;
        const opts = { onePivotPerBar: true };
        const bar = (
            open: number,
            high: number,
            low: number,
            close: number
        ): Bar => ({ time: 0, open, high, low, close, volume: 1000 });
        const series = (bars: Bar[]): Bar[] =>
            bars.map((b, i) => ({ ...b, time: i }));
        // Mirrors a series through 0 (high <-> low), turning an up leg into a
        // down leg: every rule has a mirror and each is tested.
        const mirror = (bars: Bar[]): Bar[] =>
            bars.map(b => ({
                ...b,
                open: -b.open,
                high: -b.low,
                low: -b.high,
                close: -b.close,
            }));
        // idx0/idx1 establish the up leg (10 → 13). idx2 sets the high 14 and
        // its range spans 1.6 (>= T); `close` decides whether the bar itself
        // proves the reversal.
        const upLeg = (close: number): Bar[] => [
            bar(10, 10, 10, 10),
            bar(13, 13, 13, 13),
            bar(12.5, 14, 12.4, close),
        ];

        it("the close does not prove the reversal: the bar alone confirms nothing, the next bar's low confirms it", () => {
            const wide = upLeg(14 - T + 0.01);
            expect(extractPivots(series(wide), ATR, opts)).toEqual([]);
            expect(
                extractPivots(
                    series([...wide, bar(13.5, 13.6, 14 - T - 0.1, 12.6)]),
                    ATR,
                    opts
                )
            ).toEqual([confirmedHigh(14, 2)]);
        });

        it('the original zigzag still confirms the same bar by its range (byte-identical default)', () => {
            expect(extractPivots(series(upLeg(14 - T + 0.01)), ATR)).toEqual([
                confirmedHigh(14, 2),
            ]);
        });

        it('the close proves the reversal exactly at the threshold: the bar confirms its own high', () => {
            expect(extractPivots(series(upLeg(14 - T)), ATR, opts)).toEqual([
                confirmedHigh(14, 2),
            ]);
        });

        it('a close-proven bar starts the opposite leg on the next bar: its own low is no pivot', () => {
            const bars = series([
                ...upLeg(14 - T),
                bar(13, 13.4, 12.7, 12.9), // starts the down leg
                bar(12, 12.2, 11.5, 11.6), // 11.5 is the low so far
                bar(12.5, 13.2, 12.4, 13.1), // 13.2 − 11.5 ≥ T confirms it
            ]);
            expect(extractPivots(bars, ATR, opts)).toEqual([
                confirmedHigh(14, 2),
                confirmedLow(11.5, 4),
            ]);
        });

        it('a next bar that exceeds the extreme becomes the pivot instead', () => {
            const next = (close: number): Bar => bar(13.9, 14.5, 12.8, close);
            const wide = upLeg(14 - T + 0.01);
            // 14.5 − 13.0 = T: the new bar proves its own reversal.
            expect(
                extractPivots(series([...wide, next(14.5 - T)]), ATR, opts)
            ).toEqual([confirmedHigh(14.5, 3)]);
            // One cent less and the new high is not confirmed yet either.
            expect(
                extractPivots(
                    series([...wide, next(14.5 - T + 0.01)]),
                    ATR,
                    opts
                )
            ).toEqual([]);
        });

        it('the same rules hold for a down leg (mirror)', () => {
            const wide = mirror(upLeg(14 - T + 0.01));
            const next = mirror([bar(13.5, 13.6, 14 - T - 0.1, 12.6)]);
            expect(extractPivots(series(wide), ATR, opts)).toEqual([]);
            expect(
                extractPivots(series([...wide, ...next]), ATR, opts)
            ).toEqual([confirmedLow(-14, 2)]);
            expect(
                extractPivots(series(mirror(upLeg(14 - T))), ATR, opts)
            ).toEqual([confirmedLow(-14, 2)]);
            expect(
                extractPivots(
                    series([
                        ...mirror(upLeg(14 - T)),
                        mirror([bar(13, 13.4, 12.7, 12.9)])[0],
                        mirror([bar(12, 12.2, 11.5, 11.6)])[0],
                        mirror([bar(12.5, 13.2, 12.4, 13.1)])[0],
                    ]),
                    ATR,
                    opts
                )
            ).toEqual([confirmedLow(-14, 2), confirmedHigh(-11.5, 4)]);
        });

        describe('the seed step', () => {
            // idx0 flat at 10; idx1 sets the extreme high 11 AND low 9.4 (range
            // 1.6 >= T); `close` decides whether the bar proves a reversal.
            const seedBars = (close: number): Bar[] =>
                series([bar(10, 10, 10, 10), bar(10.5, 11, 9.4, close)]);
            const seeded = { onePivotPerBar: true, includeProvisional: true };

            it('does not seed a direction from a range its close does not prove', () => {
                expect(extractPivots(seedBars(10.6), ATR, seeded)).toEqual([]);
            });

            it('the original zigzag seeds from the same range', () => {
                expect(
                    extractPivots(seedBars(10.6), ATR, {
                        includeProvisional: true,
                    })
                ).toEqual([confirmedLow(9.4, 1)]);
            });

            it('seeds a down leg when the close proves the high reversal', () => {
                expect(extractPivots(seedBars(11 - T), ATR, seeded)).toEqual([
                    confirmedLow(9.4, 1),
                ]);
            });

            it('seeds an up leg when the close proves the low reversal (mirror)', () => {
                expect(
                    extractPivots(series(mirror(seedBars(11 - T))), ATR, seeded)
                ).toEqual([confirmedHigh(-9.4, 1)]);
            });
        });

        it('an outside reversal confirms the earlier extreme whatever the bar close does', () => {
            // idx3 dips 0.2 under the leg low 11 (inside the slack) and runs
            // to 13.5, closing back at 11.2: its close proves no reversal,
            // its far end confirms the EARLIER bar's extreme.
            const bars = series([
                bar(10, 10, 10, 10),
                bar(13, 13, 13, 13),
                bar(11, 11, 11, 11),
                bar(11, 13.5, 10.8, 11.2),
                bar(12, 12, 12, 12),
            ]);
            expect(extractPivots(bars, ATR, opts)).toEqual([
                confirmedHigh(13, 1),
                confirmedLow(11, 2),
                confirmedHigh(13.5, 3),
            ]);
        });
    });

    describe('onePivotPerBar: a real wide bar that opened in its far half', () => {
        // Daily bars of a real chart, anonymized (see `chartFixture`):
        // idx30 (open 156.09, high 161.27, low 155.93, close 159.97) opened
        // at its low and spans 1.6 ATR, so the old rule confirmed its high on
        // its own bar although the close only proves 1.3 of the 5.0 needed.
        // The next bar prints a higher high (161.83), which is the swing
        // high; the old extractor kept 30 and, between 2 and 19, also listed
        // a 10 high / 12 low pair the proof rule no longer confirms.
        const fixture = chartFixture(wideBarFile);
        const ORIGINAL = [
            confirmedLow(137.8295, 2),
            confirmedHigh(156.5504, 10),
            confirmedLow(151.3532, 10),
            confirmedHigh(158.1364, 19),
            confirmedLow(148.84, 24),
            confirmedHigh(161.2718, 30),
            confirmedLow(155.9343, 30),
            confirmedHigh(161.8269, 31),
            confirmedLow(155.8123, 32),
            confirmedHigh(169.1652, 39),
            confirmedLow(162.4125, 40),
            confirmedHigh(168.787, 48),
            confirmedLow(161.8452, 51),
            confirmedHigh(168.0123, 53),
            confirmedLow(162.0587, 54),
        ];
        const atr = calculateATR(fixture.bars);

        it('keeps the swing high on the bar that exceeds it, and unchanged everywhere else', () => {
            expect(
                extractPivots(fixture.bars, atr, { onePivotPerBar: true })
            ).toEqual([
                confirmedLow(137.8295, 2),
                confirmedHigh(158.1364, 19),
                confirmedLow(148.84, 24),
                confirmedHigh(161.8269, 31),
                confirmedLow(155.8123, 32),
                confirmedHigh(169.1652, 39),
                confirmedLow(162.4125, 40),
                confirmedHigh(168.787, 48),
                confirmedLow(161.8452, 51),
                confirmedHigh(168.0123, 53),
                confirmedLow(162.0587, 54),
            ]);
        });

        it('the original zigzag on the same bars is unchanged (bar 30 is still both a high and a low)', () => {
            expect(extractPivots(fixture.bars, atr)).toEqual(ORIGINAL);
        });
    });
});
