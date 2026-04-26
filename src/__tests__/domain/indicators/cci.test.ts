import { describe, it, expect } from 'vitest';
import { calculateCCI } from '@/domain/indicators/cci';
import { CCI_DEFAULT_PERIOD } from '@/domain/indicators/constants';
import type { Bar } from '@/domain/types';

function makeBar(high: number, low: number, close: number, time: number): Bar {
    return { time, open: close, high, low, close, volume: 1000 };
}

describe('calculateCCI', () => {
    describe('빈 배열일 때', () => {
        it('빈 배열을 반환한다', () => {
            expect(calculateCCI([])).toEqual([]);
        });
    });

    describe('입력 길이가 period 미만일 때', () => {
        it('전부 null인 배열을 반환한다', () => {
            const bars = [makeBar(10, 10, 10, 0), makeBar(11, 11, 11, 1)];
            expect(calculateCCI(bars, 3)).toEqual([null, null]);
        });
    });

    describe('period 이후 값 계산', () => {
        it('처음 period - 1개는 null이다', () => {
            const bars = Array.from({ length: 5 }, (_, i) =>
                makeBar(10 + i, 8 + i, 9 + i, i)
            );
            const result = calculateCCI(bars, 3);
            expect(result[0]).toBeNull();
            expect(result[1]).toBeNull();
            expect(result[2]).not.toBeNull();
        });

        it('전형 가격이 SMA와 같으면 CCI는 0이다', () => {
            // 모든 TP가 같은 경우 currentTP === SMAValue → CCI = 0
            const bars = Array.from(
                { length: 4 },
                (_, i) => makeBar(12, 6, 9, i) // TP = (12+6+9)/3 = 9
            );
            const result = calculateCCI(bars, 3);
            expect(result[3]).toBeCloseTo(0, 5);
        });

        it('반환 배열 길이는 입력과 같다', () => {
            const bars = Array.from(
                { length: CCI_DEFAULT_PERIOD + 5 },
                (_, i) => makeBar(10 + i, 8 + i, 9 + i, i)
            );
            const result = calculateCCI(bars, CCI_DEFAULT_PERIOD);
            expect(result).toHaveLength(CCI_DEFAULT_PERIOD + 5);
        });
    });
});
