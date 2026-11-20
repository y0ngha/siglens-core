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

        it('상승 추세에서 두 번째 bar의 sar은 bars[0].low이다', () => {
            // initialTrend=up → SAR 초기값 = bars[0].low = 90
            const bars = [makeBar(110, 90, 95, 0), makeBar(115, 92, 110, 1)];
            const result = calculateParabolicSAR(bars);
            expect(result[1].sar).toBeCloseTo(90, 5);
        });
    });

    describe('반전 시 가속계수', () => {
        // 상승 추세(EP 120)에서 i5가 SAR 아래로 급락해 하락 반전한다.
        const bars = [
            makeBar(105, 95, 100, 0),
            makeBar(110, 100, 108, 1),
            makeBar(120, 108, 118, 2),
            makeBar(112, 106, 110, 3),
            makeBar(110, 102, 104, 4),
            makeBar(100, 70, 75, 5),
            makeBar(72, 60, 62, 6),
        ];

        it('반전 직후 AF는 afIncrement가 아니라 afStart로 돌아간다', () => {
            const result = calculateParabolicSAR(bars, 0.02, 0.05, 0.2);

            expect(result[5]).toEqual({ sar: 120, trend: 'down' });
            // 120 + afStart * (EP 70 - 120) = 119. With afIncrement it would be 117.5.
            expect(result[6].sar).toBeCloseTo(119);
            expect(result[6].trend).toBe('down');
        });

        it('afStart와 afIncrement가 같으면 두 값의 구분이 사라진다 (기본값에서 증상이 없던 이유)', () => {
            const result = calculateParabolicSAR(bars, 0.05, 0.05, 0.2);

            expect(result[6].sar).toBeCloseTo(117.5);
        });
    });
});
