import { describe, it, expect } from 'vitest';
import { calculateDonchianChannel } from '@/domain/indicators/donchianChannel';
import { DONCHIAN_DEFAULT_PERIOD } from '@/domain/indicators/constants';
import type { Bar } from '@/domain/types';

function makeBar(high: number, low: number, time: number): Bar {
    const close = (high + low) / 2;
    return { time, open: close, high, low, close, volume: 1000 };
}

describe('calculateDonchianChannel', () => {
    describe('빈 배열일 때', () => {
        it('빈 배열을 반환한다', () => {
            expect(calculateDonchianChannel([])).toEqual([]);
        });
    });

    describe('입력 길이가 period 미만일 때', () => {
        it('전부 null인 결과 배열을 반환한다', () => {
            const bars = [makeBar(110, 90, 0), makeBar(112, 91, 1)];
            const result = calculateDonchianChannel(bars, 3);
            expect(result).toEqual([
                { upper: null, middle: null, lower: null },
                { upper: null, middle: null, lower: null },
            ]);
        });
    });

    describe('period 이후 값 계산', () => {
        it('upper는 창의 최고가이다', () => {
            // bars: high=[100, 120, 110], period=3 → upper=120
            const bars = [
                makeBar(100, 90, 0),
                makeBar(120, 95, 1),
                makeBar(110, 85, 2),
            ];
            const result = calculateDonchianChannel(bars, 3);
            expect(result[2].upper).toBe(120);
        });

        it('lower는 창의 최저가이다', () => {
            // bars: low=[90, 95, 85], period=3 → lower=85
            const bars = [
                makeBar(100, 90, 0),
                makeBar(120, 95, 1),
                makeBar(110, 85, 2),
            ];
            const result = calculateDonchianChannel(bars, 3);
            expect(result[2].lower).toBe(85);
        });

        it('middle은 (upper + lower) / 2이다', () => {
            const bars = [
                makeBar(100, 90, 0),
                makeBar(120, 95, 1),
                makeBar(110, 85, 2),
            ];
            const result = calculateDonchianChannel(bars, 3);
            expect(result[2].middle).toBeCloseTo((120 + 85) / 2, 5);
        });

        it('처음 period - 1개는 null이다', () => {
            const bars = Array.from({ length: 5 }, (_, i) =>
                makeBar(100 + i, 90 + i, i)
            );
            const result = calculateDonchianChannel(bars, 3);
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
            expect(result[2].upper).not.toBeNull();
        });

        it('반환 배열 길이는 입력과 같다', () => {
            const bars = Array.from(
                { length: DONCHIAN_DEFAULT_PERIOD + 5 },
                (_, i) => makeBar(100 + i, 80 + i, i)
            );
            const result = calculateDonchianChannel(
                bars,
                DONCHIAN_DEFAULT_PERIOD
            );
            expect(result).toHaveLength(DONCHIAN_DEFAULT_PERIOD + 5);
        });
    });
});
