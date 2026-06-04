import { describe, it, expect } from 'vitest';
import { calculateHurst } from '@/domain/indicators/hurst';
import { HURST_WINDOW } from '@/domain/indicators/constants';

describe('calculateHurst', () => {
    describe('빈 배열 / 워밍업', () => {
        it('빈 배열은 빈 배열을 반환한다', () => {
            expect(calculateHurst([])).toEqual([]);
        });

        it('window 보다 짧으면 모두 null이다', () => {
            const closes = Array.from({ length: 10 }, (_, i) => 100 + i);
            const result = calculateHurst(closes, 16);
            expect(result).toHaveLength(10);
            result.forEach(v => expect(v).toBeNull());
        });

        it('첫 valid 값은 index = window 에서 나온다', () => {
            const window = 16;
            // window+1 closes → exactly one valid output at index = window.
            const closes = Array.from(
                { length: window + 1 },
                (_, i) => 100 + i + Math.sin(i)
            );
            const result = calculateHurst(closes, window);
            for (let i = 0; i < window; i++) expect(result[i]).toBeNull();
            expect(result[window]).not.toBeNull();
        });
    });

    describe('값 범위', () => {
        it('Hurst 값은 항상 [0, 1] 범위 안에 있다', () => {
            const closes = Array.from(
                { length: 80 },
                (_, i) => 100 + Math.sin(i / 3) * 10 + Math.cos(i / 7) * 5
            );
            const result = calculateHurst(closes, 32);
            result
                .filter((v): v is number => v !== null)
                .forEach(v => {
                    expect(v).toBeGreaterThanOrEqual(0);
                    expect(v).toBeLessThanOrEqual(1);
                });
        });
    });

    describe('방향성', () => {
        it('추세(persistent) 시계열 → H > 0.5', () => {
            const window = 64;
            // Persistent random walk: small autocorrelated drift. Build a smooth
            // upward path with mild noise so increments share sign (trending).
            const closes = Array.from({ length: window + 5 }, (_, i) => {
                const drift = i * 0.8;
                const wobble = Math.sin(i / 9) * 1.5;
                return 100 + drift + wobble;
            });
            const result = calculateHurst(closes, window);
            const last = result[result.length - 1];
            expect(last).not.toBeNull();
            // Measured ≈0.82 for this persistent path; a >0.6 bound locks the R/S
            // slope math (an off-by-one in chunking or a slope-sign error would
            // not clear this), not just "above the 0.5 random-walk line".
            expect(last!).toBeGreaterThan(0.6);
        });

        it('평균회귀(alternating) 시계열 → H < 0.5', () => {
            const window = 64;
            // Strongly mean-reverting: price flips around a constant level every bar.
            const closes = Array.from({ length: window + 5 }, (_, i) =>
                i % 2 === 0 ? 100 : 102
            );
            const result = calculateHurst(closes, window);
            const last = result[result.length - 1];
            expect(last).not.toBeNull();
            // Measured ≈0 for this strictly alternating path; a <0.4 bound locks
            // the anti-persistence direction of the R/S estimate.
            expect(last!).toBeLessThan(0.4);
        });
    });

    describe('경계 케이스', () => {
        it('완전 평탄 시계열 → null (S=0, 0으로 나누기 방어)', () => {
            const closes = new Array(70).fill(100);
            const result = calculateHurst(closes, 32);
            // Every sub-window is flat → R/S undefined → not enough points → null.
            result.forEach(v => expect(v).toBeNull());
        });

        it('비-양수 close가 윈도우에 있으면 그 bar는 null', () => {
            const window = 16;
            const closes = Array.from(
                { length: window + 3 },
                (_, i) => 100 + i + Math.sin(i)
            );
            // Inject a zero close inside the last window.
            closes[window] = 0;
            const result = calculateHurst(closes, window);
            // index = window's window contains the zero → null.
            expect(result[window]).toBeNull();
        });

        it('NaN/Infinity가 없다', () => {
            const closes = Array.from(
                { length: 120 },
                (_, i) => 100 + Math.sin(i / 5) * 8 + i * 0.1
            );
            const result = calculateHurst(closes);
            result.forEach(v => {
                if (v !== null) {
                    expect(Number.isNaN(v)).toBe(false);
                    expect(Number.isFinite(v)).toBe(true);
                }
            });
            expect(result[HURST_WINDOW]).toBeDefined();
        });
    });
});
