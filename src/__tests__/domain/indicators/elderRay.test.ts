import { describe, it, expect } from 'vitest';
import { calculateElderRay } from '@/domain/indicators/elderRay';
import { ELDER_RAY_PERIOD } from '@/domain/indicators/constants';
import type { Bar } from '@/domain/types';

function makeBars(closes: number[], highs?: number[], lows?: number[]): Bar[] {
    return closes.map((close, i) => ({
        time: i,
        open: close,
        high: highs ? highs[i] : close,
        low: lows ? lows[i] : close,
        close,
        volume: 1000,
    }));
}

describe('calculateElderRay', () => {
    describe('빈 배열일 때', () => {
        it('빈 배열을 반환한다', () => {
            expect(calculateElderRay([])).toEqual([]);
        });
    });

    describe('warmup 구간', () => {
        it('처음 period-1개는 null이다', () => {
            const n = ELDER_RAY_PERIOD + 5;
            const closes = Array.from({ length: n }, (_, i) => 100 + i);
            const highs = closes.map(c => c + 1);
            const lows = closes.map(c => c - 1);
            const bars = makeBars(closes, highs, lows);
            const result = calculateElderRay(bars);
            for (let i = 0; i < ELDER_RAY_PERIOD - 1; i++) {
                expect(result[i].bullPower).toBeNull();
                expect(result[i].bearPower).toBeNull();
            }
        });

        it('period 이후 non-null 값이 존재한다', () => {
            const n = ELDER_RAY_PERIOD + 5;
            const closes = Array.from({ length: n }, (_, i) => 100 + i);
            const highs = closes.map(c => c + 1);
            const lows = closes.map(c => c - 1);
            const bars = makeBars(closes, highs, lows);
            const result = calculateElderRay(bars);
            expect(result[ELDER_RAY_PERIOD - 1].bullPower).not.toBeNull();
            expect(result[ELDER_RAY_PERIOD - 1].bearPower).not.toBeNull();
        });
    });

    describe('정상 계산', () => {
        it('반환 배열 길이는 입력과 같다', () => {
            const n = ELDER_RAY_PERIOD + 10;
            const bars = makeBars(Array.from({ length: n }, (_, i) => 100 + i));
            expect(calculateElderRay(bars)).toHaveLength(n);
        });

        it('bullPower = high - EMA', () => {
            // Single period: use period=1 so EMA = close
            // high = close + 2, low = close - 2
            // bullPower = high - EMA = (close+2) - close = 2
            const n = 10;
            const closes = Array.from({ length: n }, (_, i) => 100 + i);
            const highs = closes.map(c => c + 2);
            const lows = closes.map(c => c - 2);
            const bars = makeBars(closes, highs, lows);
            const result = calculateElderRay(bars, 1);
            // EMA(1) = each close value; bullPower = high - close = +2 always
            result.forEach(r => {
                if (r.bullPower !== null) {
                    expect(r.bullPower).toBeCloseTo(2, 5);
                }
            });
        });

        it('bearPower = low - EMA (음수)', () => {
            const n = 10;
            const closes = Array.from({ length: n }, (_, i) => 100 + i);
            const highs = closes.map(c => c + 2);
            const lows = closes.map(c => c - 2);
            const bars = makeBars(closes, highs, lows);
            const result = calculateElderRay(bars, 1);
            // EMA(1) = close; bearPower = low - close = -2 always
            result.forEach(r => {
                if (r.bearPower !== null) {
                    expect(r.bearPower).toBeCloseTo(-2, 5);
                }
            });
        });

        it('수동 계산: 단일 period=1에서 bullPower/bearPower 정확성', () => {
            const bars = makeBars(
                [100, 102, 105],
                [101, 103, 106],
                [99, 101, 104]
            );
            const result = calculateElderRay(bars, 1);
            // period=1: EMA = close
            // bar 0: EMA=100, bull=101-100=1, bear=99-100=-1
            expect(result[0].bullPower).toBeCloseTo(1, 5);
            expect(result[0].bearPower).toBeCloseTo(-1, 5);
            // bar 1: EMA=102, bull=103-102=1, bear=101-102=-1
            expect(result[1].bullPower).toBeCloseTo(1, 5);
            expect(result[1].bearPower).toBeCloseTo(-1, 5);
        });

        it('평탄한 가격에서 NaN이 없다', () => {
            const n = ELDER_RAY_PERIOD + 5;
            const closes = new Array(n).fill(100);
            const highs = new Array(n).fill(101);
            const lows = new Array(n).fill(99);
            const bars = makeBars(closes, highs, lows);
            const result = calculateElderRay(bars);
            result.forEach(r => {
                if (r.bullPower !== null) {
                    expect(Number.isNaN(r.bullPower)).toBe(false);
                    expect(Number.isNaN(r.bearPower as number)).toBe(false);
                }
            });
        });

        it('평탄한 시리즈에서 bullPower=spread, bearPower=-spread', () => {
            // All closes same, high=close+1, low=close-1 → EMA converges to close=100
            const n = ELDER_RAY_PERIOD + 5;
            const closes = new Array(n).fill(100);
            const highs = new Array(n).fill(101);
            const lows = new Array(n).fill(99);
            const bars = makeBars(closes, highs, lows);
            const result = calculateElderRay(bars);
            const valid = result.filter(r => r.bullPower !== null);
            expect(valid.length).toBeGreaterThan(0);
            valid.forEach(r => {
                // EMA of constant 100 = 100; bull = 101-100 = 1; bear = 99-100 = -1
                expect(r.bullPower!).toBeCloseTo(1, 5);
                expect(r.bearPower!).toBeCloseTo(-1, 5);
            });
        });

        it('유효하지 않은 period (≤0) → 입력 길이만큼 null 객체 배열 반환', () => {
            const n = 5;
            const closes = Array.from({ length: n }, (_, i) => 100 + i);
            const bars = makeBars(closes);
            const result = calculateElderRay(bars, 0);
            expect(result).toHaveLength(n);
            result.forEach(r => {
                expect(r.bullPower).toBeNull();
                expect(r.bearPower).toBeNull();
            });
        });
    });
});
