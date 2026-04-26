import { describe, it, expect } from 'vitest';
import { calculateMACD } from '@/domain/indicators/macd';
import {
    MACD_SLOW_PERIOD,
    MACD_SIGNAL_PERIOD,
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

const MIN_BARS = MACD_SLOW_PERIOD + MACD_SIGNAL_PERIOD - 1;

describe('calculateMACD', () => {
    describe('빈 배열일 때', () => {
        it('빈 배열을 반환한다', () => {
            expect(calculateMACD([])).toEqual([]);
        });
    });

    describe('bars 길이가 slowPeriod 미만일 때', () => {
        it('모든 macd가 null이다', () => {
            const bars = makeBars(
                Array.from({ length: MACD_SLOW_PERIOD - 1 }, (_, i) => 100 + i)
            );
            const result = calculateMACD(bars);
            result.forEach(r => expect(r.macd).toBeNull());
        });
    });

    describe('MACD 계산', () => {
        it('처음 slowPeriod - 1개는 macd가 null이다', () => {
            const bars = makeBars(
                Array.from({ length: MIN_BARS + 5 }, (_, i) => 100 + i)
            );
            const result = calculateMACD(bars);
            for (let i = 0; i < MACD_SLOW_PERIOD - 1; i++) {
                expect(result[i].macd).toBeNull();
            }
        });

        it('MACD = fastEMA - slowEMA이다', () => {
            const bars = makeBars(
                Array.from({ length: MIN_BARS + 5 }, (_, i) => 100 + i)
            );
            const result = calculateMACD(bars);
            const firstValid = result.find(r => r.macd !== null);
            expect(firstValid).toBeDefined();
            // 단조 증가 선형 시퀀스에서 fast EMA(12) 래그 = (12-1)/2 = 5.5,
            // slow EMA(26) SMA 시드 래그 = (26-1)/2 = 12.5 → MACD = 12.5 - 5.5 = 7.0
            expect(firstValid!.macd).toBeCloseTo(7.0, 5);
        });

        it('signal이 충분한 데이터가 있을 때 null이 아니다', () => {
            const bars = makeBars(
                Array.from({ length: MIN_BARS + 5 }, (_, i) => 100 + i)
            );
            const result = calculateMACD(bars);
            const lastResult = result[result.length - 1];
            expect(lastResult.signal).not.toBeNull();
            expect(lastResult.histogram).not.toBeNull();
        });

        it('histogram = macd - signal이다', () => {
            const bars = makeBars(
                Array.from({ length: MIN_BARS + 5 }, (_, i) => 100 + i)
            );
            const result = calculateMACD(bars);
            result.forEach(r => {
                if (
                    r.macd !== null &&
                    r.signal !== null &&
                    r.histogram !== null
                ) {
                    expect(r.histogram).toBeCloseTo(r.macd - r.signal, 10);
                }
            });
        });

        it('반환 배열 길이는 입력과 같다', () => {
            const bars = makeBars(
                Array.from({ length: MIN_BARS + 5 }, (_, i) => 100 + i)
            );
            expect(calculateMACD(bars)).toHaveLength(MIN_BARS + 5);
        });
    });
});
