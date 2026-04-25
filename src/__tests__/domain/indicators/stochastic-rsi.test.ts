import { describe, it, expect } from 'vitest';
import { calculateStochRSI } from '@/domain/indicators/stochastic-rsi';
import {
    STOCH_RSI_RSI_PERIOD,
    STOCH_RSI_STOCH_PERIOD,
    STOCH_RSI_K_PERIOD,
    STOCH_RSI_D_PERIOD,
} from '@/domain/indicators/constants';

const MIN_BARS =
    STOCH_RSI_RSI_PERIOD +
    STOCH_RSI_STOCH_PERIOD +
    STOCH_RSI_K_PERIOD +
    STOCH_RSI_D_PERIOD;

describe('calculateStochRSI', () => {
    describe('빈 배열일 때', () => {
        it('빈 배열을 반환한다', () => {
            expect(calculateStochRSI([])).toEqual([]);
        });
    });

    describe('충분한 데이터가 없을 때', () => {
        it('모든 k, d가 null이다', () => {
            const closes = Array.from(
                { length: STOCH_RSI_RSI_PERIOD },
                (_, i) => 100 + i
            );
            const result = calculateStochRSI(closes);
            result.forEach(r => {
                expect(r.k).toBeNull();
                expect(r.d).toBeNull();
            });
        });
    });

    describe('충분한 데이터가 있을 때', () => {
        it('마지막 결과에 k와 d가 있다', () => {
            const closes = Array.from(
                { length: MIN_BARS + 10 },
                (_, i) => 100 + Math.sin(i * 0.5) * 10
            );
            const result = calculateStochRSI(closes);
            const lastResult = result[result.length - 1];
            expect(lastResult.k).not.toBeNull();
            expect(lastResult.d).not.toBeNull();
        });

        it('k는 0~1 범위이다', () => {
            const closes = Array.from(
                { length: MIN_BARS + 10 },
                (_, i) => 100 + Math.sin(i * 0.5) * 10
            );
            const result = calculateStochRSI(closes);
            result.forEach(r => {
                if (r.k !== null) {
                    expect(r.k).toBeGreaterThanOrEqual(0);
                    expect(r.k).toBeLessThanOrEqual(1);
                }
            });
        });

        it('반환 배열 길이는 입력과 같다', () => {
            const closes = Array.from(
                { length: MIN_BARS + 5 },
                (_, i) => 100 + i
            );
            const result = calculateStochRSI(closes);
            expect(result).toHaveLength(MIN_BARS + 5);
        });
    });
});
