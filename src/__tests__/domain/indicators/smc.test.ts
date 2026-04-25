import { describe, it, expect } from 'vitest';
import { calculateSmc } from '@/domain/indicators/smc';
import {
    EMPTY_SMC_RESULT,
    SMC_SWING_PERIOD,
} from '@/domain/indicators/constants';
import type { Bar } from '@/domain/types';

function makeBar(high: number, low: number, close: number, time: number): Bar {
    return { time, open: close, high, low, close, volume: 1000 };
}

const MIN_SWING_BARS = SMC_SWING_PERIOD * 2 + 1;

describe('calculateSmc', () => {
    describe('빈 배열일 때', () => {
        it('EMPTY_SMC_RESULT를 반환한다', () => {
            expect(calculateSmc([])).toEqual(EMPTY_SMC_RESULT);
        });
    });

    describe('swing point 감지에 충분하지 않은 데이터일 때', () => {
        it('결과의 swingHighs와 swingLows가 빈 배열이다', () => {
            const bars = Array.from({ length: MIN_SWING_BARS - 1 }, (_, i) =>
                makeBar(100 + i, 90 + i, 95 + i, i)
            );
            const result = calculateSmc(bars);
            expect(result.swingHighs).toEqual([]);
            expect(result.swingLows).toEqual([]);
        });
    });

    describe('충분한 데이터가 있을 때', () => {
        it('결과 구조에 필요한 모든 키가 있다', () => {
            const bars = Array.from({ length: MIN_SWING_BARS + 20 }, (_, i) =>
                makeBar(100 + (i % 10), 90 + (i % 8), 95 + (i % 9), i)
            );
            const result = calculateSmc(bars);
            expect('swingHighs' in result).toBe(true);
            expect('swingLows' in result).toBe(true);
            expect('orderBlocks' in result).toBe(true);
            expect('fairValueGaps' in result).toBe(true);
            expect('equalHighs' in result).toBe(true);
            expect('equalLows' in result).toBe(true);
            expect('structureBreaks' in result).toBe(true);
        });

        it('swing points는 배열이다', () => {
            const bars = Array.from({ length: MIN_SWING_BARS + 20 }, (_, i) =>
                makeBar(100 + (i % 10), 90 + (i % 8), 95 + (i % 9), i)
            );
            const result = calculateSmc(bars);
            expect(Array.isArray(result.swingHighs)).toBe(true);
            expect(Array.isArray(result.swingLows)).toBe(true);
        });

        it('swingHighs의 type은 high이다', () => {
            const bars = Array.from({ length: MIN_SWING_BARS + 20 }, (_, i) =>
                makeBar(100 + (i % 10), 90 + (i % 8), 95 + (i % 9), i)
            );
            const result = calculateSmc(bars);
            result.swingHighs.forEach(sh => {
                expect(sh.type).toBe('high');
            });
        });

        it('swingLows의 type은 low이다', () => {
            const bars = Array.from({ length: MIN_SWING_BARS + 20 }, (_, i) =>
                makeBar(100 + (i % 10), 90 + (i % 8), 95 + (i % 9), i)
            );
            const result = calculateSmc(bars);
            result.swingLows.forEach(sl => {
                expect(sl.type).toBe('low');
            });
        });

        it('구조적으로 상승하는 데이터에서 FVG가 감지될 수 있다', () => {
            // 급격한 상승 구조를 만들어 bullish FVG 유발
            const bars: Bar[] = [
                makeBar(100, 90, 95, 0),
                makeBar(101, 91, 96, 1),
                // bar[2].low(110) > bar[0].high(100) → bullish FVG
                makeBar(120, 110, 115, 2),
            ];
            const result = calculateSmc(bars);
            expect(Array.isArray(result.fairValueGaps)).toBe(true);
        });
    });
});
