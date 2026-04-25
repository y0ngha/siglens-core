import { describe, it, expect } from 'vitest';
import { calculateWilliamsR } from '@/domain/indicators/williamsR';
import { WILLIAMS_R_DEFAULT_PERIOD } from '@/domain/indicators/constants';
import type { Bar } from '@/domain/types';

function makeBar(high: number, low: number, close: number, time: number): Bar {
    return { time, open: close, high, low, close, volume: 1000 };
}

describe('calculateWilliamsR', () => {
    describe('빈 배열일 때', () => {
        it('빈 배열을 반환한다', () => {
            expect(calculateWilliamsR([])).toEqual([]);
        });
    });

    describe('입력 길이가 period 미만일 때', () => {
        it('전부 null인 배열을 반환한다', () => {
            const bars = [makeBar(110, 90, 100, 0), makeBar(112, 92, 102, 1)];
            expect(calculateWilliamsR(bars, 3)).toEqual([null, null]);
        });
    });

    describe('Williams %R 계산', () => {
        it('처음 period - 1개는 null이다', () => {
            const bars = Array.from({ length: 5 }, (_, i) =>
                makeBar(100 + i, 90 + i, 95 + i, i)
            );
            const result = calculateWilliamsR(bars, 3);
            expect(result[0]).toBeNull();
            expect(result[1]).toBeNull();
            expect(result[2]).not.toBeNull();
        });

        it('close가 highestHigh일 때 Williams %R은 0이다', () => {
            // highestHigh = close = 120, lowestLow = 90
            // %R = (120-120)/(120-90) * -100 = 0
            const bars = [
                makeBar(100, 90, 95, 0),
                makeBar(110, 90, 100, 1),
                makeBar(120, 90, 120, 2),
            ];
            const result = calculateWilliamsR(bars, 3);
            expect(result[2]).toBeCloseTo(0, 5);
        });

        it('close가 lowestLow일 때 Williams %R은 -100이다', () => {
            // highestHigh = 120, lowestLow = close = 90
            // %R = (120-90)/(120-90) * -100 = -100
            const bars = [
                makeBar(100, 90, 95, 0),
                makeBar(110, 90, 100, 1),
                makeBar(120, 90, 90, 2),
            ];
            const result = calculateWilliamsR(bars, 3);
            expect(result[2]).toBeCloseTo(-100, 5);
        });

        it('range가 0이면 -50을 반환한다', () => {
            const bars = Array.from({ length: 3 }, (_, i) =>
                makeBar(100, 100, 100, i)
            );
            const result = calculateWilliamsR(bars, 3);
            expect(result[2]).toBe(-50);
        });

        it('Williams %R은 -100~0 범위이다', () => {
            const bars = Array.from(
                { length: WILLIAMS_R_DEFAULT_PERIOD + 5 },
                (_, i) => makeBar(100 + (i % 5), 90 + (i % 3), 95 + (i % 4), i)
            );
            const result = calculateWilliamsR(bars, WILLIAMS_R_DEFAULT_PERIOD);
            result.forEach(v => {
                if (v !== null) {
                    expect(v).toBeGreaterThanOrEqual(-100);
                    expect(v).toBeLessThanOrEqual(0);
                }
            });
        });

        it('반환 배열 길이는 입력과 같다', () => {
            const bars = Array.from({ length: 20 }, (_, i) =>
                makeBar(100 + i, 90 + i, 95 + i, i)
            );
            const result = calculateWilliamsR(bars, WILLIAMS_R_DEFAULT_PERIOD);
            expect(result).toHaveLength(20);
        });
    });
});
