import { describe, it, expect } from 'vitest';
import { calculateBuySellVolume } from '@/domain/indicators/buySellVolume';
import type { Bar } from '@/domain/types';

function makeBar(
    close: number,
    high: number,
    low: number,
    volume: number,
    time = 0
): Bar {
    return { time, open: close, high, low, close, volume };
}

describe('calculateBuySellVolume', () => {
    describe('빈 배열일 때', () => {
        it('빈 배열을 반환한다', () => {
            expect(calculateBuySellVolume([])).toEqual([]);
        });
    });

    describe('range가 0일 때 (high === low)', () => {
        it('buyVolume과 sellVolume이 모두 0이다', () => {
            const bars = [makeBar(100, 100, 100, 1000)];
            expect(calculateBuySellVolume(bars)).toEqual([
                { buyVolume: 0, sellVolume: 0 },
            ]);
        });
    });

    describe('close가 high일 때', () => {
        it('buyVolume이 volume이고 sellVolume은 0이다', () => {
            // close=high=110, low=100: buyVolume = volume*(110-100)/(110-100) = volume
            const bars = [makeBar(110, 110, 100, 1000)];
            const result = calculateBuySellVolume(bars);
            expect(result[0].buyVolume).toBeCloseTo(1000, 5);
            expect(result[0].sellVolume).toBeCloseTo(0, 5);
        });
    });

    describe('close가 low일 때', () => {
        it('sellVolume이 volume이고 buyVolume은 0이다', () => {
            // close=low=100, high=110: sellVolume = volume*(110-100)/(110-100) = volume
            const bars = [makeBar(100, 110, 100, 1000)];
            const result = calculateBuySellVolume(bars);
            expect(result[0].buyVolume).toBeCloseTo(0, 5);
            expect(result[0].sellVolume).toBeCloseTo(1000, 5);
        });
    });

    describe('close가 중간일 때', () => {
        it('buyVolume + sellVolume === volume이다', () => {
            // high=110, low=90, close=100 (midpoint)
            // range=20, buyVolume = 1000*(100-90)/20 = 500, sellVolume = 1000*(110-100)/20 = 500
            const bars = [makeBar(100, 110, 90, 1000)];
            const result = calculateBuySellVolume(bars);
            expect(result[0].buyVolume).toBeCloseTo(500, 5);
            expect(result[0].sellVolume).toBeCloseTo(500, 5);
        });

        it('buyVolume + sellVolume은 항상 volume이다', () => {
            const bars = [makeBar(105, 110, 90, 1000)];
            const result = calculateBuySellVolume(bars);
            expect(result[0].buyVolume + result[0].sellVolume).toBeCloseTo(
                1000,
                5
            );
        });
    });

    it('반환 배열 길이는 입력과 같다', () => {
        const bars = Array.from({ length: 5 }, (_, i) =>
            makeBar(100 + i, 105 + i, 95 + i, 1000, i)
        );
        expect(calculateBuySellVolume(bars)).toHaveLength(5);
    });
});
