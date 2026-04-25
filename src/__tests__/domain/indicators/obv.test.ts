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
});
