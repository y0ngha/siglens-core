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
});
