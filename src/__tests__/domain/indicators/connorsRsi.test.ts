import { describe, it, expect } from 'vitest';
import { calculateConnorsRsi } from '@/domain/indicators/connorsRsi';
import { CRSI_PCTRANK_PERIOD } from '@/domain/indicators/constants';

describe('calculateConnorsRsi', () => {
    describe('빈 배열일 때', () => {
        it('빈 배열을 반환한다', () => {
            expect(calculateConnorsRsi([])).toEqual([]);
        });
    });

    describe('입력이 pctRankPeriod보다 짧을 때', () => {
        it('모든 값이 null이다', () => {
            const closes = Array.from(
                { length: CRSI_PCTRANK_PERIOD },
                (_, i) => 100 + i
            );
            const result = calculateConnorsRsi(closes);
            expect(result.every(v => v === null)).toBe(true);
        });
    });

    describe('정상 계산', () => {
        it('반환 배열 길이는 입력과 같다', () => {
            const n = CRSI_PCTRANK_PERIOD + 20;
            const closes = Array.from({ length: n }, (_, i) => 100 + i);
            expect(calculateConnorsRsi(closes)).toHaveLength(n);
        });

        it('충분한 데이터 이후 비-null 값이 존재한다', () => {
            const n = CRSI_PCTRANK_PERIOD + 10;
            const closes = Array.from({ length: n }, (_, i) => 100 + i);
            const result = calculateConnorsRsi(closes);
            const nonNull = result.filter(v => v !== null);
            expect(nonNull.length).toBeGreaterThan(0);
        });

        it('결과는 0~100 범위에 있다', () => {
            const n = CRSI_PCTRANK_PERIOD + 20;
            const closes = Array.from({ length: n }, (_, i) => {
                // oscillating prices
                return 100 + Math.sin(i * 0.3) * 10;
            });
            const result = calculateConnorsRsi(closes);
            result.forEach(v => {
                if (v !== null) {
                    expect(v).toBeGreaterThanOrEqual(0);
                    expect(v).toBeLessThanOrEqual(100);
                }
            });
        });

        it('단조 상승 시리즈에서 높은 CRSI 값을 반환한다', () => {
            const n = CRSI_PCTRANK_PERIOD + 20;
            // Monotonically rising: every close > prev close → streak always positive
            const closes = Array.from({ length: n }, (_, i) => 100 + i);
            const result = calculateConnorsRsi(closes);
            const nonNull = result.filter((v): v is number => v !== null);
            expect(nonNull.length).toBeGreaterThan(0);
            // Monotonically rising → RSI close ≈ 100, streak RSI high, pctRank high
            const avgValue =
                nonNull.reduce((s, v) => s + v, 0) / nonNull.length;
            expect(avgValue).toBeGreaterThan(50);
        });

        it('모든 동일한 가격(streak=0, ROC=0)에서 NaN이 없다', () => {
            // All-equal closes: no direction changes, ROC = 0
            const n = CRSI_PCTRANK_PERIOD + 20;
            const closes = new Array(n).fill(100);
            const result = calculateConnorsRsi(closes);
            result.forEach(v => {
                if (v !== null) {
                    expect(Number.isNaN(v)).toBe(false);
                    expect(Number.isFinite(v)).toBe(true);
                }
            });
        });

        it('NaN과 Infinity가 없다', () => {
            const n = CRSI_PCTRANK_PERIOD + 20;
            const closes = Array.from(
                { length: n },
                (_, i) => 100 + (i % 5) * 2 - 4
            );
            const result = calculateConnorsRsi(closes);
            result.forEach(v => {
                if (v !== null) {
                    expect(Number.isNaN(v)).toBe(false);
                    expect(Number.isFinite(v)).toBe(true);
                }
            });
        });

        it('커스텀 파라미터로 소형 데이터셋에서 수동 검증', () => {
            // Use small periods so we can hand-verify
            // rsiPeriod=3, streakRsiPeriod=2, pctRankPeriod=5
            // closes: [10, 11, 12, 13, 14, 15, 16] (monotonically rising, length=7)
            // streak: [0, 1, 1, 1, 1, 1, 1]
            // roc[0]=0 (sentinel), roc[i]=positive for i>=1
            // pctRank first valid at index pctRankPeriod + 1 = 6
            //   (needs roc[i-5..i-1] = 5 entries, i-5>=0 AND i>=1 → i>=6)
            // RSI(close,3): first non-null at index 3 (needs period diffs → period bars)
            // RSI(streak,2): first non-null at index 2
            // All three non-null from index 6 onward
            const closes = [10, 11, 12, 13, 14, 15, 16];
            const result = calculateConnorsRsi(closes, 3, 2, 5);
            expect(result).toHaveLength(7);
            // First 6 entries should be null (pctRank not yet ready)
            for (let i = 0; i < 6; i++) {
                expect(result[i]).toBeNull();
            }
            // Index 6 — hand-computed exact value:
            //   RSI(close,3) = 100  (strictly rising → no losses)
            //   RSI(streak,2) = 100 (streak [0,1,2,3,4,5,6] strictly rising)
            //   ROC decreases each bar (1/10 > 1/11 > … > 1/15), so the latest
            //   ROC is the smallest → percentRank over the prior 5 = 0.
            //   CRSI = (100 + 100 + 0) / 3 = 200/3 ≈ 66.667.
            expect(result[6]).not.toBeNull();
            expect(result[6]!).toBeCloseTo(200 / 3, 4);
        });

        it('0인 종가가 섞여도 0 나눗셈 없이 유한값/null만 반환한다 (ROC prev=0 가드)', () => {
            // closes[2] = 0 → roc[3] hits the `prev === 0 ? … : 0` guard, so no
            // Infinity/NaN propagates into CRSI.
            const closes = [10, 11, 0, 12, 13, 14, 15, 16];
            const result = calculateConnorsRsi(closes, 3, 2, 5);
            result.forEach(v => {
                if (v !== null) expect(Number.isFinite(v)).toBe(true);
            });
        });

        it('유효하지 않은 파라미터 (어느 period든 ≤0) → 입력 길이만큼 null 배열 반환', () => {
            const closes = Array.from({ length: 10 }, (_, i) => 100 + i);
            // rsiPeriod = 0 is invalid
            const r1 = calculateConnorsRsi(closes, 0, 2, 5);
            expect(r1).toHaveLength(10);
            r1.forEach(v => expect(v).toBeNull());
            // streakRsiPeriod = 0 is invalid
            const r2 = calculateConnorsRsi(closes, 3, 0, 5);
            expect(r2).toHaveLength(10);
            r2.forEach(v => expect(v).toBeNull());
            // pctRankPeriod = 0 is invalid
            const r3 = calculateConnorsRsi(closes, 3, 2, 0);
            expect(r3).toHaveLength(10);
            r3.forEach(v => expect(v).toBeNull());
        });
    });
});
