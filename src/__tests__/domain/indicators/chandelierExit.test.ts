import { describe, it, expect } from 'vitest';
import { calculateChandelierExit } from '@/domain/indicators/chandelierExit';
import {
    CHANDELIER_PERIOD,
    CHANDELIER_ATR_MULT,
} from '@/domain/indicators/constants';
import type { Bar } from '@/domain/types';

function makeBar(close: number, high?: number, low?: number, index = 0): Bar {
    return {
        time: index,
        open: close,
        high: high ?? close,
        low: low ?? close,
        close,
        volume: 1000,
    };
}

function makeBars(closes: number[], highs?: number[], lows?: number[]): Bar[] {
    return closes.map((close, i) =>
        makeBar(
            close,
            highs ? highs[i] : close + 1,
            lows ? lows[i] : close - 1,
            i
        )
    );
}

/** Small-period test bars with explicit OHLC. */
function makeTestBars(period: number, extra = 5): Bar[] {
    const n = period + extra;
    const closes = Array.from({ length: n }, (_, i) => 100 + i);
    const highs = closes.map(c => c + 2);
    const lows = closes.map(c => c - 2);
    return makeBars(closes, highs, lows);
}

describe('calculateChandelierExit', () => {
    describe('빈 배열', () => {
        it('빈 배열을 반환한다', () => {
            expect(calculateChandelierExit([])).toEqual([]);
        });
    });

    describe('warmup 구간', () => {
        it('period보다 짧은 입력은 모두 null이다', () => {
            // ATR needs period+1 bars, so fewer bars → all null
            const bars = makeTestBars(CHANDELIER_PERIOD, 0).slice(
                0,
                CHANDELIER_PERIOD
            );
            const result = calculateChandelierExit(bars);
            result.forEach(r => {
                expect(r.longStop).toBeNull();
                expect(r.shortStop).toBeNull();
                expect(r.trend).toBeNull();
            });
        });

        it('반환 배열 길이는 입력과 같다', () => {
            const bars = makeTestBars(CHANDELIER_PERIOD);
            const result = calculateChandelierExit(bars);
            expect(result).toHaveLength(bars.length);
        });

        it('period 이후 non-null 값이 존재한다', () => {
            const bars = makeTestBars(CHANDELIER_PERIOD);
            const result = calculateChandelierExit(bars);
            // ATR starts at index=period (0-indexed), so expect at least one valid entry
            const valid = result.filter(r => r.trend !== null);
            expect(valid.length).toBeGreaterThan(0);
        });
    });

    describe('정상 계산 (작은 period)', () => {
        const period = 3;
        const mult = CHANDELIER_ATR_MULT;

        it('longStop = highestHigh(period) - mult*ATR', () => {
            // Use period=3; known closes & highs to verify formula
            // Bars: [100, 101, 102, 103] with high = close+2, low = close-1
            const bars = makeBars(
                [100, 101, 102, 103],
                [102, 103, 104, 105],
                [99, 100, 101, 102]
            );
            const result = calculateChandelierExit(bars, period, mult);
            // At index=3: HH([103,104,105]) = 105, ATR value is Wilder-smoothed
            // We just verify the formula relationship
            const r3 = result[3];
            expect(r3.longStop).not.toBeNull();
            expect(r3.shortStop).not.toBeNull();
            // longStop < highest high of last period
            const hh = Math.max(102, 103, 104, 105); // highs at i=0..3, period=3 → last 3: 103,104,105 → HH=105
            expect(r3.longStop!).toBeLessThan(hh);
        });

        it('수동 계산: period=2에서 정확한 stop 값', () => {
            // bars: [100, 102, 104]
            // highs: [101, 103, 105], lows: [99, 101, 103]
            // ATR(period=2):
            //   TR[1] = max(103-101, |103-100|, |101-100|) = max(2, 3, 1) = 3
            //   TR[2] = max(105-103, |105-102|, |103-102|) = max(2, 3, 1) = 3
            //   initialATR (SMA of first period=2 TRs) = (3+3)/2 = 3  ← but ATR formula
            //   Actually ATR returns null for first `period` bars (indices 0..period-1 = 0..1),
            //   and the first non-null is at index period=2.
            //   atrValues[0] = initialATR = TR[0..1] SMA = 3
            //   Wait: calculateATR(bars, 2): period=2, bars.length=3 > period
            //     trValues = TR for bars[1..2] = [3, 3]
            //     initialATR = (3+3)/2 = 3; tailTrValues = [] (slice(2) of trValues=[3,3] is [])
            //     atrValues = [3]
            //     result = [null, null, 3]  (2 nulls + 1 value)
            //   slidingMax(highs=[101,103,105], 2) = [null, 103, 105]
            //   slidingMin(lows=[99,101,103], 2)   = [null, 99, 101]  ← Wait: min of [99,101]=99 at i=1, min of [101,103]=101 at i=2
            //   At index=2: HH=105, LL=101, ATR=3, mult=3
            //   longStop  = 105 - 3*3 = 96
            //   shortStop = 101 + 3*3 = 110
            const bars: Bar[] = [
                {
                    time: 0,
                    open: 100,
                    high: 101,
                    low: 99,
                    close: 100,
                    volume: 1000,
                },
                {
                    time: 1,
                    open: 102,
                    high: 103,
                    low: 101,
                    close: 102,
                    volume: 1000,
                },
                {
                    time: 2,
                    open: 104,
                    high: 105,
                    low: 103,
                    close: 104,
                    volume: 1000,
                },
            ];
            const result = calculateChandelierExit(bars, 2, 3);
            expect(result[2].longStop).toBeCloseTo(96, 5);
            expect(result[2].shortStop).toBeCloseTo(110, 5);
        });
    });

    describe('trend 상태 머신 (long → short → long)', () => {
        it('close < longStop → short로 전환된다', () => {
            // Use period=2, mult=1 to make the stop tight.
            // Craft: initial series → 'long'; then a crash below longStop → 'short'.
            const period = 2;
            const mult = 1;
            // Start with rising bars (long):
            // bar 0: close=100, high=102, low=98
            // bar 1: close=101, high=103, low=99
            // bar 2: close=102, high=104, low=100
            // At bar 2: HH=104, LL=100 (period=2), ATR (Wilder-smoothed)
            //   TR[1] = max(1, |103-100|, |99-100|) = max(1, 3, 1) = 3
            //   TR[2] = max(1, |104-101|, |100-101|) = max(1, 3, 1) = 3
            //   ATR(2): null, null, 3 → at index=2: atr=3
            //   HH=max(103,104)=104; longStop=104-3=101; close=102>101 → stay long
            // bar 3: sudden crash, close=98 < longStop expected value
            //   ATR[3] = (3*1 + 3)/2 = 3
            //   HH=max(104,105)=105; longStop=105-3=102; close=98<102 → short
            const bars: Bar[] = [
                {
                    time: 0,
                    open: 100,
                    high: 102,
                    low: 98,
                    close: 100,
                    volume: 1000,
                },
                {
                    time: 1,
                    open: 101,
                    high: 103,
                    low: 99,
                    close: 101,
                    volume: 1000,
                },
                {
                    time: 2,
                    open: 102,
                    high: 104,
                    low: 100,
                    close: 102,
                    volume: 1000,
                },
                {
                    time: 3,
                    open: 98,
                    high: 105,
                    low: 97,
                    close: 98,
                    volume: 1000,
                },
            ];
            const result = calculateChandelierExit(bars, period, mult);
            // First valid entry should be 'long' (seed)
            const firstValid = result.find(r => r.trend !== null);
            expect(firstValid?.trend).toBe('long');
            // After crash: should flip to 'short'
            expect(result[3].trend).toBe('short');
        });

        it('long → short → long 전환을 모두 감지한다', () => {
            // period=2, mult=0.5 for tight stops
            const period = 2;
            const mult = 0.5;
            // Design: start long, crash to short, then rally back to long
            // bars 0-3: steady rise → long
            // bar 4: crash below longStop → short
            // bar 5: close > shortStop → back to long
            const bars: Bar[] = [
                // Rising phase (long)
                {
                    time: 0,
                    open: 100,
                    high: 101,
                    low: 99,
                    close: 100,
                    volume: 1000,
                },
                {
                    time: 1,
                    open: 101,
                    high: 102,
                    low: 100,
                    close: 101,
                    volume: 1000,
                },
                {
                    time: 2,
                    open: 102,
                    high: 103,
                    low: 101,
                    close: 102,
                    volume: 1000,
                },
                {
                    time: 3,
                    open: 103,
                    high: 104,
                    low: 102,
                    close: 103,
                    volume: 1000,
                },
                // Crash: close drops far below where longStop would be
                // At bar 4: HH of last 2 highs = max(103,104) = 104
                //   ATR estimate ~ 1; longStop ~ 104 - 0.5*1 = 103.5; close=90 < 103.5 → short
                {
                    time: 4,
                    open: 90,
                    high: 104,
                    low: 89,
                    close: 90,
                    volume: 1000,
                },
                // Rally: close spikes far above shortStop
                // At bar 5: LL of last 2 lows = min(89, 50) = 50
                //   shortStop ~ 50 + 0.5*ATR; close=200 >> shortStop → long
                {
                    time: 5,
                    open: 200,
                    high: 201,
                    low: 50,
                    close: 200,
                    volume: 1000,
                },
            ];
            const result = calculateChandelierExit(bars, period, mult);
            // Collect valid trend values
            const trends = result
                .filter(r => r.trend !== null)
                .map(r => r.trend);
            // Should contain at least one 'long', one 'short', and then back to 'long'
            expect(trends).toContain('long');
            expect(trends).toContain('short');
            // Last valid entry should be 'long' (recovered)
            const lastTrend = result[result.length - 1].trend;
            expect(lastTrend).toBe('long');
        });
    });

    describe('경계 케이스', () => {
        it('flat prices (ATR=0): NaN/Infinity가 없다', () => {
            // Flat prices → TR = 0, ATR = 0 → stops computed without divide-by-zero
            const n = CHANDELIER_PERIOD + 5;
            const bars = makeBars(
                new Array(n).fill(100),
                new Array(n).fill(100),
                new Array(n).fill(100)
            );
            const result = calculateChandelierExit(bars);
            result.forEach(r => {
                if (r.longStop !== null) {
                    expect(Number.isNaN(r.longStop)).toBe(false);
                    expect(Number.isFinite(r.longStop)).toBe(true);
                }
                if (r.shortStop !== null) {
                    expect(Number.isNaN(r.shortStop)).toBe(false);
                    expect(Number.isFinite(r.shortStop)).toBe(true);
                }
            });
        });

        it('단일 bar → 모두 null이다', () => {
            const result = calculateChandelierExit([makeBar(100, 101, 99)]);
            expect(result).toHaveLength(1);
            expect(result[0].longStop).toBeNull();
            expect(result[0].shortStop).toBeNull();
            expect(result[0].trend).toBeNull();
        });
    });
});
