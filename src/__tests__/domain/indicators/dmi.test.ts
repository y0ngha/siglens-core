import { describe, it, expect } from 'vitest';
import { calculateDMI } from '@/domain/indicators/dmi';
import { DMI_DEFAULT_PERIOD } from '@/domain/indicators/constants';
import type { Bar } from '@/domain/types';

function makeBar(high: number, low: number, close: number, time: number): Bar {
    return { time, open: close, high, low, close, volume: 1000 };
}

describe('calculateDMI', () => {
    describe('입력 길이가 period * 2 미만일 때', () => {
        it('전부 null인 결과 배열을 반환한다', () => {
            const bars = Array.from({ length: 5 }, (_, i) =>
                makeBar(10 + i, 8 + i, 9 + i, i)
            );
            const result = calculateDMI(bars, 3);
            result.forEach(r => {
                expect(r.diPlus).toBeNull();
                expect(r.diMinus).toBeNull();
                expect(r.adx).toBeNull();
            });
        });
    });

    describe('period 이후 값 계산', () => {
        it('처음 2*period - 1개는 null이다', () => {
            const barCount = 2 * DMI_DEFAULT_PERIOD + 5;
            const bars = Array.from({ length: barCount }, (_, i) =>
                makeBar(100 + i, 90 + i, 95 + i, i)
            );
            const result = calculateDMI(bars, DMI_DEFAULT_PERIOD);
            for (let i = 0; i < 2 * DMI_DEFAULT_PERIOD - 1; i++) {
                expect(result[i].diPlus).toBeNull();
                expect(result[i].diMinus).toBeNull();
                expect(result[i].adx).toBeNull();
            }
        });

        it('상승 추세에서 diPlus > diMinus이다', () => {
            // 지속 상승: high, low, close 모두 증가
            const bars = Array.from({ length: 40 }, (_, i) =>
                makeBar(100 + i * 2, 90 + i * 2, 95 + i * 2, i)
            );
            const result = calculateDMI(bars, DMI_DEFAULT_PERIOD);
            const validResults = result.filter(r => r.diPlus !== null);
            expect(validResults.length).toBeGreaterThan(0);
            validResults.forEach(r => {
                expect(r.diPlus!).toBeGreaterThan(r.diMinus!);
            });
        });

        it('하락 추세에서 diMinus > diPlus이다', () => {
            // 지속 하락: high, low, close 모두 감소 → downMove > 0 이고
            // downMove > upMove → dmMinus 계산 분기(line 29)를 탄다.
            const bars = Array.from({ length: 40 }, (_, i) =>
                makeBar(100 - i * 2, 90 - i * 2, 95 - i * 2, i)
            );
            const result = calculateDMI(bars, DMI_DEFAULT_PERIOD);
            const valid = result.filter(r => r.diMinus !== null);
            expect(valid.length).toBeGreaterThan(0);
            valid.forEach(r => {
                expect(r.diMinus!).toBeGreaterThan(r.diPlus!);
            });
        });

        it('모든 봉이 동일하면(완전 정지) 0-division 방어로 DI/DX가 0이 된다', () => {
            // high=low=close 가 모두 같으면 TR=0, +DM=-DM=0 →
            // `s.tr === 0 ? 0 : ...` (diPlus/diMinus) 와 `diSum === 0 ? 0 : ...`
            // (dx) 의 0-division 가드 분기를 탄다.
            const flat = Array.from({ length: 40 }, (_, i) =>
                makeBar(100, 100, 100, i)
            );
            const result = calculateDMI(flat, DMI_DEFAULT_PERIOD);
            const valid = result.filter(r => r.diPlus !== null);
            expect(valid.length).toBeGreaterThan(0);
            valid.forEach(r => {
                expect(r.diPlus).toBe(0);
                expect(r.diMinus).toBe(0);
                expect(r.adx).toBe(0);
            });
        });

        it('반환 배열 길이는 입력과 같다', () => {
            const bars = Array.from({ length: 40 }, (_, i) =>
                makeBar(100 + i, 90 + i, 95 + i, i)
            );
            const result = calculateDMI(bars, DMI_DEFAULT_PERIOD);
            expect(result).toHaveLength(40);
        });

        it('ADX는 0~100 범위이다', () => {
            const bars = Array.from({ length: 40 }, (_, i) =>
                makeBar(100 + i, 90 + i, 95 + i, i)
            );
            const result = calculateDMI(bars, DMI_DEFAULT_PERIOD);
            result.forEach(r => {
                if (r.adx !== null) {
                    expect(r.adx).toBeGreaterThanOrEqual(0);
                    expect(r.adx).toBeLessThanOrEqual(100);
                }
            });
        });

        it('단조 증가(step=2) bars에서 첫 유효 값은 diPlus≈20, diMinus≈0, adx≈100이다', () => {
            // DM+[i]=2(constant), DM-[i]=0, TR=10(constant)
            // Wilder smooth: DI+ = 2/10*100=20, DI- = 0, DX = |20-0|/(20+0)*100 = 100, ADX=100
            const bars = Array.from({ length: 40 }, (_, i) =>
                makeBar(100 + i * 2, 90 + i * 2, 95 + i * 2, i)
            );
            const result = calculateDMI(bars, DMI_DEFAULT_PERIOD);
            const firstValid = result[2 * DMI_DEFAULT_PERIOD - 1];
            expect(firstValid.diPlus).toBeCloseTo(20, 5);
            expect(firstValid.diMinus).toBeCloseTo(0, 5);
            expect(firstValid.adx).toBeCloseTo(100, 5);
        });
    });
});
