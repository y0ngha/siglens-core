import { describe, expect, it } from 'vitest';
import { calculateBuySellVolume } from '@/domain/indicators/buySellVolume';
import { fearGreedInputs } from '@/domain/indicators/fearGreed/inputs';
import { calculateIndicators } from '@/domain/indicators';
import type { Bar, BarsData } from '@/domain/types';

function bar(i: number): Bar {
    return {
        time: 1_700_000_000 + i * 86_400,
        open: 100 + i,
        high: 102 + i,
        low: 98 + i,
        close: 101 + i,
        volume: 1_000 + i,
    };
}

const longBars = Array.from({ length: 10 }, (_, i) => bar(i));
const standardBars = longBars.slice(-4);

describe('fearGreedInputs', () => {
    it('fearGreedBars가 있으면 5년 봉과 그 봉의 매수·매도 거래량을 돌려준다', () => {
        const data: BarsData = {
            bars: standardBars,
            indicators: calculateIndicators(standardBars),
            fearGreedBars: longBars,
        };

        const input = fearGreedInputs(data);

        expect(input.bars).toBe(longBars);
        expect(input.buySellVolume).toEqual(calculateBuySellVolume(longBars));
        expect(input.buySellVolume).toHaveLength(longBars.length);
    });

    it('겹치는 꼬리 구간의 매수·매도 거래량은 표준 구간 지표와 같다', () => {
        const data: BarsData = {
            bars: standardBars,
            indicators: calculateIndicators(standardBars),
            fearGreedBars: longBars,
        };

        const input = fearGreedInputs(data);

        expect(input.buySellVolume.slice(-standardBars.length)).toEqual(
            data.indicators.buySellVolume
        );
    });

    it('fearGreedBars가 없으면 기존 봉과 지표의 매수·매도 거래량을 그대로 쓴다', () => {
        const indicators = calculateIndicators(standardBars);
        const data: BarsData = { bars: standardBars, indicators };

        const input = fearGreedInputs(data);

        expect(input.bars).toBe(standardBars);
        expect(input.buySellVolume).toBe(indicators.buySellVolume);
    });

    it('fearGreedBars가 빈 배열이면 기존 봉으로 돌아간다', () => {
        const indicators = calculateIndicators(standardBars);
        const data: BarsData = {
            bars: standardBars,
            indicators,
            fearGreedBars: [],
        };

        expect(fearGreedInputs(data).bars).toBe(standardBars);
    });
});
