import { describe, it, expect } from 'vitest';
import { calculateIndicators } from '@/domain/indicators/index';
import {
    ICHIMOKU_DISPLACEMENT,
    ICHIMOKU_SPAN_B_PERIOD,
} from '@/domain/indicators/constants';
import type { Bar } from '@/domain/types';

function makeBar(high: number, low: number, close: number, time: number): Bar {
    return { time, open: close, high, low, close, volume: 1000 };
}

// calculateIndicators 내부 가장 긴 warmup = ICHIMOKU_SPAN_B_PERIOD + ICHIMOKU_DISPLACEMENT
const ENOUGH_BARS = ICHIMOKU_SPAN_B_PERIOD + ICHIMOKU_DISPLACEMENT + 22;

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
    });

    describe('충분한 데이터가 있을 때', () => {
        it('결과 객체에 모든 필수 키가 있다', () => {
            const bars = Array.from({ length: ENOUGH_BARS }, (_, i) =>
                makeBar(100 + (i % 10), 90 + (i % 8), 95 + (i % 9), i)
            );
            const result = calculateIndicators(bars);
            const expectedKeys = [
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
            ];
            expectedKeys.forEach(key => {
                expect(key in result).toBe(true);
            });
        });

        it('배열 필드들의 길이는 입력과 같다', () => {
            const bars = Array.from({ length: ENOUGH_BARS }, (_, i) =>
                makeBar(100 + (i % 10), 90 + (i % 8), 95 + (i % 9), i)
            );
            const result = calculateIndicators(bars);
            expect(result.rsi).toHaveLength(ENOUGH_BARS);
            expect(result.macd).toHaveLength(ENOUGH_BARS);
            expect(result.bollinger).toHaveLength(ENOUGH_BARS);
            expect(result.atr).toHaveLength(ENOUGH_BARS);
            expect(result.obv).toHaveLength(ENOUGH_BARS);
            expect(result.ichimoku).toHaveLength(ENOUGH_BARS);
            expect(result.squeezeMomentum).toHaveLength(ENOUGH_BARS);
        });

        it('ma와 ema는 Record<number, array> 형태이다', () => {
            const bars = Array.from({ length: ENOUGH_BARS }, (_, i) =>
                makeBar(100 + i, 90 + i, 95 + i, i)
            );
            const result = calculateIndicators(bars);
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
    });
});
