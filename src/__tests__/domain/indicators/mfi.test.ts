import { describe, it, expect } from 'vitest';
import { calculateMFI } from '@/domain/indicators/mfi';
import { MFI_DEFAULT_PERIOD } from '@/domain/indicators/constants';
import type { Bar } from '@/domain/types';

function makeBar(
    high: number,
    low: number,
    close: number,
    volume: number,
    time: number
): Bar {
    return { time, open: close, high, low, close, volume };
}

describe('calculateMFI', () => {
    describe('빈 배열일 때', () => {
        it('빈 배열을 반환한다', () => {
            expect(calculateMFI([])).toEqual([]);
        });
    });

    describe('입력 길이가 period 이하일 때', () => {
        it('전부 null인 배열을 반환한다', () => {
            const bars = Array.from({ length: 3 }, (_, i) =>
                makeBar(10 + i, 8 + i, 9 + i, 1000, i)
            );
            expect(calculateMFI(bars, 3)).toEqual([null, null, null]);
        });
    });

    describe('MFI 계산', () => {
        it('처음 period개는 null이다', () => {
            const bars = Array.from(
                { length: MFI_DEFAULT_PERIOD + 2 },
                (_, i) => makeBar(10 + i, 8 + i, 9 + i, 1000, i)
            );
            const result = calculateMFI(bars, MFI_DEFAULT_PERIOD);
            for (let i = 0; i < MFI_DEFAULT_PERIOD; i++) {
                expect(result[i]).toBeNull();
            }
        });

        it('MFI는 0~100 범위이다', () => {
            const bars = Array.from(
                { length: MFI_DEFAULT_PERIOD + 5 },
                (_, i) => makeBar(100 + i, 90 + i, 95 + i, 1000, i)
            );
            const result = calculateMFI(bars, MFI_DEFAULT_PERIOD);
            result.forEach(v => {
                if (v !== null) {
                    expect(v).toBeGreaterThanOrEqual(0);
                    expect(v).toBeLessThanOrEqual(100);
                }
            });
        });

        it('negative money flow가 0이면 MFI는 100이다', () => {
            // 지속 상승: TP가 계속 오름 → 모두 양의 money flow
            const bars = Array.from(
                { length: MFI_DEFAULT_PERIOD + 2 },
                (_, i) => makeBar(100 + i * 2, 90 + i * 2, 95 + i * 2, 1000, i)
            );
            const result = calculateMFI(bars, MFI_DEFAULT_PERIOD);
            const lastValid = result[result.length - 1];
            expect(lastValid).toBeCloseTo(100, 5);
        });

        it('상승/하락 혼합 봉의 up/down 분류와 MFR 공식이 핀 고정된다', () => {
            // high=low=close=tp → TP === tp. 동일 거래량(V).
            // TPs: [10, 12, 11, 13], period 3, 인덱스 3 평가(유일한 유효값).
            //   비교 쌍(현재 vs 직전): 12>10(up, +12V), 11<12(down, +11V), 13>11(up, +13V)
            //   positive = (12+13)V = 25V, negative = 11V
            //   mfRatio = 25/11
            //   MFI = 100 - 100/(1 + 25/11) = 100 - 1100/36 = 69.4444…
            const tps = [10, 12, 11, 13];
            const bars = tps.map((tp, i) => makeBar(tp, tp, tp, 1000, i));
            const result = calculateMFI(bars, 3);
            expect(result[3]).toBeCloseTo(69.4444, 4);
        });

        it('반환 배열 길이는 입력과 같다', () => {
            const bars = Array.from(
                { length: MFI_DEFAULT_PERIOD + 5 },
                (_, i) => makeBar(10 + i, 8 + i, 9 + i, 1000, i)
            );
            const result = calculateMFI(bars, MFI_DEFAULT_PERIOD);
            expect(result).toHaveLength(MFI_DEFAULT_PERIOD + 5);
        });
    });

    describe('극단 입력', () => {
        it('완전 정지(TP가 변하지 않음)면 음/양 흐름이 모두 0이라 negative=0 가드로 MFI=100이다', () => {
            // 모든 봉이 동일 → tp>prev, tp<prev 모두 거짓 → positive=negative=0
            // negative === 0 분기로 MFI_MAX(100)을 반환한다 (상승장과 같은 가드, 다른 경로).
            const bars = Array.from(
                { length: MFI_DEFAULT_PERIOD + 2 },
                (_, i) => makeBar(12, 6, 9, 1000, i)
            );
            const result = calculateMFI(bars, MFI_DEFAULT_PERIOD);
            expect(result[result.length - 1]).toBe(100);
        });
    });
});
