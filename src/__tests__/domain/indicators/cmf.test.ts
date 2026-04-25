import { describe, it, expect } from 'vitest';
import { calculateCMF } from '@/domain/indicators/cmf';
import { CMF_DEFAULT_PERIOD } from '@/domain/indicators/constants';
import type { Bar } from '@/domain/types';

function makeBar(
    high: number,
    low: number,
    close: number,
    volume: number,
    time = 0
): Bar {
    return { time, open: close, high, low, close, volume };
}

describe('calculateCMF', () => {
    describe('빈 배열일 때', () => {
        it('빈 배열을 반환한다', () => {
            expect(calculateCMF([])).toEqual([]);
        });
    });

    describe('입력 길이가 period 미만일 때', () => {
        it('전부 null인 배열을 반환한다', () => {
            const bars = [makeBar(10, 8, 9, 1000)];
            expect(calculateCMF(bars, 3)).toEqual([null]);
        });
    });

    describe('volume이 0일 때', () => {
        it('CMF는 0이다', () => {
            const bars = Array.from({ length: 4 }, (_, i) =>
                makeBar(10, 8, 9, 0, i)
            );
            const result = calculateCMF(bars, 3);
            expect(result[3]).toBe(0);
        });
    });

    describe('close가 항상 high일 때', () => {
        it('CMF는 1이다 (모두 매수 흐름)', () => {
            // CLV = (close-low-(high-close))/(high-low) = (high-low-(0))/(high-low) = 1
            const bars = Array.from({ length: 4 }, (_, i) =>
                makeBar(110, 100, 110, 1000, i)
            );
            const result = calculateCMF(bars, 3);
            expect(result[3]).toBeCloseTo(1, 5);
        });
    });

    describe('close가 항상 low일 때', () => {
        it('CMF는 -1이다 (모두 매도 흐름)', () => {
            const bars = Array.from({ length: 4 }, (_, i) =>
                makeBar(110, 100, 100, 1000, i)
            );
            const result = calculateCMF(bars, 3);
            expect(result[3]).toBeCloseTo(-1, 5);
        });
    });

    it('반환 배열 길이는 입력과 같다', () => {
        const bars = Array.from({ length: CMF_DEFAULT_PERIOD + 5 }, (_, i) =>
            makeBar(10 + i, 8 + i, 9 + i, 1000, i)
        );
        const result = calculateCMF(bars, CMF_DEFAULT_PERIOD);
        expect(result).toHaveLength(CMF_DEFAULT_PERIOD + 5);
    });
});
