import { describe, it, expect } from 'vitest';
import type { Bar } from '@/domain/types';
import { calculateYangZhang } from '@/domain/indicators/yangZhang';
import {
    YANG_ZHANG_PERIOD,
    YANG_ZHANG_K_NUM,
    YANG_ZHANG_K_DEN_BASE,
} from '@/domain/indicators/constants';

function makeBar(open: number, high: number, low: number, close: number): Bar {
    return { time: 0, open, high, low, close, volume: 1000 };
}

/** Independent reference implementation of the Yang-Zhang window estimate. */
function refYangZhang(
    window: Bar[],
    prevClose: number,
    period: number
): number {
    const closes = [prevClose, ...window.map(b => b.close)];
    const overnight: number[] = [];
    const openClose: number[] = [];
    const rs: number[] = [];
    window.forEach((b, idx) => {
        const pc = closes[idx];
        overnight.push(Math.log(b.open / pc));
        openClose.push(Math.log(b.close / b.open));
        rs.push(
            Math.log(b.high / b.close) * Math.log(b.high / b.open) +
                Math.log(b.low / b.close) * Math.log(b.low / b.open)
        );
    });
    const n = window.length;
    const meanO = overnight.reduce((s, v) => s + v, 0) / n;
    const meanC = openClose.reduce((s, v) => s + v, 0) / n;
    const varO = overnight.reduce((s, v) => s + (v - meanO) ** 2, 0) / (n - 1);
    const varC = openClose.reduce((s, v) => s + (v - meanC) ** 2, 0) / (n - 1);
    const meanRs = rs.reduce((s, v) => s + v, 0) / n;
    const k =
        YANG_ZHANG_K_NUM /
        (YANG_ZHANG_K_DEN_BASE + (period + 1) / (period - 1));
    const varYz = varO + k * varC + (1 - k) * meanRs;
    return Math.sqrt(Math.max(0, varYz));
}

describe('calculateYangZhang', () => {
    describe('빈 배열 / 워밍업', () => {
        it('빈 배열은 빈 배열을 반환한다', () => {
            expect(calculateYangZhang([])).toEqual([]);
        });

        it('period+1 보다 짧으면 모두 null이다', () => {
            // period=4 → need 5 bars (4 terms + 1 prior close); 4 bars → all null.
            const bars = Array.from({ length: 4 }, () =>
                makeBar(100, 102, 99, 101)
            );
            const result = calculateYangZhang(bars, 4);
            expect(result).toHaveLength(4);
            result.forEach(v => expect(v).toBeNull());
        });

        it('첫 valid 값은 index = period 에서 나온다', () => {
            const period = 4;
            const bars = Array.from({ length: 6 }, (_, i) =>
                makeBar(100 + i, 103 + i, 98 + i, 101 + i)
            );
            const result = calculateYangZhang(bars, period);
            // indices 0..period-1 are null, index period is first non-null.
            for (let i = 0; i < period; i++) expect(result[i]).toBeNull();
            expect(result[period]).not.toBeNull();
        });
    });

    describe('정상 계산', () => {
        it('수동(참조) 계산: 작은 OHLC 윈도우에서 정확한 값', () => {
            const period = 3;
            // 4 bars: prevClose = bars[0].close, window = bars[1..3].
            const bars: Bar[] = [
                makeBar(100, 105, 98, 102),
                makeBar(103, 108, 101, 106),
                makeBar(107, 110, 104, 105),
                makeBar(106, 112, 103, 109),
            ];
            const result = calculateYangZhang(bars, period);
            // first valid at index = period = 3, window = bars[1..3], prevClose = bars[0].close
            const expected = refYangZhang(
                bars.slice(1, 4),
                bars[0].close,
                period
            );
            expect(result[3]).toBeCloseTo(expected, 12);
        });

        it('반환 배열 길이는 입력 bars 길이와 같다', () => {
            const bars = Array.from({ length: 30 }, (_, i) =>
                makeBar(100 + i, 103 + i, 97 + i, 101 + i)
            );
            const result = calculateYangZhang(bars);
            expect(result).toHaveLength(bars.length);
        });

        it('기본 period(20)에서 워밍업 후 non-null', () => {
            const bars = Array.from({ length: 25 }, (_, i) =>
                makeBar(
                    100 + Math.sin(i),
                    102 + Math.sin(i),
                    98 + Math.sin(i),
                    101 + Math.cos(i)
                )
            );
            const result = calculateYangZhang(bars);
            expect(result[YANG_ZHANG_PERIOD]).not.toBeNull();
            expect(Number.isFinite(result[YANG_ZHANG_PERIOD]!)).toBe(true);
        });
    });

    describe('경계 케이스', () => {
        it('완전 평탄한 가격 → 변동성 ≈ 0', () => {
            // O=H=L=C identical every bar → all log terms 0 → vol 0.
            const bars = Array.from({ length: 10 }, () =>
                makeBar(100, 100, 100, 100)
            );
            const result = calculateYangZhang(bars, 4);
            const valid = result.filter((v): v is number => v !== null);
            expect(valid.length).toBeGreaterThan(0);
            valid.forEach(v => expect(v).toBeCloseTo(0, 12));
        });

        it('윈도우에 비-양수 가격이 있으면 그 bar는 null (ln 방어)', () => {
            const period = 3;
            const bars: Bar[] = [
                makeBar(100, 105, 98, 102),
                makeBar(103, 108, 101, 106),
                makeBar(0, 110, 104, 105), // open = 0 → invalid term
                makeBar(106, 112, 103, 109),
                makeBar(108, 114, 105, 111),
                makeBar(110, 116, 107, 113),
            ];
            const result = calculateYangZhang(bars, period);
            // index 3 window = terms[1..3]; term[2] (open=0) invalid → null.
            expect(result[3]).toBeNull();
            // index 5 window = terms[3..5]; all positive → non-null.
            expect(result[5]).not.toBeNull();
        });

        it('음수 가격도 방어한다 (NaN/Infinity 없음)', () => {
            const bars: Bar[] = [
                makeBar(100, 105, 98, 102),
                makeBar(103, 108, 101, 106),
                makeBar(-5, 110, 104, 105),
                makeBar(106, 112, 103, 109),
            ];
            const result = calculateYangZhang(bars, 3);
            result.forEach(v => {
                if (v !== null) {
                    expect(Number.isNaN(v)).toBe(false);
                    expect(Number.isFinite(v)).toBe(true);
                }
            });
        });

        it('period=1 (단일 항 윈도우) → 분산 미정의 → null', () => {
            // A window of 1 term → sample variance of overnight/open-close
            // undefined (n−1=0) → null.
            const bars = Array.from({ length: 4 }, (_, i) =>
                makeBar(100 + i, 103 + i, 98 + i, 101 + i)
            );
            const result = calculateYangZhang(bars, 1);
            result.forEach(v => expect(v).toBeNull());
        });

        it('유효하지 않은 period (≤1) → 입력 길이만큼 null 배열 반환', () => {
            const bars = Array.from({ length: 5 }, (_, i) =>
                makeBar(100 + i, 103 + i, 98 + i, 101 + i)
            );
            const result = calculateYangZhang(bars, 0);
            expect(result).toHaveLength(5);
            result.forEach(v => expect(v).toBeNull());
        });

        it('변동성 값은 항상 non-negative이다', () => {
            const bars = Array.from({ length: 30 }, (_, i) =>
                makeBar(
                    100 + i * 0.5,
                    104 + i * 0.5,
                    96 + i * 0.5,
                    101 + ((i % 3) - 1)
                )
            );
            const result = calculateYangZhang(bars);
            result
                .filter((v): v is number => v !== null)
                .forEach(v => expect(v).toBeGreaterThanOrEqual(0));
        });
    });
});
