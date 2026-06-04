import { describe, it, expect } from 'vitest';
import { calculateMacdV } from '@/domain/indicators/macdV';
import {
    MACD_SLOW_PERIOD,
    MACD_V_ATR_PERIOD,
} from '@/domain/indicators/constants';
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

// Warmup = max(slowPeriod, atrPeriod) = max(26, 26) = 26
// First non-null MACD index: slowPeriod - 1 = 25
// First non-null ATR index: atrPeriod = 26 (ATR needs period+1 bars → index period)
// So first non-null MACD-V is at index 26
const WARMUP = Math.max(MACD_SLOW_PERIOD, MACD_V_ATR_PERIOD);

describe('calculateMacdV', () => {
    describe('빈 배열일 때', () => {
        it('빈 배열을 반환한다', () => {
            expect(calculateMacdV([])).toEqual([]);
        });
    });

    describe('warmup 미만 입력', () => {
        it('모든 값이 null이다', () => {
            const bars = makeBars(
                Array.from({ length: WARMUP }, (_, i) => 100 + i)
            );
            const result = calculateMacdV(bars);
            expect(result.every(v => v === null)).toBe(true);
        });
    });

    describe('정상 계산', () => {
        it('반환 배열 길이는 입력과 같다', () => {
            const n = WARMUP + 10;
            const bars = makeBars(Array.from({ length: n }, (_, i) => 100 + i));
            expect(calculateMacdV(bars)).toHaveLength(n);
        });

        it('warmup 이후 첫 번째 비-null 값을 반환한다', () => {
            const n = WARMUP + 5;
            const bars = makeBars(Array.from({ length: n }, (_, i) => 100 + i));
            const result = calculateMacdV(bars);
            // First WARMUP entries must be null
            for (let i = 0; i < WARMUP; i++) {
                expect(result[i]).toBeNull();
            }
            // At index WARMUP there should be a non-null value
            expect(result[WARMUP]).not.toBeNull();
        });

        it('단조 상승 시리즈에서 양수 MACD-V를 반환한다', () => {
            const n = WARMUP + 10;
            // Use bars with spread between high and low to ensure ATR > 0
            const closes = Array.from({ length: n }, (_, i) => 100 + i);
            const highs = closes.map(c => c + 1);
            const lows = closes.map(c => c - 1);
            const bars = makeBars(closes, highs, lows);
            const result = calculateMacdV(bars);
            const nonNull = result.filter((v): v is number => v !== null);
            expect(nonNull.length).toBeGreaterThan(0);
            // In a monotonically rising series, fast EMA > slow EMA → MACD > 0 → MACD-V > 0
            nonNull.forEach(v => expect(v).toBeGreaterThan(0));
        });

        it('ATR = 0 (완전히 평탄한 가격) 구간에서 null을 반환한다', () => {
            // Flat prices: open = high = low = close → TR = 0 → ATR = 0 → division guard → null
            const n = WARMUP + 5;
            const closes = new Array(n).fill(100);
            const bars = makeBars(closes);
            const result = calculateMacdV(bars);
            // All values must be null (ATR is 0 throughout)
            result.forEach(v => expect(v).toBeNull());
        });

        it('NaN과 Infinity가 없다', () => {
            const n = WARMUP + 10;
            const closes = Array.from({ length: n }, (_, i) => 100 + i * 0.5);
            const highs = closes.map(c => c + 0.5);
            const lows = closes.map(c => c - 0.5);
            const bars = makeBars(closes, highs, lows);
            const result = calculateMacdV(bars);
            result.forEach(v => {
                if (v !== null) {
                    expect(Number.isNaN(v)).toBe(false);
                    expect(Number.isFinite(v)).toBe(true);
                }
            });
        });

        it('수동 계산된 첫 번째 비-null 값이 근사하게 맞다', () => {
            // Simple case: linear increasing prices with fixed spread
            // Fast(12) SMA seed lag = (12-1)/2 = 5.5, slow(26) = 12.5 → MACD ≈ 7.0
            // ATR for flat-spread bars of +/-1 should converge near 2.0
            // MACD-V ≈ (7.0 / 2.0) * 100 = 350
            const n = WARMUP + 5;
            const closes = Array.from({ length: n }, (_, i) => 100 + i);
            const highs = closes.map(c => c + 1);
            const lows = closes.map(c => c - 1);
            const bars = makeBars(closes, highs, lows);
            const result = calculateMacdV(bars);
            const firstNonNull = result.find(v => v !== null);
            expect(firstNonNull).not.toBeUndefined();
            // MACD-V should be positive and in a reasonable range for this linear series
            expect(firstNonNull!).toBeGreaterThan(0);
            // For linear bars with ±1 spread, rough estimate: MACD≈7, ATR≈2, MACD-V≈350
            expect(firstNonNull!).toBeCloseTo(350, 0);
        });
    });

    describe('사용자 지정 파라미터', () => {
        it('커스텀 fast/slow/atr 파라미터를 사용한다', () => {
            const fast = 3;
            const slow = 5;
            const atrP = 3;
            // MACD first non-null: index slowPeriod - 1 = 4
            // ATR first non-null: index atrPeriod = 3
            // macdV first non-null: max(slowPeriod - 1, atrPeriod) = max(4, 3) = 4
            const warmup = Math.max(slow - 1, atrP);
            const n = 20;
            const closes = Array.from({ length: n }, (_, i) => 100 + i);
            const highs = closes.map(c => c + 1);
            const lows = closes.map(c => c - 1);
            const bars = makeBars(closes, highs, lows);
            const result = calculateMacdV(bars, fast, slow, atrP);
            expect(result).toHaveLength(n);
            // first warmup entries null
            for (let i = 0; i < warmup; i++) {
                expect(result[i]).toBeNull();
            }
            // index warmup should be non-null (both MACD and ATR are defined)
            expect(result[warmup]).not.toBeNull();
        });
    });
});
