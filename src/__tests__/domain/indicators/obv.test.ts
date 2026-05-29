import { describe, it, expect } from 'vitest';
import { calculateOBV } from '@/domain/indicators/obv';
import type { Bar } from '@/domain/types';

function makeBar(close: number, volume: number, time: number): Bar {
    return { time, open: close, high: close, low: close, close, volume };
}

describe('calculateOBV', () => {
    describe('빈 배열일 때', () => {
        it('빈 배열을 반환한다', () => {
            expect(calculateOBV([])).toEqual([]);
        });
    });

    describe('단일 bar일 때', () => {
        it('첫 번째 OBV는 0이다', () => {
            const bars = [makeBar(100, 1000, 0)];
            expect(calculateOBV(bars)).toEqual([0]);
        });
    });

    describe('여러 bar일 때', () => {
        it('상승 bar에서 volume을 더한다', () => {
            const bars = [makeBar(100, 1000, 0), makeBar(110, 500, 1)];
            expect(calculateOBV(bars)).toEqual([0, 500]);
        });

        it('하락 bar에서 volume을 뺀다', () => {
            const bars = [makeBar(110, 1000, 0), makeBar(100, 500, 1)];
            expect(calculateOBV(bars)).toEqual([0, -500]);
        });

        it('보합 bar에서는 OBV가 유지된다', () => {
            const bars = [makeBar(100, 1000, 0), makeBar(100, 500, 1)];
            expect(calculateOBV(bars)).toEqual([0, 0]);
        });

        it('여러 bar에 걸쳐 올바르게 누적된다', () => {
            // 0: OBV=0, +500 상승, -300 하락, +200 상승
            const bars = [
                makeBar(100, 1000, 0),
                makeBar(110, 500, 1), // +500 → 500
                makeBar(105, 300, 2), // -300 → 200
                makeBar(115, 200, 3), // +200 → 400
            ];
            expect(calculateOBV(bars)).toEqual([0, 500, 200, 400]);
        });

        it('반환 배열 길이는 입력과 같다', () => {
            const bars = Array.from({ length: 10 }, (_, i) =>
                makeBar(100 + i, 1000, i)
            );
            expect(calculateOBV(bars)).toHaveLength(10);
        });
    });

    describe('극단 입력', () => {
        it('NaN close는 방향 판정 불가로 직전 OBV를 유지하고, 이후 유한 close에서 정상 회복한다', () => {
            // NaN 봉: close > prevClose / close < prevClose 모두 NaN 비교라
            // false → 보합처럼 prev 유지. NaN 봉 직후 봉도 prevClose가 NaN이라
            // 유지되지만, 그 다음 봉부터는 직전 유한 close와 비교되어 정상
            // 누적이 재개된다.
            const bars = [
                makeBar(100, 1000, 0),
                makeBar(NaN, 500, 1), // 방향 불명 → 0 유지
                makeBar(110, 300, 2), // 110 vs NaN → 0 유지
                makeBar(120, 200, 3), // 120 > 110(직전 유한 close) → +200 회복
            ];
            expect(calculateOBV(bars)).toEqual([0, 0, 0, 200]);
        });

        it('음수 volume이면 상승 봉에서 OBV가 오히려 감소한다', () => {
            // 상승 봉이지만 volume이 음수 → prev + (-500)
            const bars = [makeBar(100, 1000, 0), makeBar(110, -500, 1)];
            expect(calculateOBV(bars)).toEqual([0, -500]);
        });
    });
});
