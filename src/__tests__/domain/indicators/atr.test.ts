import { describe, it, expect } from 'vitest';
import { calculateATR } from '@/domain/indicators/atr';
import { ATR_DEFAULT_PERIOD } from '@/domain/indicators/constants';
import type { Bar } from '@/domain/types';

function makeBars(closes: number[], highs?: number[], lows?: number[]): Bar[] {
    return closes.map((close, i) => ({
        time: i,
        open: close,
        high: highs?.[i] ?? close,
        low: lows?.[i] ?? close,
        close,
        volume: 1000,
    }));
}

describe('calculateATR', () => {
    describe('입력 배열이 비어있을 때', () => {
        it('빈 배열을 반환한다', () => {
            expect(calculateATR([])).toEqual([]);
        });
    });

    describe('입력 배열 길이가 period 이하일 때', () => {
        it('전부 null인 배열을 반환한다', () => {
            const bars = makeBars([10, 11, 12]);
            const result = calculateATR(bars, 3);
            expect(result).toEqual([null, null, null]);
        });
    });

    describe('period 이후 값 계산', () => {
        it('처음 period개는 null이다', () => {
            const bars = makeBars([10, 11, 12, 13, 14, 15]);
            const result = calculateATR(bars, 3);
            expect(result[0]).toBeNull();
            expect(result[1]).toBeNull();
            expect(result[2]).toBeNull();
        });

        it('반환 배열 길이는 입력과 같다', () => {
            const bars = makeBars([10, 11, 12, 13, 14, 15]);
            const result = calculateATR(bars, 3);
            expect(result).toHaveLength(6);
        });

        it('high=low=close일 때 initialATR은 |close - prevClose|들의 평균이다', () => {
            // closes: [10, 11, 12, 13], all high=low=close
            // TR values: [1, 1, 1] (|11-10|, |12-11|, |13-12|)
            // period=3: initialATR = (1+1+1)/3 = 1
            const bars = makeBars([10, 11, 12, 13]);
            const result = calculateATR(bars, 3);
            expect(result[3]).toBeCloseTo(1, 10);
        });

        it('Wilder smoothing 공식으로 후속 ATR을 계산한다', () => {
            // closes: [10, 11, 12, 13, 11], period=3
            // TR[4] = |11 - 13| = 2 (|low-prevClose|)
            // ATR[4] = (1*2 + 2)/3 = 4/3
            const bars = makeBars([10, 11, 12, 13, 11]);
            const result = calculateATR(bars, 3);
            expect(result[4]).toBeCloseTo(4 / 3, 5);
        });

        it('기본 period는 ATR_DEFAULT_PERIOD이다', () => {
            const bars = makeBars(
                Array.from(
                    { length: ATR_DEFAULT_PERIOD + 5 },
                    (_, i) => 100 + i
                )
            );
            const result = calculateATR(bars);
            expect(
                result.slice(0, ATR_DEFAULT_PERIOD).every(v => v === null)
            ).toBe(true);
            expect(result[ATR_DEFAULT_PERIOD]).not.toBeNull();
        });
    });

    describe('극단 입력', () => {
        it('period=1이면 선행 null이 하나뿐이고 Wilder 평활이 무력화되어 ATR=TR이다', () => {
            // period=1: ATR[i] = (ATR[i-1]*0 + TR[i])/1 = TR[i]
            // closes [10,11,13]: TR = [|11-10|, |13-11|] = [1, 2]
            const bars = makeBars([10, 11, 13]);
            const result = calculateATR(bars, 1);
            expect(result[0]).toBeNull();
            expect(result[1]).toBeCloseTo(1, 10);
            expect(result[2]).toBeCloseTo(2, 10);
        });

        it('단일 봉이면 period보다 짧으므로 null 하나를 반환한다', () => {
            expect(calculateATR(makeBars([10]), 3)).toEqual([null]);
        });
    });
});
