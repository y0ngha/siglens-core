import { describe, it, expect } from 'vitest';
import { calculateVWAP } from '@/domain/indicators/vwap';
import { SECONDS_PER_DAY } from '@/domain/constants/time';
import type { Bar } from '@/domain/types';

function makeBar(close: number, volume: number, time: number): Bar {
    return { time, open: close, high: close, low: close, close, volume };
}

describe('calculateVWAP', () => {
    describe('빈 배열일 때', () => {
        it('빈 배열을 반환한다', () => {
            expect(calculateVWAP([])).toEqual([]);
        });
    });

    describe('단일 bar일 때', () => {
        it('close와 같은 VWAP을 반환한다', () => {
            const bars = [makeBar(100, 1000, 0)];
            expect(calculateVWAP(bars)).toEqual([100]);
        });
    });

    describe('volume이 0일 때', () => {
        it('null을 반환한다', () => {
            const bars = [makeBar(100, 0, 0)];
            expect(calculateVWAP(bars)).toEqual([null]);
        });
    });

    describe('같은 날 여러 bar일 때', () => {
        it('누적 VWAP을 계산한다', () => {
            // 같은 날(dayKey=0): time=0, time=1
            // TP=close=high=low, bar0: TP*vol=100*1000=100000, bar1: TP*vol=200*2000=400000
            // VWAP[0] = 100000/1000 = 100
            // VWAP[1] = (100000+400000)/(1000+2000) = 166.67
            const bars = [makeBar(100, 1000, 0), makeBar(200, 2000, 1)];
            const result = calculateVWAP(bars);
            expect(result[0]).toBeCloseTo(100, 5);
            expect(result[1]).toBeCloseTo(500000 / 3000, 5);
        });
    });

    describe('새로운 날에 초기화할 때', () => {
        it('새 날에 VWAP이 리셋된다', () => {
            const day0Bar = makeBar(100, 1000, 0);
            const day1Bar = makeBar(200, 2000, SECONDS_PER_DAY);
            const result = calculateVWAP([day0Bar, day1Bar]);
            // day1: TP*vol=200*2000, vol=2000 → VWAP = 200
            expect(result[1]).toBeCloseTo(200, 5);
        });
    });

    it('반환 배열 길이는 입력과 같다', () => {
        const bars = Array.from({ length: 5 }, (_, i) =>
            makeBar(100 + i, 1000, i)
        );
        expect(calculateVWAP(bars)).toHaveLength(5);
    });
});
