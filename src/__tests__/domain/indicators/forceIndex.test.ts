import { describe, it, expect } from 'vitest';
import { calculateForceIndex } from '@/domain/indicators/forceIndex';
import { FORCE_INDEX_PERIOD } from '@/domain/indicators/constants';
import type { Bar } from '@/domain/types';

function makeBars(
    closes: number[],
    volumes?: number[],
    highs?: number[],
    lows?: number[]
): Bar[] {
    return closes.map((close, i) => ({
        time: i,
        open: close,
        high: highs ? highs[i] : close,
        low: lows ? lows[i] : close,
        close,
        volume: volumes ? volumes[i] : 1000,
    }));
}

// Force Index warmup: index 0 is null (needs prior bar), then EMA needs `period` raw values.
// raw[i] exists for i >= 1. EMA of `period` values needs period raw entries → indices 1..period.
// First non-null EMA index (in raw array): period - 1, which maps to bar index period.
const WARMUP = FORCE_INDEX_PERIOD;

describe('calculateForceIndex', () => {
    describe('빈 배열일 때', () => {
        it('빈 배열을 반환한다', () => {
            expect(calculateForceIndex([])).toEqual([]);
        });
    });

    describe('단일 bar', () => {
        it('단일 bar는 null을 반환한다', () => {
            const bars = makeBars([100]);
            const result = calculateForceIndex(bars);
            expect(result).toEqual([null]);
        });
    });

    describe('warmup 미만 입력', () => {
        it('모든 값이 null이다', () => {
            // With period=13, we need at least period+1 bars for any non-null result
            const bars = makeBars(
                Array.from({ length: WARMUP }, (_, i) => 100 + i)
            );
            const result = calculateForceIndex(bars);
            expect(result.every(v => v === null)).toBe(true);
        });
    });

    describe('정상 계산', () => {
        it('반환 배열 길이는 입력과 같다', () => {
            const n = WARMUP + 10;
            const bars = makeBars(Array.from({ length: n }, (_, i) => 100 + i));
            expect(calculateForceIndex(bars)).toHaveLength(n);
        });

        it('첫 번째 비-null 값이 인덱스 WARMUP에 위치한다', () => {
            const n = WARMUP + 5;
            const closes = Array.from({ length: n }, (_, i) => 100 + i);
            const bars = makeBars(closes);
            const result = calculateForceIndex(bars);
            for (let i = 0; i < WARMUP; i++) {
                expect(result[i]).toBeNull();
            }
            expect(result[WARMUP]).not.toBeNull();
        });

        it('제로 볼륨 bar는 0 기여를 가진다 (유한값)', () => {
            const n = WARMUP + 5;
            const closes = Array.from({ length: n }, (_, i) => 100 + i);
            const volumes = new Array(n).fill(0);
            const bars = makeBars(closes, volumes);
            const result = calculateForceIndex(bars);
            // zero volume → raw = 0 → EMA stays at 0 → all non-null values should be 0
            result.forEach(v => {
                if (v !== null) {
                    expect(Number.isFinite(v)).toBe(true);
                    expect(v).toBeCloseTo(0, 10);
                }
            });
        });

        it('음수 가격 움직임에서 음수 force index를 반환한다', () => {
            const n = WARMUP + 10;
            // Monotonically declining prices with positive volume
            const closes = Array.from({ length: n }, (_, i) => 200 - i);
            const volumes = new Array(n).fill(1000);
            const bars = makeBars(closes, volumes);
            const result = calculateForceIndex(bars);
            const nonNull = result.filter((v): v is number => v !== null);
            expect(nonNull.length).toBeGreaterThan(0);
            nonNull.forEach(v => expect(v).toBeLessThan(0));
        });

        it('상승 가격 움직임에서 양수 force index를 반환한다', () => {
            const n = WARMUP + 10;
            const closes = Array.from({ length: n }, (_, i) => 100 + i);
            const volumes = new Array(n).fill(1000);
            const bars = makeBars(closes, volumes);
            const result = calculateForceIndex(bars);
            const nonNull = result.filter((v): v is number => v !== null);
            expect(nonNull.length).toBeGreaterThan(0);
            nonNull.forEach(v => expect(v).toBeGreaterThan(0));
        });

        it('NaN과 Infinity가 없다', () => {
            const n = WARMUP + 10;
            const closes = Array.from({ length: n }, (_, i) => 100 + (i % 3));
            const bars = makeBars(closes);
            const result = calculateForceIndex(bars);
            result.forEach(v => {
                if (v !== null) {
                    expect(Number.isNaN(v)).toBe(false);
                    expect(Number.isFinite(v)).toBe(true);
                }
            });
        });

        it('수동 계산된 첫 번째 비-null 값이 근사하게 맞다', () => {
            // With period=2 (custom), bars: [100,101,102,103] (close diff=1, vol=1000 each)
            // raw: [null, 1*1000=1000, 1*1000=1000, 1*1000=1000]
            // EMA(2) of [1000, 1000, 1000]: seed=1000, all subsequent=1000
            // First non-null at index 2 (period=2)
            const bars = makeBars(
                [100, 101, 102, 103],
                [1000, 1000, 1000, 1000]
            );
            const result = calculateForceIndex(bars, 2);
            expect(result[0]).toBeNull();
            expect(result[1]).toBeNull();
            expect(result[2]).toBeCloseTo(1000, 5);
            expect(result[3]).toBeCloseTo(1000, 5);
        });

        it('유효하지 않은 period (≤0) → 입력 길이만큼 null 배열 반환', () => {
            const bars = makeBars(Array.from({ length: 5 }, (_, i) => 100 + i));
            const result = calculateForceIndex(bars, 0);
            expect(result).toHaveLength(5);
            result.forEach(v => expect(v).toBeNull());
        });
    });
});
