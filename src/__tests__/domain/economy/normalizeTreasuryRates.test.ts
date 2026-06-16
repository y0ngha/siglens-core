import { describe, it, expect } from 'vitest';
import {
    normalizeTreasuryRates,
    computeYieldSpread,
} from '@/domain/economy/normalizeTreasuryRates';

describe('normalizeTreasuryRates', () => {
    it('최신(첫) 행에서 year2/year10 추출', () => {
        const snap = normalizeTreasuryRates([
            { date: '2026-06-15', year2: 4.07, year10: 4.47 },
            { date: '2026-06-12', year2: 4.09, year10: 4.48 },
        ]);
        expect(snap).toEqual({ date: '2026-06-15', year2: 4.07, year10: 4.47 });
    });

    it('빈 배열이면 null', () => {
        expect(normalizeTreasuryRates([])).toBeNull();
    });

    it('비배열 입력이면 null', () => {
        expect(normalizeTreasuryRates(null)).toBeNull();
    });

    it('year2/year10 결측이면 해당 필드 null', () => {
        const snap = normalizeTreasuryRates([
            { date: '2026-06-15', year10: 4.47 },
        ]);
        expect(snap?.year2).toBeNull();
        expect(snap?.year10).toBe(4.47);
    });

    it('date 결측이면 null', () => {
        expect(
            normalizeTreasuryRates([{ year2: 4.07, year10: 4.47 }])
        ).toBeNull();
    });

    it('wire가 oldest-first로 와도 최신 행을 추출(방어적 내림차순 정렬)', () => {
        const snap = normalizeTreasuryRates([
            { date: '2026-06-12', year2: 4.09, year10: 4.48 },
            { date: '2026-06-15', year2: 4.07, year10: 4.47 },
        ]);
        expect(snap).toEqual({ date: '2026-06-15', year2: 4.07, year10: 4.47 });
    });
});

describe('computeYieldSpread', () => {
    it('2s10s = year10 - year2', () => {
        expect(
            computeYieldSpread({ date: 'x', year2: 4.07, year10: 4.47 })
        ).toBeCloseTo(0.4);
    });

    it('역전(음수)도 그대로 반환', () => {
        expect(
            computeYieldSpread({ date: 'x', year2: 4.5, year10: 4.1 })
        ).toBeCloseTo(-0.4);
    });

    it('한쪽 null이면 null', () => {
        expect(
            computeYieldSpread({ date: 'x', year2: null, year10: 4.47 })
        ).toBeNull();
        expect(computeYieldSpread(null)).toBeNull();
    });
});
