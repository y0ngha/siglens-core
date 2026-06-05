import { describe, it, expect } from 'vitest';
import { calculateIndicators } from '@/domain/indicators/index';
import type { Bar } from '@/domain/types';

function makeBar(high: number, low: number, close: number, time: number): Bar {
    return { time, open: close, high, low, close, volume: 1000 };
}

// Every key calculateIndicators must return (24 base + 12 Phase 1 pro = 36).
const EXPECTED_KEYS = [
    'rsi',
    'macd',
    'bollinger',
    'dmi',
    'stochastic',
    'stochRsi',
    'cci',
    'vwap',
    'ma',
    'ema',
    'volumeProfile',
    'ichimoku',
    'atr',
    'obv',
    'parabolicSar',
    'williamsR',
    'supertrend',
    'mfi',
    'keltnerChannel',
    'cmf',
    'donchianChannel',
    'buySellVolume',
    'smc',
    'squeezeMomentum',
    'macdV',
    'connorsRsi',
    'forceIndex',
    'elderRay',
    'elderImpulse',
    'bollingerDerived',
    'chandelierExit',
    'yangZhang',
    'ewmaVolatility',
    'hurst',
    'varianceRatio',
    'regression',
] as const;

// Pro-indicator array fields that must equal bars.length.
const PRO_ARRAY_KEYS = [
    'macdV',
    'connorsRsi',
    'forceIndex',
    'elderRay',
    'elderImpulse',
    'bollingerDerived',
    'chandelierExit',
    'yangZhang',
    'ewmaVolatility',
    'hurst',
    'varianceRatio',
    'regression',
] as const;

// Longest pro-indicator warm-up is Hurst (window 100 → needs 101 closes) and
// Connors RSI percent-rank (period 100). 260 bars guarantees non-null tails.
const ENOUGH_BARS = 260;

/**
 * Build a deterministic, non-degenerate OHLCV series: a gentle uptrend plus a
 * bounded oscillation so every rolling window has real variance (no flat
 * sub-windows that would null out Hurst / regression r²).
 */
function buildBars(count: number): Bar[] {
    return Array.from({ length: count }, (_, i) => {
        const close = 100 + i * 0.5 + Math.sin(i / 5) * 4;
        const high = close + 2 + (i % 3);
        const low = close - 2 - (i % 4);
        return makeBar(high, low, close, i);
    });
}

describe('calculateIndicators', () => {
    describe('빈 배열일 때', () => {
        it('모든 배열 필드가 빈 배열이거나 null이다', () => {
            const result = calculateIndicators([]);
            expect(result.rsi).toEqual([]);
            expect(result.macd).toEqual([]);
            expect(result.bollinger).toEqual([]);
            expect(result.dmi).toEqual([]);
            expect(result.stochastic).toEqual([]);
            expect(result.stochRsi).toEqual([]);
            expect(result.cci).toEqual([]);
            expect(result.vwap).toEqual([]);
            expect(result.atr).toEqual([]);
            expect(result.obv).toEqual([]);
            expect(result.ichimoku).toEqual([]);
            expect(result.parabolicSar).toEqual([]);
            expect(result.williamsR).toEqual([]);
            expect(result.supertrend).toEqual([]);
            expect(result.mfi).toEqual([]);
            expect(result.keltnerChannel).toEqual([]);
            expect(result.cmf).toEqual([]);
            expect(result.donchianChannel).toEqual([]);
            expect(result.buySellVolume).toEqual([]);
            expect(result.squeezeMomentum).toEqual([]);
            expect(result.volumeProfile).toBeNull();
        });

        it('모든 pro-indicator 필드가 빈 배열이다', () => {
            const result = calculateIndicators([]);
            PRO_ARRAY_KEYS.forEach(key => {
                expect(result[key]).toEqual([]);
            });
        });
    });

    describe('충분한 데이터가 있을 때', () => {
        it('결과 객체에 36개의 필수 키가 모두 있다', () => {
            const result = calculateIndicators(buildBars(ENOUGH_BARS));
            EXPECTED_KEYS.forEach(key => {
                expect(key in result).toBe(true);
            });
            expect(Object.keys(result)).toHaveLength(36);
        });

        it('배열 필드들의 길이는 입력과 같다', () => {
            const result = calculateIndicators(buildBars(ENOUGH_BARS));
            expect(result.rsi).toHaveLength(ENOUGH_BARS);
            expect(result.macd).toHaveLength(ENOUGH_BARS);
            expect(result.bollinger).toHaveLength(ENOUGH_BARS);
            expect(result.atr).toHaveLength(ENOUGH_BARS);
            expect(result.obv).toHaveLength(ENOUGH_BARS);
            expect(result.ichimoku).toHaveLength(ENOUGH_BARS);
            expect(result.squeezeMomentum).toHaveLength(ENOUGH_BARS);
        });

        it('모든 pro-indicator 배열 길이는 입력과 같다', () => {
            const result = calculateIndicators(buildBars(ENOUGH_BARS));
            PRO_ARRAY_KEYS.forEach(key => {
                expect(result[key]).toHaveLength(ENOUGH_BARS);
            });
        });

        it('ma와 ema는 Record<number, array> 형태이다', () => {
            const result = calculateIndicators(buildBars(ENOUGH_BARS));
            expect(typeof result.ma).toBe('object');
            expect(typeof result.ema).toBe('object');
            Object.values(result.ma).forEach(arr => {
                expect(Array.isArray(arr)).toBe(true);
                expect(arr).toHaveLength(ENOUGH_BARS);
            });
            Object.values(result.ema).forEach(arr => {
                expect(Array.isArray(arr)).toBe(true);
                expect(arr).toHaveLength(ENOUGH_BARS);
            });
        });

        it('대표 pro-indicator의 tail 값이 non-null로 채워진다', () => {
            const result = calculateIndicators(buildBars(ENOUGH_BARS));
            const last = ENOUGH_BARS - 1;

            // Scalar pro-indicator tails.
            expect(result.macdV[last]).not.toBeNull();
            expect(typeof result.macdV[last]).toBe('number');
            expect(result.connorsRsi[last]).not.toBeNull();
            expect(result.forceIndex[last]).not.toBeNull();
            expect(result.yangZhang[last]).not.toBeNull();
            expect(result.ewmaVolatility[last]).not.toBeNull();
            expect(result.hurst[last]).not.toBeNull();
            expect(result.varianceRatio[last]).not.toBeNull();

            // Structured pro-indicator tails.
            expect(result.elderRay[last].bullPower).not.toBeNull();
            expect(result.elderRay[last].bearPower).not.toBeNull();
            expect(result.elderImpulse[last]).not.toBeNull();
            expect(result.bollingerDerived[last].pctB).not.toBeNull();
            expect(result.bollingerDerived[last].bandwidth).not.toBeNull();
            expect(result.chandelierExit[last].trend).not.toBeNull();
            expect(result.chandelierExit[last].longStop).not.toBeNull();
            expect(result.regression[last].slope).not.toBeNull();
            expect(result.regression[last].r2).not.toBeNull();
        });
    });
});
