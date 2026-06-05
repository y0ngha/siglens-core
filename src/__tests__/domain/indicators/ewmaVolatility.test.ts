import { describe, it, expect } from 'vitest';
import { calculateEwmaVolatility } from '@/domain/indicators/ewmaVolatility';
import { EWMA_LAMBDA } from '@/domain/indicators/constants';

describe('calculateEwmaVolatility', () => {
    describe('빈 배열 / 단일 값', () => {
        it('빈 배열은 빈 배열을 반환한다', () => {
            expect(calculateEwmaVolatility([])).toEqual([]);
        });

        it('단일 close는 [null]을 반환한다', () => {
            expect(calculateEwmaVolatility([100])).toEqual([null]);
        });
    });

    describe('index 0 은 항상 null', () => {
        it('첫 번째 항목은 null이다 (이전 close 없음)', () => {
            const result = calculateEwmaVolatility([100, 102, 105]);
            expect(result[0]).toBeNull();
        });
    });

    describe('정상 계산', () => {
        it('반환 배열 길이는 입력과 같다', () => {
            const closes = Array.from({ length: 10 }, (_, i) => 100 + i);
            const result = calculateEwmaVolatility(closes);
            expect(result).toHaveLength(closes.length);
        });

        it('두 번째 이후 값은 non-null이다', () => {
            const closes = [100, 102, 104, 106];
            const result = calculateEwmaVolatility(closes);
            expect(result[1]).not.toBeNull();
            expect(result[2]).not.toBeNull();
            expect(result[3]).not.toBeNull();
        });

        it('수동 계산: 3개 close에서 정확한 값', () => {
            // closes = [100, 101, 102], lambda = 0.94
            // r_1 = ln(101/100) ≈ 0.00995033...
            // seed: var_1 = r_1² ≈ 9.90091e-5
            // r_2 = ln(102/101) ≈ 0.00985124...
            // var_2 = 0.94 * var_1 + 0.06 * r_2²
            const closes = [100, 101, 102];
            const lambda = EWMA_LAMBDA;
            const r1 = Math.log(101 / 100);
            const var1 = r1 * r1;
            const r2 = Math.log(102 / 101);
            const var2 = lambda * var1 + (1 - lambda) * r2 * r2;

            const result = calculateEwmaVolatility(closes, lambda);
            expect(result[1]).toBeCloseTo(Math.sqrt(var1), 10);
            expect(result[2]).toBeCloseTo(Math.sqrt(var2), 10);
        });

        it('수동 계산: 커스텀 lambda=0.9 네 개 closes', () => {
            const closes = [100, 105, 103, 108];
            const lambda = 0.9;
            const oneMinusLambda = 1 - lambda;
            const r1 = Math.log(105 / 100);
            const var1 = r1 * r1;
            const r2 = Math.log(103 / 105);
            const var2 = lambda * var1 + oneMinusLambda * r2 * r2;
            const r3 = Math.log(108 / 103);
            const var3 = lambda * var2 + oneMinusLambda * r3 * r3;

            const result = calculateEwmaVolatility(closes, lambda);
            expect(result[0]).toBeNull();
            expect(result[1]).toBeCloseTo(Math.sqrt(var1), 10);
            expect(result[2]).toBeCloseTo(Math.sqrt(var2), 10);
            expect(result[3]).toBeCloseTo(Math.sqrt(var3), 10);
        });
    });

    describe('경계 케이스', () => {
        it('constant prices → volatility ≈ 0', () => {
            // All closes equal → all log returns = ln(1) = 0 → var = 0
            const closes = new Array(10).fill(100);
            const result = calculateEwmaVolatility(closes);
            const valid = result.filter(v => v !== null) as number[];
            expect(valid.length).toBeGreaterThan(0);
            valid.forEach(v => {
                expect(v).toBeCloseTo(0, 10);
            });
        });

        it('비-양수 close가 있으면 NaN/Infinity가 없다 (음수 close 방어)', () => {
            // Negative or zero close → ln undefined → skip, propagate prior var
            const closes = [100, 0, 102, -5, 105];
            const result = calculateEwmaVolatility(closes);
            result.forEach(v => {
                if (v !== null) {
                    expect(Number.isNaN(v)).toBe(false);
                    expect(Number.isFinite(v)).toBe(true);
                }
            });
        });

        it('유효한 분산 확립 후 비-양수 close 발생 시 이전 분산을 전파한다', () => {
            // [100, 101, 0, 103]: valid r1 → var established; then close=0 → skip, propagate
            const closes = [100, 101, 0, 103];
            const result = calculateEwmaVolatility(closes);
            // result[1] = sqrt(r1²) — valid
            // result[2]: prevClose=101 > 0, currClose=0 <= 0 → skip, prevVar is set → emit sqrt(prevVar)
            expect(result[1]).not.toBeNull();
            expect(result[2]).not.toBeNull(); // propagated from prevVar
            expect(result[2]).toBeCloseTo(result[1]!, 10); // same var (no update)
        });

        it('전체 non-positive closes → 모두 null이거나 valid', () => {
            // closes[0] is always null; subsequent non-positive pairs skip but propagate
            const closes = [0, 0, 0];
            const result = calculateEwmaVolatility(closes);
            // All pairs (0,0) are non-positive → skip → prevVar stays null → all null
            expect(result).toHaveLength(3);
            expect(result[0]).toBeNull();
            // result[1] and result[2]: prevClose=0 is non-positive → skip → prevVar=null → null
            expect(result[1]).toBeNull();
            expect(result[2]).toBeNull();
        });

        it('NaN/Infinity가 없다 (정상 입력)', () => {
            const closes = Array.from(
                { length: 50 },
                (_, i) => 100 + Math.sin(i) * 5
            );
            const result = calculateEwmaVolatility(closes);
            result.forEach(v => {
                if (v !== null) {
                    expect(Number.isNaN(v)).toBe(false);
                    expect(Number.isFinite(v)).toBe(true);
                }
            });
        });

        it('volatility 값은 항상 non-negative이다', () => {
            const closes = [100, 110, 95, 108, 102, 115];
            const result = calculateEwmaVolatility(closes);
            const valid = result.filter(v => v !== null) as number[];
            valid.forEach(v => expect(v).toBeGreaterThanOrEqual(0));
        });

        it('유효하지 않은 lambda (≤0 또는 ≥1) → 입력 길이만큼 null 배열 반환', () => {
            const closes = [100, 101, 102, 103, 104];
            // lambda = 0 is invalid
            const r1 = calculateEwmaVolatility(closes, 0);
            expect(r1).toHaveLength(5);
            r1.forEach(v => expect(v).toBeNull());
            // lambda = 1 is invalid
            const r2 = calculateEwmaVolatility(closes, 1);
            expect(r2).toHaveLength(5);
            r2.forEach(v => expect(v).toBeNull());
            // lambda = -0.5 is invalid
            const r3 = calculateEwmaVolatility(closes, -0.5);
            expect(r3).toHaveLength(5);
            r3.forEach(v => expect(v).toBeNull());
        });
    });
});
