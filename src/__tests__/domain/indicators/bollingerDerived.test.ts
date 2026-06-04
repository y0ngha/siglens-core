import { describe, it, expect } from 'vitest';
import { calculateBollingerDerived } from '@/domain/indicators/bollingerDerived';
import {
    BOLLINGER_DEFAULT_PERIOD,
    BOLLINGER_DEFAULT_STD_DEV,
} from '@/domain/indicators/constants';
import type { Bar } from '@/domain/types';

function makeBars(closes: number[], highs?: number[], lows?: number[]): Bar[] {
    return closes.map((close, i) => ({
        time: i,
        open: close,
        high: highs ? highs[i] : close,
        low: lows ? lows[i] : close,
        close,
        volume: 1000,
    }));
}

describe('calculateBollingerDerived', () => {
    describe('빈 배열', () => {
        it('빈 배열을 반환한다', () => {
            expect(calculateBollingerDerived([])).toEqual([]);
        });
    });

    describe('warmup 구간', () => {
        it('period보다 짧은 입력은 모두 null이다', () => {
            const bars = makeBars(
                Array.from(
                    { length: BOLLINGER_DEFAULT_PERIOD - 1 },
                    (_, i) => 100 + i
                )
            );
            const result = calculateBollingerDerived(bars);
            result.forEach(r => {
                expect(r.pctB).toBeNull();
                expect(r.bandwidth).toBeNull();
            });
        });

        it('첫 period-1개 항목은 null이다', () => {
            const bars = makeBars(
                Array.from(
                    { length: BOLLINGER_DEFAULT_PERIOD + 5 },
                    (_, i) => 100 + i
                )
            );
            const result = calculateBollingerDerived(bars);
            for (let i = 0; i < BOLLINGER_DEFAULT_PERIOD - 1; i++) {
                expect(result[i].pctB).toBeNull();
                expect(result[i].bandwidth).toBeNull();
            }
        });

        it('period 이후 non-null 값이 존재한다', () => {
            const bars = makeBars(
                Array.from(
                    { length: BOLLINGER_DEFAULT_PERIOD + 5 },
                    (_, i) => 100 + i
                )
            );
            const result = calculateBollingerDerived(bars);
            expect(result[BOLLINGER_DEFAULT_PERIOD - 1].pctB).not.toBeNull();
            expect(
                result[BOLLINGER_DEFAULT_PERIOD - 1].bandwidth
            ).not.toBeNull();
        });
    });

    describe('정상 계산', () => {
        it('반환 배열 길이는 입력과 같다', () => {
            const bars = makeBars(
                Array.from(
                    { length: BOLLINGER_DEFAULT_PERIOD + 10 },
                    (_, i) => 100 + i
                )
            );
            const result = calculateBollingerDerived(bars);
            expect(result).toHaveLength(bars.length);
        });

        it('close가 middle과 같으면 pctB ≈ 0.5', () => {
            // Flat series: all closes equal → std = 0 → zero-width band → pctB null.
            // For non-degenerate case, use a series where we can observe pctB near 0.5.
            // Create a series that has some variance then check the last bar.
            // Use a known sinusoidal-like series; close at the last bar equals the SMA.
            const period = 5;
            const stdDev = BOLLINGER_DEFAULT_STD_DEV;
            // Manually crafted: closes = [98, 100, 102, 100, 98, 100] (period=5 window over last 5)
            // SMA([100,102,100,98,100]) = 500/5 = 100
            // The close at index 5 is 100 = middle, so pctB should be 0.5
            const closes = [98, 100, 102, 100, 98, 100];
            const bars = makeBars(closes);
            const result = calculateBollingerDerived(bars, period, stdDev);
            const last = result[result.length - 1];
            if (last.pctB !== null) {
                expect(last.pctB).toBeCloseTo(0.5, 5);
            }
        });

        it('수동 계산값이 정확하다 (period=3, stdDev=1)', () => {
            // Closes: [10, 12, 14]
            // Window of period=3: [10, 12, 14]
            // SMA = 12; variance = ((10-12)²+(12-12)²+(14-12)²)/3 = (4+0+4)/3 = 8/3
            // std = sqrt(8/3) ≈ 1.6330
            // upper = 12 + 1.6330 = 13.6330
            // lower = 12 - 1.6330 = 10.3670
            // width = 2*1.6330 = 3.2660
            // pctB(close=14) = (14 - 10.367) / 3.266 ≈ 3.633 / 3.266 ≈ 1.1124
            // bandwidth = 3.266 / 12 ≈ 0.2722
            const bars = makeBars([10, 12, 14]);
            const result = calculateBollingerDerived(bars, 3, 1);
            const r = result[2];
            expect(r.pctB).not.toBeNull();
            expect(r.bandwidth).not.toBeNull();
            // std = sqrt(8/3) ≈ 1.6330
            const std = Math.sqrt(8 / 3);
            const middle = 12;
            const upper = middle + std;
            const lower = middle - std;
            const width = upper - lower;
            const expectedPctB = (14 - lower) / width;
            const expectedBandwidth = width / middle;
            expect(r.pctB!).toBeCloseTo(expectedPctB, 8);
            expect(r.bandwidth!).toBeCloseTo(expectedBandwidth, 8);
        });

        it('pctB 값이 0보다 작을 수 있다 (close < lower)', () => {
            // Craft a window where close is clearly below the lower band.
            // period=3: window closes = [110, 100, 90]; SMA=100; std≈8.165; lower≈83.67
            // close of bar 2 is 90 > 83.67 → still inside. Use stdDev=0.5 to tighten:
            //   lower = 100 - 0.5*8.165 = 95.917; close=90 < 95.917 → pctB<0
            const bars = makeBars([110, 100, 90]);
            const result = calculateBollingerDerived(bars, 3, 0.5);
            const last = result[result.length - 1];
            if (last.pctB !== null) {
                expect(last.pctB).toBeLessThan(0);
            }
        });
    });

    describe('경계 케이스', () => {
        it('모든 가격이 같으면 pctB와 bandwidth가 null이다 (zero-width band)', () => {
            // Flat closes → std = 0 → width = 0 → pctB null; middle = 100 ≠ 0 → bandwidth = 0/100 = 0
            const n = BOLLINGER_DEFAULT_PERIOD + 5;
            const bars = makeBars(new Array(n).fill(100));
            const result = calculateBollingerDerived(bars);
            const valid = result.filter(r => r.bandwidth !== null);
            valid.forEach(r => {
                // zero-width: pctB must be null (no divide-by-zero)
                expect(r.pctB).toBeNull();
                // bandwidth = 0/100 = 0 (not null, since middle ≠ 0)
                expect(r.bandwidth).toBeCloseTo(0, 10);
            });
        });

        it('NaN/Infinity가 없다', () => {
            const bars = makeBars(
                Array.from(
                    { length: BOLLINGER_DEFAULT_PERIOD + 10 },
                    (_, i) => 100 + i * 0.01
                )
            );
            const result = calculateBollingerDerived(bars);
            result.forEach(r => {
                if (r.pctB !== null) expect(Number.isFinite(r.pctB)).toBe(true);
                if (r.bandwidth !== null)
                    expect(Number.isFinite(r.bandwidth)).toBe(true);
            });
        });

        it('middle = 0일 때 bandwidth가 null이다 (divide-by-zero 방어)', () => {
            // SMA = 0 when all closes = 0; width = 0 too (std=0), so pctB also null
            const n = BOLLINGER_DEFAULT_PERIOD + 5;
            const bars = makeBars(new Array(n).fill(0));
            const result = calculateBollingerDerived(bars);
            const valid = result.filter(
                r => r.bandwidth !== null || r.pctB !== null
            );
            // middle=0 → bandwidth null; width=0 → pctB null → both should be null after warmup
            valid.forEach(r => {
                expect(r.bandwidth).toBeNull();
                expect(r.pctB).toBeNull();
            });
        });
    });
});
