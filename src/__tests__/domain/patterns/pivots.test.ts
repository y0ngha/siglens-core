import { describe, it, expect } from 'vitest';
import type { Bar } from '@/domain/types';
import { extractPivots } from '@/domain/patterns/pivots';

/**
 * Builds tight bars (high = close + 0.05, low = close - 0.05) so pivot prices
 * track the given closes deterministically.
 */
function makeBars(closes: number[]): Bar[] {
    return closes.map((close, i) => ({
        time: i,
        open: close,
        high: close + 0.05,
        low: close - 0.05,
        close,
        volume: 1000,
    }));
}

/**
 * Builds bars with explicit [high, low] pairs — used where a test needs
 * exact boundary arithmetic (e.g. a retracement of exactly the threshold)
 * that `makeBars`' fixed +/-0.05 offset would obscure. `open`/`close` are
 * irrelevant to `extractPivots` and set to `high`/`low` respectively.
 */
function makeHLBars(pairs: Array<[high: number, low: number]>): Bar[] {
    return pairs.map(([high, low], i) => ({
        time: i,
        open: high,
        high,
        low,
        close: low,
        volume: 1000,
    }));
}

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
        const pivots = extractPivots(bars, 1);

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
        // atr=1 → threshold=1.5. High pivot confirms at index 2 (price 14)
        // because runningHigh(14) - bar.low(12.5) === 1.5 exactly.
        const bars = makeHLBars([
            [10, 10], // idx0: seed
            [13, 13], // idx1: establishes 'up' direction (13-10=3 >= 1.5)
            [14, 14], // idx2: new running high
            [12.5, 12.5], // idx3: retraces exactly threshold → confirms
        ]);
        const pivots = extractPivots(bars, 1);
        expect(pivots).toEqual([{ index: 2, price: 14, kind: 'high' }]);
    });

    it('한 bar 안에서 극값 갱신과 방향 전환이 동시에 일어나는 갭 bar를 처리한다', () => {
        // atr=1 → threshold=1.5. idx2 is a single wide-range bar that both
        // sets the new running low (2) AND triggers the up-flip in the same
        // iteration (bar.high 20 - runningLow 2 = 18 >= 1.5).
        const bars = makeHLBars([
            [10, 10], // idx0: seed
            [8.5, 8.5], // idx1: establishes 'down' direction (10-8.5=1.5 >= 1.5)
            [20, 2], // idx2: gap bar — sets extreme + flips in one bar
        ]);
        const pivots = extractPivots(bars, 1);
        expect(pivots).toEqual([{ index: 2, price: 2, kind: 'low' }]);
    });

    it('동률 고점은 먼저 나온 인덱스를 유지한다', () => {
        // atr=1 → threshold=1.5. idx1 and idx2 both have high=13; the strict
        // `>` comparison means idx2 does NOT overwrite runningHighIndex, so
        // the confirmed pivot must report index 1, not 2.
        const bars = makeHLBars([
            [10, 10], // idx0: seed
            [13, 13], // idx1: establishes 'up' direction, running high = 13
            [13, 13], // idx2: ties the running high — must NOT become the pivot index
            [13, 11.5], // idx3: retraces exactly threshold → confirms
        ]);
        const pivots = extractPivots(bars, 1);
        expect(pivots).toEqual([{ index: 1, price: 13, kind: 'high' }]);
    });

    describe('includeProvisional', () => {
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

        it('마지막 확정 피벗과 동일 인덱스면 추가하지 않는다', () => {
            // atr=1 → threshold=1.5. idx2 is the gap bar from the earlier
            // test: it confirms the low pivot AND becomes the new running
            // high in the same iteration (direction flips to 'up' with
            // runningHighIndex=2). idx3 only ties that running high (20),
            // so runningHighIndex never moves past 2 — the provisional
            // high would duplicate the confirmed low pivot's own index and
            // must be omitted.
            const bars = makeHLBars([
                [10, 10], // idx0: seed
                [8.5, 8.5], // idx1: establishes 'down' direction
                [20, 2], // idx2: gap bar → confirms low pivot at idx2, flips up, runningHigh=20@idx2
                [20, 20], // idx3: ties running high (not >) — index stays 2
            ]);
            const pivots = extractPivots(bars, 1, {
                includeProvisional: true,
            });
            expect(pivots).toEqual([{ index: 2, price: 2, kind: 'low' }]);
        });
    });
});
