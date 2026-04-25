import { describe, it, expect } from 'vitest';
import { calculateStochastic } from '@/domain/indicators/stochastic';
import {
    STOCHASTIC_K_PERIOD,
    STOCHASTIC_D_PERIOD,
    STOCHASTIC_SMOOTHING,
} from '@/domain/indicators/constants';
import type { Bar } from '@/domain/types';

function makeBar(high: number, low: number, close: number, time: number): Bar {
    return { time, open: close, high, low, close, volume: 1000 };
}

const MIN_BARS_FOR_K = STOCHASTIC_K_PERIOD + STOCHASTIC_SMOOTHING - 1;
const MIN_BARS_FOR_D = MIN_BARS_FOR_K + STOCHASTIC_D_PERIOD - 1;

describe('calculateStochastic', () => {
    describe('빈 배열일 때', () => {
        it('빈 배열을 반환한다', () => {
            expect(calculateStochastic([])).toEqual([]);
        });
    });

    describe('충분한 bars가 없을 때', () => {
        it('percentK와 percentD가 null이다', () => {
            const bars = Array.from(
                { length: STOCHASTIC_K_PERIOD - 1 },
                (_, i) => makeBar(100 + i, 90 + i, 95 + i, i)
            );
            const result = calculateStochastic(bars);
            result.forEach(r => {
                expect(r.percentK).toBeNull();
                expect(r.percentD).toBeNull();
            });
        });
    });

    describe('Stochastic 계산', () => {
        it('%K는 0~100 범위이다', () => {
            const bars = Array.from({ length: MIN_BARS_FOR_D + 5 }, (_, i) =>
                makeBar(100 + (i % 10), 90 + (i % 8), 95 + (i % 9), i)
            );
            const result = calculateStochastic(bars);
            result.forEach(r => {
                if (r.percentK !== null) {
                    expect(r.percentK).toBeGreaterThanOrEqual(0);
                    expect(r.percentK).toBeLessThanOrEqual(100);
                }
            });
        });

        it('%D는 0~100 범위이다', () => {
            const bars = Array.from({ length: MIN_BARS_FOR_D + 5 }, (_, i) =>
                makeBar(100 + (i % 10), 90 + (i % 8), 95 + (i % 9), i)
            );
            const result = calculateStochastic(bars);
            result.forEach(r => {
                if (r.percentD !== null) {
                    expect(r.percentD).toBeGreaterThanOrEqual(0);
                    expect(r.percentD).toBeLessThanOrEqual(100);
                }
            });
        });

        it('반환 배열 길이는 입력과 같다', () => {
            const bars = Array.from({ length: MIN_BARS_FOR_D + 5 }, (_, i) =>
                makeBar(100 + i, 90 + i, 95 + i, i)
            );
            const result = calculateStochastic(
                bars,
                STOCHASTIC_K_PERIOD,
                STOCHASTIC_D_PERIOD,
                STOCHASTIC_SMOOTHING
            );
            expect(result).toHaveLength(MIN_BARS_FOR_D + 5);
        });

        it('충분한 데이터가 있을 때 마지막 값에 percentD가 있다', () => {
            const bars = Array.from({ length: MIN_BARS_FOR_D + 5 }, (_, i) =>
                makeBar(100 + i, 90 + i, 95 + i, i)
            );
            const result = calculateStochastic(bars);
            expect(result[result.length - 1].percentD).not.toBeNull();
        });
    });
});
