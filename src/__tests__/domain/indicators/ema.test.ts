import { describe, it, expect } from 'vitest';
import { computeEMAValues, calculateEMA } from '@/domain/indicators/ema';
import type { Bar } from '@/domain/types';

function makeBars(closes: number[]): Bar[] {
    return closes.map((close, i) => ({
        time: i,
        open: close,
        high: close,
        low: close,
        close,
        volume: 1000,
    }));
}

describe('computeEMAValues', () => {
    describe('빈 배열이거나 period가 0 이하일 때', () => {
        it('빈 배열을 반환한다', () => {
            expect(computeEMAValues([], 3)).toEqual([]);
            expect(computeEMAValues([10, 20], 0)).toEqual([]);
            expect(computeEMAValues([10, 20], -1)).toEqual([]);
        });
    });

    describe('입력 길이가 period 미만일 때', () => {
        it('전부 null인 배열을 반환한다', () => {
            expect(computeEMAValues([10, 20], 3)).toEqual([null, null]);
        });
    });

    describe('period 이후 값 계산', () => {
        it('처음 period - 1개는 null이다', () => {
            // period=3: 처음 2개 null, 3번째는 SMA
            const result = computeEMAValues([10, 10, 10, 12], 3);
            expect(result[0]).toBeNull();
            expect(result[1]).toBeNull();
            expect(result[2]).toBeCloseTo(10, 10); // SMA(3) = 10
        });

        it('EMA 값을 올바르게 계산한다', () => {
            // period=3, multiplier = 2/(3+1) = 0.5
            // closes = [10, 10, 10, 12]
            // EMA[2] = SMA([10,10,10]) = 10
            // EMA[3] = 12 * 0.5 + 10 * 0.5 = 11
            const result = computeEMAValues([10, 10, 10, 12], 3);
            expect(result[3]).toBeCloseTo(11, 10);
        });

        it('반환 배열 길이는 입력과 같다', () => {
            const result = computeEMAValues([10, 20, 30, 40, 50], 3);
            expect(result).toHaveLength(5);
        });

        it('연속 EMA 값이 올바르게 감소한다', () => {
            // period=3, multiplier=0.5
            // closes = [10, 10, 10, 8]
            // EMA[2] = 10, EMA[3] = 8*0.5 + 10*0.5 = 9
            const result = computeEMAValues([10, 10, 10, 8], 3);
            expect(result[3]).toBeCloseTo(9, 10);
        });
    });
});

describe('calculateEMA', () => {
    it('bar의 close 값을 기반으로 EMA를 계산한다', () => {
        const bars = makeBars([10, 10, 10, 12]);
        const result = calculateEMA(bars, 3);
        expect(result).toHaveLength(4);
        expect(result[3]).toBeCloseTo(11, 10);
    });

    it('빈 bars에 대해 빈 배열을 반환한다', () => {
        expect(calculateEMA([], 3)).toEqual([]);
    });
});
