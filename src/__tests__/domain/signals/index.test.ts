import { describe, it, expect } from 'vitest';
import { classifyTrend, detectSignals } from '@/domain/signals';
import { EMPTY_INDICATOR_RESULT } from '@/domain/indicators/constants';
import { calculateIndicators } from '@/domain/indicators';
import type { Bar, IndicatorResult } from '@/domain/types';

function barsOf(closes: readonly number[]): Bar[] {
    return closes.map((close, i) => ({
        time: 1700000000 + i * 86400,
        open: close,
        high: close,
        low: close,
        close,
        volume: 1000,
    }));
}

/** Confirmed MA-cross types of `detectSignals` on real indicators, detector order. */
function maCrossTypes(closes: readonly number[]): string[] {
    const bars = barsOf(closes);
    return detectSignals(bars, calculateIndicators(bars))
        .map(s => s.type)
        .filter(t =>
            [
                'golden_cross',
                'death_cross',
                'short_ma_bullish_cross',
                'short_ma_bearish_cross',
            ].includes(t)
        );
}

describe('detectSignals', () => {
    describe('빈 bars가 주어지면', () => {
        it('빈 배열을 반환한다', () => {
            expect(detectSignals([], EMPTY_INDICATOR_RESULT)).toEqual([]);
        });
    });

    describe('RSI가 극단 값을 가지면', () => {
        it('해당 확정 신호를 포함한다', () => {
            const bars: Bar[] = Array.from({ length: 20 }, (_, i) => ({
                time: 1 + i,
                open: 100,
                high: 100,
                low: 100,
                close: 100,
                volume: 100,
            }));
            const indicators: IndicatorResult = {
                ...EMPTY_INDICATOR_RESULT,
                rsi: [...Array(19).fill(50), 25],
            };
            const signals = detectSignals(bars, indicators);
            expect(signals.some(s => s.type === 'rsi_oversold')).toBe(true);
        });
    });

    describe('모든 감지기가 null일 때', () => {
        it('빈 배열을 반환한다', () => {
            const bars: Bar[] = Array.from({ length: 20 }, (_, i) => ({
                time: 1 + i,
                open: 100,
                high: 100,
                low: 100,
                close: 100,
                volume: 100,
            }));
            const indicators: IndicatorResult = {
                ...EMPTY_INDICATOR_RESULT,
                rsi: Array(20).fill(50),
            };
            expect(detectSignals(bars, indicators)).toEqual([]);
        });
    });

    describe('classifyTrend 재노출', () => {
        it('signals 인덱스에서 classifyTrend를 호출할 수 있다', () => {
            const bars: Bar[] = Array.from({ length: 20 }, (_, i) => ({
                time: 1 + i,
                open: 100,
                high: 100,
                low: 100,
                close: 100,
                volume: 100,
            }));
            expect(classifyTrend(bars, EMPTY_INDICATOR_RESULT)).toBeDefined();
        });
    });

    describe('MA 교차 신호 이름 (C11e)', () => {
        const flat = Array<number>(300).fill(100);

        it('20/50만 교차하면 short_ma_bullish_cross만 나온다', () => {
            const closes = [
                ...Array.from({ length: 45 }, (_, i) => 100 - i * 0.5),
                ...Array.from({ length: 15 }, (_, i) => 77.5 + i * 2),
            ];
            expect(maCrossTypes(closes)).toEqual(['short_ma_bullish_cross']);
        });

        it('20/50만 하락 교차하면 short_ma_bearish_cross만 나온다', () => {
            const closes = [
                ...Array.from({ length: 45 }, (_, i) => 100 + i * 0.5),
                ...Array.from({ length: 15 }, (_, i) => 122.5 - i * 2),
            ];
            expect(maCrossTypes(closes)).toEqual(['short_ma_bearish_cross']);
        });

        it('평탄한 구간 뒤 급등 봉에서 20/50과 50/200이 함께 교차하면 감지기 순서로 둘 다 나온다', () => {
            expect(maCrossTypes([...flat, 130])).toEqual([
                'golden_cross',
                'short_ma_bullish_cross',
            ]);
        });

        it('급락 봉이면 데드크로스와 단기 이평 하락 교차가 함께 나온다', () => {
            expect(maCrossTypes([...flat, 70])).toEqual([
                'death_cross',
                'short_ma_bearish_cross',
            ]);
        });

        it('200봉 이하에서는 50/200 교차가 없고 20/50만 남는다', () => {
            expect(maCrossTypes([...flat.slice(0, 150), 130])).toEqual([
                'short_ma_bullish_cross',
            ]);
        });
    });
});
