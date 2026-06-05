import { describe, it, expect } from 'vitest';
import { calculateRegression } from '@/domain/indicators/regression';
import { REGRESSION_PERIOD } from '@/domain/indicators/constants';

describe('calculateRegression', () => {
    describe('빈 배열 / 워밍업', () => {
        it('빈 배열은 빈 배열을 반환한다', () => {
            expect(calculateRegression([])).toEqual([]);
        });

        it('period 보다 짧으면 모두 {null, null}이다', () => {
            const closes = [100, 101, 102];
            const result = calculateRegression(closes, 5);
            expect(result).toHaveLength(3);
            result.forEach(r => {
                expect(r.slope).toBeNull();
                expect(r.r2).toBeNull();
            });
        });

        it('첫 valid 값은 index = period-1 에서 나온다', () => {
            const period = 4;
            const closes = [10, 12, 11, 15, 14, 18];
            const result = calculateRegression(closes, period);
            for (let i = 0; i < period - 1; i++) {
                expect(result[i].slope).toBeNull();
                expect(result[i].r2).toBeNull();
            }
            expect(result[period - 1].slope).not.toBeNull();
        });
    });

    describe('정상 계산', () => {
        it('완벽한 선형 시계열 → r2 ≈ 1, slope = step', () => {
            const period = 5;
            const step = 2;
            // y = 10 + 2x → slope 2, perfect fit.
            const closes = Array.from(
                { length: period },
                (_, i) => 10 + step * i
            );
            const result = calculateRegression(closes, period);
            const last = result[period - 1];
            expect(last.slope).toBeCloseTo(step, 12);
            expect(last.r2).toBeCloseTo(1, 12);
        });

        it('하락 선형 시계열 → 음의 slope, r2 ≈ 1', () => {
            const period = 5;
            const closes = Array.from(
                { length: period },
                (_, i) => 100 - 3 * i
            );
            const result = calculateRegression(closes, period);
            const last = result[period - 1];
            expect(last.slope).toBeCloseTo(-3, 12);
            expect(last.r2).toBeCloseTo(1, 12);
        });

        it('수동 계산: 비-선형 윈도우의 정확한 slope와 r2', () => {
            // closes = [1, 3, 2, 5], x = [0,1,2,3], period = 4
            // Σx=6, Σx²=14, Σy=11, Σxy = 0+3+4+15 = 22, n=4
            // slope = (4·22 − 6·11)/(4·14 − 36) = (88−66)/(56−36) = 22/20 = 1.1
            // intercept = (11 − 1.1·6)/4 = (11−6.6)/4 = 1.1
            // ŷ = [1.1, 2.2, 3.3, 4.4]; residuals = [-0.1, 0.8, -1.3, 0.6]
            // SS_res = 0.01+0.64+1.69+0.36 = 2.70
            // ȳ = 2.75; SS_tot = 1.75²+0.25²+0.75²+2.25² = 3.0625+0.0625+0.5625+5.0625 = 8.75
            // r2 = 1 − 2.70/8.75 = 1 − 0.3085714... = 0.6914285...
            const closes = [1, 3, 2, 5];
            const result = calculateRegression(closes, 4);
            const last = result[3];
            expect(last.slope).toBeCloseTo(1.1, 12);
            expect(last.r2).toBeCloseTo(1 - 2.7 / 8.75, 12);
        });

        it('반환 배열 길이는 입력 closes 길이와 같다', () => {
            const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
            const result = calculateRegression(closes);
            expect(result).toHaveLength(closes.length);
        });

        it('기본 period(20)에서 워밍업 후 valid', () => {
            const closes = Array.from(
                { length: 25 },
                (_, i) => 100 + i + Math.sin(i)
            );
            const result = calculateRegression(closes);
            expect(result[REGRESSION_PERIOD - 1].slope).not.toBeNull();
        });
    });

    describe('경계 케이스', () => {
        it('완전 평탄 시계열 → slope 0, r2 null (SS_tot=0 방어)', () => {
            const period = 5;
            const closes = new Array(period).fill(100);
            const result = calculateRegression(closes, period);
            const last = result[period - 1];
            expect(last.slope).toBeCloseTo(0, 12);
            expect(last.r2).toBeNull();
        });

        it('period=1 (단일 점 윈도우) → slope/r2 모두 null (denom=0 방어)', () => {
            // A single-point window has n=1 → x-variance denom = 0 → slope undefined.
            const closes = [100, 101, 102];
            const result = calculateRegression(closes, 1);
            expect(result).toHaveLength(3);
            result.forEach(r => {
                expect(r.slope).toBeNull();
                expect(r.r2).toBeNull();
            });
        });

        it('유효하지 않은 period (<2) → 입력 길이만큼 null 객체 배열 반환', () => {
            const closes = [100, 101, 102, 103];
            const result = calculateRegression(closes, 0);
            expect(result).toHaveLength(4);
            result.forEach(r => {
                expect(r.slope).toBeNull();
                expect(r.r2).toBeNull();
            });
        });

        it('NaN/Infinity가 없다 (slope/r2 모두)', () => {
            const closes = Array.from(
                { length: 40 },
                (_, i) => 100 + Math.sin(i / 3) * 10
            );
            const result = calculateRegression(closes);
            result.forEach(r => {
                if (r.slope !== null) {
                    expect(Number.isNaN(r.slope)).toBe(false);
                    expect(Number.isFinite(r.slope)).toBe(true);
                }
                if (r.r2 !== null) {
                    expect(Number.isNaN(r.r2)).toBe(false);
                    expect(Number.isFinite(r.r2)).toBe(true);
                }
            });
        });

        it('r2는 valid할 때 [0, 1] 범위 안에 있다', () => {
            const closes = Array.from(
                { length: 50 },
                (_, i) => 100 + i * 0.5 + Math.sin(i) * 4
            );
            const result = calculateRegression(closes);
            result
                .map(r => r.r2)
                .filter((v): v is number => v !== null)
                .forEach(v => {
                    expect(v).toBeGreaterThanOrEqual(0);
                    expect(v).toBeLessThanOrEqual(1);
                });
        });
    });
});
