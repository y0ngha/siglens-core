import { describe, it, expect } from 'vitest';
import { calculateRSI } from '@/domain/indicators/rsi';
import { RSI_DEFAULT_PERIOD } from '@/domain/indicators/constants';

describe('calculateRSI', () => {
    describe('빈 배열일 때', () => {
        it('빈 배열을 반환한다', () => {
            expect(calculateRSI([])).toEqual([]);
        });
    });

    describe('입력 길이가 period 이하일 때', () => {
        it('전부 null인 배열을 반환한다', () => {
            const closes = [10, 11, 12];
            const result = calculateRSI(closes, 3);
            expect(result).toEqual([null, null, null]);
        });
    });

    describe('period 이후 RSI 계산', () => {
        it('처음 period개는 null이다', () => {
            const closes = [10, 11, 12, 13, 14];
            const result = calculateRSI(closes, 3);
            expect(result[0]).toBeNull();
            expect(result[1]).toBeNull();
            expect(result[2]).toBeNull();
        });

        it('손실이 없으면 RSI는 100이다', () => {
            // closes = [10, 11, 12, 13], 모두 상승, period=3
            // avgGain = 1, avgLoss = 0 → RSI = 100
            const result = calculateRSI([10, 11, 12, 13], 3);
            expect(result[3]).toBeCloseTo(100, 10);
        });

        it('이득이 없으면 RSI는 0이다', () => {
            // closes = [13, 12, 11, 10], 모두 하락, period=3
            // avgGain = 0, avgLoss = 1 → RSI = 0
            const result = calculateRSI([13, 12, 11, 10], 3);
            expect(result[3]).toBeCloseTo(0, 10);
        });

        it('RSI는 0~100 범위에 있다', () => {
            const closes = [10, 11, 12, 13, 11, 14, 12, 15];
            const result = calculateRSI(closes, 3);
            result.forEach(v => {
                if (v !== null) {
                    expect(v).toBeGreaterThanOrEqual(0);
                    expect(v).toBeLessThanOrEqual(100);
                }
            });
        });

        it('동등한 이득/손실이면 RSI는 50이다', () => {
            // closes = [10, 11, 12, 13, 11], period=3
            // initialAvgGain = (1+1+1)/3 = 1, initialAvgLoss = 0
            // RSI[3] = 100
            // diff[4] = 11-13 = -2, gain=0, loss=2
            // avgGain = (1*2 + 0)/3 = 2/3, avgLoss = (0*2 + 2)/3 = 2/3
            // RSI[4] = 100 - 100/(1 + 1) = 50
            const result = calculateRSI([10, 11, 12, 13, 11], 3);
            expect(result[4]).toBeCloseTo(50, 5);
        });

        it('반환 배열 길이는 입력과 같다', () => {
            const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
            const result = calculateRSI(closes, RSI_DEFAULT_PERIOD);
            expect(result).toHaveLength(20);
        });

        it('기본 period는 RSI_DEFAULT_PERIOD이다', () => {
            const closes = Array.from(
                { length: RSI_DEFAULT_PERIOD + 5 },
                (_, i) => 100 + i
            );
            const result = calculateRSI(closes);
            expect(
                result.slice(0, RSI_DEFAULT_PERIOD).every(v => v === null)
            ).toBe(true);
            expect(result[RSI_DEFAULT_PERIOD]).not.toBeNull();
        });
    });
});
