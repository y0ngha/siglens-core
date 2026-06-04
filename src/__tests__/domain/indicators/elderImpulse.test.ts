import { describe, it, expect } from 'vitest';
import { calculateElderImpulse } from '@/domain/indicators/elderImpulse';
import type { Bar, ImpulseColor } from '@/domain/types';

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

// Warmup: need i >= 1, both ema[i]/ema[i-1] and hist[i]/hist[i-1] non-null.
// EMA warmup = ELDER_IMPULSE_EMA_PERIOD - 1 (first non-null at index period-1)
// MACD histogram warmup = MACD_SLOW_PERIOD + MACD_SIGNAL_PERIOD - 2
// Both + 1 for the "previous" comparison → first valid at max(period, slow+signal-1)
// With default: EMA_13, MACD slow=26, signal=9 → max(13, 34) = 34

describe('calculateElderImpulse', () => {
    describe('빈 배열일 때', () => {
        it('빈 배열을 반환한다', () => {
            expect(calculateElderImpulse([])).toEqual([]);
        });
    });

    describe('warmup 구간', () => {
        it('warmup 이전 값은 null이다', () => {
            // Need at least MACD slow+signal-1 bars for first histogram, plus one more for comparison
            const n = 60;
            const closes = Array.from({ length: n }, (_, i) => 100 + i);
            const bars = makeBars(closes);
            const result = calculateElderImpulse(bars);
            // Index 0 must be null (needs i-1)
            expect(result[0]).toBeNull();
        });

        it('충분한 데이터 이후 비-null 값이 존재한다', () => {
            const n = 50;
            const closes = Array.from({ length: n }, (_, i) => 100 + i);
            const bars = makeBars(closes);
            const result = calculateElderImpulse(bars);
            const nonNull = result.filter(v => v !== null);
            expect(nonNull.length).toBeGreaterThan(0);
        });
    });

    describe('컬러 분류', () => {
        it('가속 상승에서 green을 반환한다', () => {
            // Accelerating rises: exponential growth makes histogram increase AND EMA rise → green
            // Use emaPeriod=3 for fast warmup. With exponentially growing closes:
            // fast EMA grows faster → MACD grows → histogram grows → green
            const n = 40;
            // Exponential growth: histogram (fast-slow difference) keeps expanding
            const closes = Array.from(
                { length: n },
                (_, i) => 100 * Math.pow(1.05, i)
            );
            const bars = makeBars(closes);
            const result = calculateElderImpulse(bars, 3);
            const nonNull = result.filter((v): v is ImpulseColor => v !== null);
            expect(nonNull.length).toBeGreaterThan(0);
            const greens = nonNull.filter(v => v === 'green');
            expect(greens.length).toBeGreaterThan(0);
        });

        it('가속 하락에서 red를 반환한다', () => {
            // Accelerating decline: EMA falling AND histogram falling → red
            const n = 40;
            const closes = Array.from(
                { length: n },
                (_, i) => 500 * Math.pow(0.95, i)
            );
            const bars = makeBars(closes);
            const result = calculateElderImpulse(bars, 3);
            const nonNull = result.filter((v): v is ImpulseColor => v !== null);
            expect(nonNull.length).toBeGreaterThan(0);
            const reds = nonNull.filter(v => v === 'red');
            expect(reds.length).toBeGreaterThan(0);
        });

        it('반환값은 green/red/blue 중 하나이다', () => {
            const n = 60;
            const closes = Array.from({ length: n }, (_, i) => {
                return 100 + Math.sin(i * 0.3) * 20;
            });
            const bars = makeBars(closes);
            const result = calculateElderImpulse(bars);
            result.forEach(v => {
                if (v !== null) {
                    expect(['green', 'red', 'blue']).toContain(v);
                }
            });
        });

        it('동일 값(평탄) 시리즈에서 blue를 반환한다 (상승도 하락도 아님)', () => {
            // All equal: EMA flat (neither rising nor falling) and histogram = 0
            // (flat). Standard Elder Impulse: green needs BOTH strictly rising,
            // red needs BOTH strictly falling → a flat bar is blue, not red.
            const n = 60;
            const closes = new Array(n).fill(100);
            const bars = makeBars(closes);
            const result = calculateElderImpulse(bars);
            const nonNull = result.filter((v): v is ImpulseColor => v !== null);
            expect(nonNull.length).toBeGreaterThan(0);
            nonNull.forEach(v => expect(v).toBe('blue'));
        });

        it('혼합 신호에서 green과 red가 함께 발생한다 (sin파형)', () => {
            // A sin wave alternates between rising and falling phases.
            // emaPeriod=3 gives fast warmup so both green and red appear.
            const n = 60;
            const closes = Array.from({ length: n }, (_, i) => {
                return 100 + Math.sin(i * 0.5) * 20;
            });
            const bars = makeBars(closes);
            const result = calculateElderImpulse(bars, 3);
            const nonNull = result.filter((v): v is ImpulseColor => v !== null);
            expect(nonNull.length).toBeGreaterThan(0);
            const hasGreen = nonNull.some(v => v === 'green');
            const hasRed = nonNull.some(v => v === 'red');
            // A cyclic series must visit both bullish and bearish momentum
            expect(hasGreen).toBe(true);
            expect(hasRed).toBe(true);
        });
    });

    describe('특정 색상 시나리오', () => {
        it('커스텀 소형 파라미터에서 green과 red를 각각 검출한다', () => {
            // A sin wave with emaPeriod=3: the cyclic series produces both green (rising phases)
            // and red (falling phases) as confirmed by the algorithm.
            const n = 60;
            const closes = Array.from(
                { length: n },
                (_, i) => 100 + Math.sin(i * 0.5) * 20
            );
            const bars = makeBars(closes);
            const result = calculateElderImpulse(bars, 3);
            const nonNull = result.filter((v): v is ImpulseColor => v !== null);
            const hasGreen = nonNull.some(v => v === 'green');
            const hasRed = nonNull.some(v => v === 'red');
            expect(hasGreen).toBe(true);
            expect(hasRed).toBe(true);
        });

        it('blue 상태: EMA와 histogram이 반대 방향일 때 발생한다', () => {
            // Using a growth+decay series with emaPeriod=3:
            // After the peak, EMA is still rising while histogram is falling (or vice versa) → blue
            const closes = [
                ...Array.from(
                    { length: 30 },
                    (_, i) => 100 * Math.pow(1.04, i)
                ),
                ...Array.from({ length: 30 }, (_, i) => {
                    const peak = 100 * Math.pow(1.04, 29);
                    return peak * Math.pow(0.96, i + 1);
                }),
            ];
            const bars = makeBars(closes);
            const result = calculateElderImpulse(bars, 3);
            const nonNull = result.filter((v): v is ImpulseColor => v !== null);
            // The transition from growth to decay produces blue bars
            const hasBlue = nonNull.some(v => v === 'blue');
            expect(hasBlue).toBe(true);
        });
    });

    describe('반환 배열', () => {
        it('길이는 입력과 같다', () => {
            const n = 60;
            const bars = makeBars(Array.from({ length: n }, (_, i) => 100 + i));
            expect(calculateElderImpulse(bars)).toHaveLength(n);
        });
    });

    describe('유효하지 않은 파라미터 가드', () => {
        it('emaPeriod ≤0 → 입력 길이만큼 null 배열 반환', () => {
            const n = 5;
            const bars = makeBars(Array.from({ length: n }, (_, i) => 100 + i));
            const result = calculateElderImpulse(bars, 0);
            expect(result).toHaveLength(n);
            result.forEach(v => expect(v).toBeNull());
        });
    });
});
