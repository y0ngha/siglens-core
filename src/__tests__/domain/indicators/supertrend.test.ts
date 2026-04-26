import { describe, it, expect } from 'vitest';
import { calculateSupertrend } from '@/domain/indicators/supertrend';
import {
    SUPERTREND_ATR_PERIOD,
    SUPERTREND_MULTIPLIER,
} from '@/domain/indicators/constants';
import type { Bar } from '@/domain/types';

function makeBar(high: number, low: number, close: number, time: number): Bar {
    return { time, open: close, high, low, close, volume: 1000 };
}

describe('calculateSupertrend', () => {
    describe('빈 배열일 때', () => {
        it('빈 배열을 반환한다', () => {
            expect(calculateSupertrend([])).toEqual([]);
        });
    });

    describe('입력 길이가 atrPeriod 이하일 때', () => {
        it('전부 null인 결과 배열을 반환한다', () => {
            const bars = Array.from({ length: 3 }, (_, i) =>
                makeBar(100 + i, 90 + i, 95 + i, i)
            );
            const result = calculateSupertrend(bars, 3);
            result.forEach(r => {
                expect(r.supertrend).toBeNull();
                expect(r.trend).toBeNull();
            });
        });
    });

    describe('atrPeriod 이후 계산', () => {
        it('처음 atrPeriod개는 null이다', () => {
            const bars = Array.from(
                { length: SUPERTREND_ATR_PERIOD + 5 },
                (_, i) => makeBar(100 + i, 90 + i, 95 + i, i)
            );
            const result = calculateSupertrend(
                bars,
                SUPERTREND_ATR_PERIOD,
                SUPERTREND_MULTIPLIER
            );
            for (let i = 0; i < SUPERTREND_ATR_PERIOD; i++) {
                expect(result[i].supertrend).toBeNull();
            }
        });

        it('atrPeriod 이후 supertrend와 trend가 null이 아니다', () => {
            const bars = Array.from(
                { length: SUPERTREND_ATR_PERIOD + 5 },
                (_, i) => makeBar(100 + i, 90 + i, 95 + i, i)
            );
            const result = calculateSupertrend(
                bars,
                SUPERTREND_ATR_PERIOD,
                SUPERTREND_MULTIPLIER
            );
            expect(result[SUPERTREND_ATR_PERIOD].supertrend).not.toBeNull();
            expect(result[SUPERTREND_ATR_PERIOD].trend).not.toBeNull();
        });

        it('상승 추세에서 trend는 up이다', () => {
            // close(95+i*2) > hl2((100+80)/2+i*2=90+i*2) → initial trend='up'
            const bars = Array.from(
                { length: SUPERTREND_ATR_PERIOD + 5 },
                (_, i) => makeBar(100 + i * 2, 80 + i * 2, 95 + i * 2, i)
            );
            const result = calculateSupertrend(
                bars,
                SUPERTREND_ATR_PERIOD,
                SUPERTREND_MULTIPLIER
            );
            const lastResult = result[result.length - 1];
            expect(lastResult.trend).toBe('up');
        });

        it('반환 배열 길이는 입력과 같다', () => {
            const bars = Array.from(
                { length: SUPERTREND_ATR_PERIOD + 10 },
                (_, i) => makeBar(100 + i, 90 + i, 95 + i, i)
            );
            const result = calculateSupertrend(
                bars,
                SUPERTREND_ATR_PERIOD,
                SUPERTREND_MULTIPLIER
            );
            expect(result).toHaveLength(SUPERTREND_ATR_PERIOD + 10);
        });

        it('단조 증가 bars에서 첫 supertrend는 40이다', () => {
            // high=100+i, low=80+i → TR=20(constant), ATR=20
            // hl2[atrPeriod] = (100+10+80+10)/2 = 100
            // basic_lower = 100 - 3.0*20 = 40
            // close=95+10=105 > hl2=100 → trend=up → supertrend=40
            const bars = Array.from(
                { length: SUPERTREND_ATR_PERIOD + 5 },
                (_, i) => makeBar(100 + i, 80 + i, 95 + i, i)
            );
            const result = calculateSupertrend(
                bars,
                SUPERTREND_ATR_PERIOD,
                SUPERTREND_MULTIPLIER
            );
            expect(result[SUPERTREND_ATR_PERIOD].supertrend).toBeCloseTo(40, 5);
        });
    });
});
