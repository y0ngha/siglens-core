import { describe, it, expect } from 'vitest';
import { calculateBollinger } from '@/domain/indicators/bollinger';
import {
    BOLLINGER_DEFAULT_PERIOD,
    BOLLINGER_DEFAULT_STD_DEV,
} from '@/domain/indicators/constants';
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

describe('calculateBollinger', () => {
    describe('입력 배열 길이가 period 미만일 때', () => {
        it('전부 null인 결과 배열을 반환한다', () => {
            const bars = makeBars([10, 20]);
            const result = calculateBollinger(bars, 3);
            expect(result).toEqual([
                { upper: null, middle: null, lower: null },
                { upper: null, middle: null, lower: null },
            ]);
        });
    });

    describe('모든 값이 같을 때', () => {
        it('상단=중간=하단=해당값이다', () => {
            const bars = makeBars([10, 10, 10, 10]);
            const result = calculateBollinger(bars, 3);
            expect(result[3]).toEqual({ upper: 10, middle: 10, lower: 10 });
        });
    });

    describe('period 이후 값 계산', () => {
        it('처음 period - 1개는 null이다', () => {
            const bars = makeBars([10, 20, 30, 40, 50]);
            const result = calculateBollinger(bars, 3);
            expect(result[0]).toEqual({
                upper: null,
                middle: null,
                lower: null,
            });
            expect(result[1]).toEqual({
                upper: null,
                middle: null,
                lower: null,
            });
        });

        it('중간 밴드는 SMA이다', () => {
            // window = [10, 20, 30] → SMA = 20
            const bars = makeBars([10, 20, 30, 40]);
            const result = calculateBollinger(bars, 3);
            expect(result[2].middle).toBeCloseTo(20, 10);
        });

        it('상단은 middle + stdDev * std이다', () => {
            // window [10,20,30]: mean=20, variance=((10-20)²+(20-20)²+(30-20)²)/3 = 200/3
            const bars = makeBars([10, 20, 30]);
            const result = calculateBollinger(bars, 3, 2);
            const expectedStd = Math.sqrt(200 / 3);
            expect(result[2].upper).toBeCloseTo(20 + 2 * expectedStd, 5);
            expect(result[2].lower).toBeCloseTo(20 - 2 * expectedStd, 5);
        });

        it('반환 배열 길이는 입력과 같다', () => {
            const bars = makeBars(
                Array.from({ length: 30 }, (_, i) => 100 + i)
            );
            const result = calculateBollinger(
                bars,
                BOLLINGER_DEFAULT_PERIOD,
                BOLLINGER_DEFAULT_STD_DEV
            );
            expect(result).toHaveLength(30);
        });

        it('upper >= middle >= lower이다', () => {
            const bars = makeBars([10, 15, 20, 25, 30]);
            const result = calculateBollinger(bars, 3);
            result.forEach(r => {
                if (r.upper !== null && r.middle !== null && r.lower !== null) {
                    expect(r.upper).toBeGreaterThanOrEqual(r.middle);
                    expect(r.middle).toBeGreaterThanOrEqual(r.lower);
                }
            });
        });
    });
});
