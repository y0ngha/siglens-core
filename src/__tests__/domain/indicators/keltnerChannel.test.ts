import { describe, it, expect } from 'vitest';
import { calculateKeltnerChannel } from '@/domain/indicators/keltnerChannel';
import {
    KELTNER_EMA_PERIOD,
    KELTNER_ATR_PERIOD,
    KELTNER_MULTIPLIER,
} from '@/domain/indicators/constants';
import type { Bar } from '@/domain/types';

function makeBar(close: number, time: number): Bar {
    return {
        time,
        open: close,
        high: close + 5,
        low: close - 5,
        close,
        volume: 1000,
    };
}

const MIN_BARS = Math.max(KELTNER_EMA_PERIOD, KELTNER_ATR_PERIOD) + 1;

describe('calculateKeltnerChannel', () => {
    describe('빈 배열일 때', () => {
        it('빈 배열을 반환한다', () => {
            expect(calculateKeltnerChannel([])).toEqual([]);
        });
    });

    describe('충분한 데이터가 없을 때', () => {
        it('전부 null인 결과를 반환한다', () => {
            const bars = Array.from({ length: 2 }, (_, i) =>
                makeBar(100 + i, i)
            );
            const result = calculateKeltnerChannel(
                bars,
                KELTNER_EMA_PERIOD,
                KELTNER_ATR_PERIOD
            );
            result.forEach(r => {
                expect(r.upper).toBeNull();
                expect(r.middle).toBeNull();
                expect(r.lower).toBeNull();
            });
        });
    });

    describe('충분한 데이터가 있을 때', () => {
        it('마지막 결과는 null이 아니다', () => {
            const bars = Array.from({ length: MIN_BARS + 5 }, (_, i) =>
                makeBar(100 + i, i)
            );
            const result = calculateKeltnerChannel(
                bars,
                KELTNER_EMA_PERIOD,
                KELTNER_ATR_PERIOD,
                KELTNER_MULTIPLIER
            );
            const last = result[result.length - 1];
            expect(last.upper).not.toBeNull();
            expect(last.middle).not.toBeNull();
            expect(last.lower).not.toBeNull();
        });

        it('upper > middle > lower이다', () => {
            const bars = Array.from({ length: MIN_BARS + 5 }, (_, i) =>
                makeBar(100 + i, i)
            );
            const result = calculateKeltnerChannel(
                bars,
                KELTNER_EMA_PERIOD,
                KELTNER_ATR_PERIOD,
                KELTNER_MULTIPLIER
            );
            result.forEach(r => {
                if (r.upper !== null && r.middle !== null && r.lower !== null) {
                    expect(r.upper).toBeGreaterThan(r.middle);
                    expect(r.middle).toBeGreaterThan(r.lower);
                }
            });
        });

        it('반환 배열 길이는 입력과 같다', () => {
            const bars = Array.from({ length: MIN_BARS + 5 }, (_, i) =>
                makeBar(100 + i, i)
            );
            const result = calculateKeltnerChannel(
                bars,
                KELTNER_EMA_PERIOD,
                KELTNER_ATR_PERIOD,
                KELTNER_MULTIPLIER
            );
            expect(result).toHaveLength(MIN_BARS + 5);
        });
    });
});
