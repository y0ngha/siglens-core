import { describe, it, expect } from 'vitest';
import type { Bar } from '@/domain/types';
import { extractPivots } from '@/domain/patterns/pivots';
import { PIVOT_REVERSAL_ATR_MULT } from '@/domain/patterns/constants';
import { makeBars, makeHLBars } from '@/__tests__/domain/patterns/helpers';

const ATR = 1;

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

    it('onePivotPerBar: 넓은 bar 하나가 고점·저점 피벗 둘이 되지 않는다 (자기 저점을 확정하면 고점은 다음 bar부터)', () => {
        const bars = makeHLBars([
            [10, 10], // idx0: seed
            [
                10 - PIVOT_REVERSAL_ATR_MULT * ATR,
                10 - PIVOT_REVERSAL_ATR_MULT * ATR,
            ], // idx1: 'down'
            [20, 2], // idx2: confirms its own low; its high 20 is not a swing
            [19, 19], // idx3
            [18, 17], // idx4: 19 − 17 ≥ 1.5 confirms the high at idx3
        ]);
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
            const bars = makeHLBars([
                [10, 10], // idx0: seed
                [
                    10 - PIVOT_REVERSAL_ATR_MULT * ATR,
                    10 - PIVOT_REVERSAL_ATR_MULT * ATR,
                ], // idx1: establishes 'down' direction
                [20, 2], // idx2: gap bar → confirms its own low
                [19, 19], // idx3: first bar of the up leg
            ]);
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
            const bars = makeHLBars([
                [10, 10],
                [
                    10 - PIVOT_REVERSAL_ATR_MULT * ATR,
                    10 - PIVOT_REVERSAL_ATR_MULT * ATR,
                ],
                [20, 2],
            ]);
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
});
