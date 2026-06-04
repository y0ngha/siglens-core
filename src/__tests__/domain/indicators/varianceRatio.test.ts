import { describe, it, expect } from 'vitest';
import { calculateVarianceRatio } from '@/domain/indicators/varianceRatio';
import { VR_WINDOW } from '@/domain/indicators/constants';

/** Sample variance (n−1) reference for the hand-computed assertion. */
function sampleVar(values: number[]): number {
    const n = values.length;
    const mean = values.reduce((s, v) => s + v, 0) / n;
    return values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
}

describe('calculateVarianceRatio', () => {
    describe('빈 배열 / 워밍업', () => {
        it('빈 배열은 빈 배열을 반환한다', () => {
            expect(calculateVarianceRatio([])).toEqual([]);
        });

        it('window 보다 짧으면 모두 null이다', () => {
            const closes = Array.from({ length: 5 }, (_, i) => 100 + i);
            const result = calculateVarianceRatio(closes, 2, 8);
            expect(result).toHaveLength(5);
            result.forEach(v => expect(v).toBeNull());
        });

        it('첫 valid 값은 index = window 에서 나온다', () => {
            const window = 6;
            const closes = Array.from(
                { length: window + 1 },
                (_, i) => 100 + i + Math.sin(i)
            );
            const result = calculateVarianceRatio(closes, 2, window);
            for (let i = 0; i < window; i++) expect(result[i]).toBeNull();
            expect(result[window]).not.toBeNull();
        });
    });

    describe('정상 계산', () => {
        it('수동 계산: 작은 윈도우에서 정확한 VR (q=2)', () => {
            const q = 2;
            const window = 4;
            // 5 closes → 4 returns in the window ending at index 4.
            const closes = [100, 102, 101, 104, 103];
            const r = [
                Math.log(102 / 100),
                Math.log(101 / 102),
                Math.log(104 / 101),
                Math.log(103 / 104),
            ];
            const var1 = sampleVar(r);
            const qSums = [r[0] + r[1], r[1] + r[2], r[2] + r[3]];
            const varQ = sampleVar(qSums);
            const expected = varQ / (q * var1);

            const result = calculateVarianceRatio(closes, q, window);
            expect(result[4]).toBeCloseTo(expected, 12);
        });

        it('반환 배열 길이는 입력 closes 길이와 같다', () => {
            const closes = Array.from({ length: 70 }, (_, i) => 100 + i);
            const result = calculateVarianceRatio(closes);
            expect(result).toHaveLength(closes.length);
        });
    });

    describe('방향성', () => {
        it('추세(양의 자기상관 수익률) 시계열 → VR > 1', () => {
            const window = 40;
            // Drift + slow wobble → returns share sign over runs (positive serial
            // correlation) while keeping non-trivial variance → VR > 1.
            const closes = Array.from(
                { length: window + 3 },
                (_, i) => 50 + i + 8 * Math.sin(i / 6)
            );
            const result = calculateVarianceRatio(closes, 2, window);
            const last = result[result.length - 1];
            expect(last).not.toBeNull();
            expect(last!).toBeGreaterThan(1);
        });

        it('랜덤워크 근사 시계열 → VR ≈ 1 (느슨한 경계)', () => {
            const window = 40;
            // Pseudo-random uncorrelated increments → variance ratio near 1.
            let seed = 12345;
            const rand = (): number => {
                seed = (seed * 1103515245 + 12345) & 0x7fffffff;
                return seed / 0x7fffffff - 0.5;
            };
            const closes = [100];
            for (let i = 1; i < window + 3; i++) {
                closes.push(closes[i - 1] * Math.exp(rand() * 0.02));
            }
            const result = calculateVarianceRatio(closes, 2, window);
            const last = result[result.length - 1];
            expect(last).not.toBeNull();
            expect(last!).toBeGreaterThan(0.5);
            expect(last!).toBeLessThan(1.5);
        });

        it('강한 평균회귀(alternating) 시계열 → VR < 1', () => {
            const window = 40;
            // Alternating returns → negative serial correlation → VR < 1.
            const closes = Array.from({ length: window + 3 }, (_, i) =>
                i % 2 === 0 ? 100 : 101
            );
            const result = calculateVarianceRatio(closes, 2, window);
            const last = result[result.length - 1];
            expect(last).not.toBeNull();
            expect(last!).toBeLessThan(1);
        });
    });

    describe('경계 케이스', () => {
        it('완전 평탄(var1=0) → null (0으로 나누기 방어)', () => {
            const closes = new Array(70).fill(100);
            const result = calculateVarianceRatio(closes);
            result.forEach(v => expect(v).toBeNull());
        });

        it('VR 값은 항상 non-negative이다', () => {
            const closes = Array.from(
                { length: 80 },
                (_, i) => 100 + Math.sin(i / 4) * 6 + i * 0.2
            );
            const result = calculateVarianceRatio(closes);
            result
                .filter((v): v is number => v !== null)
                .forEach(v => expect(v).toBeGreaterThanOrEqual(0));
        });

        it('비-양수 close가 윈도우에 있으면 그 bar는 null', () => {
            const window = 6;
            const closes = Array.from(
                { length: window + 3 },
                (_, i) => 100 + i + Math.sin(i)
            );
            closes[window] = 0; // inject inside last windows
            const result = calculateVarianceRatio(closes, 2, window);
            expect(result[window]).toBeNull();
        });

        it('window=1 → var1 미정의(단일 수익률) → null', () => {
            // A window of 1 return → sample variance undefined (n−1=0) → null.
            const closes = [100, 102, 101, 104];
            const result = calculateVarianceRatio(closes, 2, 1);
            result.forEach(v => expect(v).toBeNull());
        });

        it('q가 window 수익률 개수보다 크면 → null', () => {
            // window=2 returns but q=3 → cannot form a q-period sum → null.
            const closes = [100, 102, 101, 104, 103, 106];
            const result = calculateVarianceRatio(closes, 3, 2);
            result.forEach(v => expect(v).toBeNull());
        });

        it('window == q → q-기간 합이 1개뿐 → varQ 미정의 → null', () => {
            // window=2, q=2 → exactly one q-sum → sample variance undefined → null.
            const closes = [100, 102, 101, 104];
            const result = calculateVarianceRatio(closes, 2, 2);
            result.forEach(v => expect(v).toBeNull());
        });

        it('NaN/Infinity가 없다', () => {
            const closes = Array.from(
                { length: 100 },
                (_, i) => 100 + Math.cos(i / 6) * 5 + i * 0.05
            );
            const result = calculateVarianceRatio(closes);
            result.forEach(v => {
                if (v !== null) {
                    expect(Number.isNaN(v)).toBe(false);
                    expect(Number.isFinite(v)).toBe(true);
                }
            });
            expect(result[VR_WINDOW]).toBeDefined();
        });
    });
});
