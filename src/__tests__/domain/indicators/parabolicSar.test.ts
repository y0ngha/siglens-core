import { describe, it, expect } from 'vitest';
import { calculateParabolicSAR } from '@/domain/indicators/parabolicSar';
import {
    PSAR_AF_START,
    PSAR_AF_INCREMENT,
    PSAR_AF_MAX,
} from '@/domain/indicators/constants';
import type { Bar } from '@/domain/types';

function makeBar(high: number, low: number, close: number, time: number): Bar {
    return { time, open: close, high, low, close, volume: 1000 };
}

describe('calculateParabolicSAR', () => {
    describe('빈 배열일 때', () => {
        it('빈 배열을 반환한다', () => {
            expect(calculateParabolicSAR([])).toEqual([]);
        });
    });

    describe('bar가 1개일 때', () => {
        it('sar과 trend가 null인 단일 결과를 반환한다', () => {
            const bars = [makeBar(110, 90, 100, 0)];
            expect(calculateParabolicSAR(bars)).toEqual([
                { sar: null, trend: null },
            ]);
        });
    });

    describe('bar가 2개 이상일 때', () => {
        it('첫 번째 bar는 sar이 null이다', () => {
            const bars = [makeBar(110, 90, 100, 0), makeBar(115, 95, 110, 1)];
            const result = calculateParabolicSAR(bars);
            expect(result[0]).toEqual({ sar: null, trend: null });
        });

        it('두 번째 bar부터 sar이 null이 아니다', () => {
            const bars = [makeBar(110, 90, 100, 0), makeBar(115, 95, 110, 1)];
            const result = calculateParabolicSAR(bars);
            expect(result[1].sar).not.toBeNull();
            expect(result[1].trend).not.toBeNull();
        });

        it('상승 추세에서 두 번째 bar trend는 up이다', () => {
            // bars[1].close >= bars[0].close → initialTrend = 'up'
            const bars = [makeBar(110, 90, 95, 0), makeBar(115, 92, 110, 1)];
            const result = calculateParabolicSAR(bars);
            expect(result[1].trend).toBe('up');
        });

        it('하락 추세에서 두 번째 bar trend는 down이다', () => {
            // bars[1].close < bars[0].close → initialTrend = 'down'
            const bars = [makeBar(110, 90, 105, 0), makeBar(108, 88, 90, 1)];
            const result = calculateParabolicSAR(bars);
            expect(result[1].trend).toBe('down');
        });

        it('반환 배열 길이는 입력과 같다', () => {
            const bars = Array.from({ length: 20 }, (_, i) =>
                makeBar(100 + i, 90 + i, 95 + i, i)
            );
            const result = calculateParabolicSAR(
                bars,
                PSAR_AF_START,
                PSAR_AF_INCREMENT,
                PSAR_AF_MAX
            );
            expect(result).toHaveLength(20);
        });

        it('trend는 up 또는 down이다', () => {
            const bars = Array.from({ length: 10 }, (_, i) =>
                makeBar(100 + i, 90 + i, 95 + i, i)
            );
            const result = calculateParabolicSAR(bars);
            result.forEach(r => {
                if (r.trend !== null) {
                    expect(['up', 'down']).toContain(r.trend);
                }
            });
        });
    });
});
