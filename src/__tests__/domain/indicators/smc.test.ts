import { describe, it, expect } from 'vitest';
import { calculateSmc } from '@/domain/indicators/smc';
import {
    EMPTY_SMC_RESULT,
    SMC_SWING_PERIOD,
    SMC_ATR_PERIOD,
} from '@/domain/indicators/constants';
import type { Bar } from '@/domain/types';

function makeBar(high: number, low: number, close: number, time: number): Bar {
    return { time, open: close, high, low, close, volume: 1000 };
}

function makeOhlcBar(
    open: number,
    high: number,
    low: number,
    close: number,
    time: number
): Bar {
    return { time, open, high, low, close, volume: 1000 };
}

const MIN_SWING_BARS = SMC_SWING_PERIOD * 2 + 1;

describe('calculateSmc', () => {
    describe('빈 배열일 때', () => {
        it('EMPTY_SMC_RESULT를 반환한다', () => {
            expect(calculateSmc([])).toEqual(EMPTY_SMC_RESULT);
        });
    });

    describe('swing point 감지에 충분하지 않은 데이터일 때', () => {
        it('결과의 swingHighs와 swingLows가 빈 배열이다', () => {
            const bars = Array.from({ length: MIN_SWING_BARS - 1 }, (_, i) =>
                makeBar(100 + i, 90 + i, 95 + i, i)
            );
            const result = calculateSmc(bars);
            expect(result.swingHighs).toEqual([]);
            expect(result.swingLows).toEqual([]);
        });
    });

    describe('충분한 데이터가 있을 때', () => {
        it('결과 구조에 필요한 모든 키가 있다', () => {
            const bars = Array.from({ length: MIN_SWING_BARS + 20 }, (_, i) =>
                makeBar(100 + (i % 10), 90 + (i % 8), 95 + (i % 9), i)
            );
            const result = calculateSmc(bars);
            expect('swingHighs' in result).toBe(true);
            expect('swingLows' in result).toBe(true);
            expect('orderBlocks' in result).toBe(true);
            expect('fairValueGaps' in result).toBe(true);
            expect('equalHighs' in result).toBe(true);
            expect('equalLows' in result).toBe(true);
            expect('structureBreaks' in result).toBe(true);
        });

        it('swing points는 배열이다', () => {
            const bars = Array.from({ length: MIN_SWING_BARS + 20 }, (_, i) =>
                makeBar(100 + (i % 10), 90 + (i % 8), 95 + (i % 9), i)
            );
            const result = calculateSmc(bars);
            expect(Array.isArray(result.swingHighs)).toBe(true);
            expect(Array.isArray(result.swingLows)).toBe(true);
        });

        it('swingHighs의 type은 high이다', () => {
            const bars = Array.from({ length: MIN_SWING_BARS + 20 }, (_, i) =>
                makeBar(100 + (i % 10), 90 + (i % 8), 95 + (i % 9), i)
            );
            const result = calculateSmc(bars);
            result.swingHighs.forEach(sh => {
                expect(sh.type).toBe('high');
            });
        });

        it('swingLows의 type은 low이다', () => {
            const bars = Array.from({ length: MIN_SWING_BARS + 20 }, (_, i) =>
                makeBar(100 + (i % 10), 90 + (i % 8), 95 + (i % 9), i)
            );
            const result = calculateSmc(bars);
            result.swingLows.forEach(sl => {
                expect(sl.type).toBe('low');
            });
        });

        it('명확한 고점 구조에서 swingHighs가 감지된다', () => {
            const P = SMC_SWING_PERIOD;
            const bars: Bar[] = [
                ...Array.from({ length: P }, (_, i) => makeBar(100, 90, 95, i)),
                makeBar(200, 90, 145, P),
                ...Array.from({ length: P }, (_, i) =>
                    makeBar(100, 90, 95, P + 1 + i)
                ),
            ];
            const result = calculateSmc(bars);
            expect(result.swingHighs.length).toBeGreaterThan(0);
        });

        it('명확한 저점 구조에서 swingLows가 감지된다', () => {
            const P = SMC_SWING_PERIOD;
            const bars: Bar[] = [
                ...Array.from({ length: P }, (_, i) => makeBar(100, 90, 95, i)),
                makeBar(100, 10, 55, P),
                ...Array.from({ length: P }, (_, i) =>
                    makeBar(100, 90, 95, P + 1 + i)
                ),
            ];
            const result = calculateSmc(bars);
            expect(result.swingLows.length).toBeGreaterThan(0);
        });
    });

    describe('Fair Value Gap 감지', () => {
        it('bars가 3개 미만이면 fairValueGaps가 빈 배열이다', () => {
            const bars = [makeBar(100, 90, 95, 0), makeBar(105, 95, 100, 1)];
            const result = calculateSmc(bars);
            expect(result.fairValueGaps).toEqual([]);
        });

        it('구조적으로 상승하는 데이터에서 bullish FVG가 감지된다', () => {
            const bars: Bar[] = [
                makeBar(100, 90, 95, 0),
                makeBar(101, 91, 96, 1),
                // bars[2].low(110) > bars[0].high(100) → bullish FVG
                makeBar(120, 110, 115, 2),
            ];
            const result = calculateSmc(bars);
            const bullishFvgs = result.fairValueGaps.filter(
                f => f.type === 'bullish'
            );
            expect(bullishFvgs.length).toBeGreaterThan(0);
        });

        it('구조적으로 하락하는 데이터에서 bearish FVG가 감지된다', () => {
            const bars: Bar[] = [
                makeBar(120, 110, 115, 0),
                makeBar(115, 105, 110, 1),
                // bars[2].high(100) < bars[0].low(110) → bearish FVG
                makeBar(100, 80, 90, 2),
            ];
            const result = calculateSmc(bars);
            const bearishFvgs = result.fairValueGaps.filter(
                f => f.type === 'bearish'
            );
            expect(bearishFvgs.length).toBeGreaterThan(0);
        });

        it('bullish FVG가 이후 봉에서 mitigate되면 isMitigated가 true이다', () => {
            const bars: Bar[] = [
                makeBar(100, 90, 95, 0), // anchor (bars[0])
                makeBar(101, 91, 96, 1),
                makeBar(120, 110, 115, 2), // bullish FVG: low(110) > bars[0].high(100)
                // bars[3].low(108) <= fvg.high(110) → mitigated
                makeBar(115, 108, 112, 3),
            ];
            const result = calculateSmc(bars);
            const mitigated = result.fairValueGaps.filter(f => f.isMitigated);
            expect(mitigated.length).toBeGreaterThan(0);
        });

        it('bearish FVG가 이후 봉에서 mitigate되면 isMitigated가 true이다', () => {
            const bars: Bar[] = [
                makeBar(120, 110, 115, 0), // anchor
                makeBar(115, 105, 110, 1),
                makeBar(100, 80, 90, 2), // bearish FVG: high(100) < bars[0].low(110)
                // bars[3].high(102) >= fvg.low(100) → mitigated
                makeBar(102, 85, 95, 3),
            ];
            const result = calculateSmc(bars);
            const mitigated = result.fairValueGaps.filter(f => f.isMitigated);
            expect(mitigated.length).toBeGreaterThan(0);
        });

        it('FVG 이후 봉이 없으면 isMitigated가 false이다', () => {
            const bars: Bar[] = [
                makeBar(100, 90, 95, 0),
                makeBar(101, 91, 96, 1),
                makeBar(120, 110, 115, 2), // bullish FVG — no bars after
            ];
            const result = calculateSmc(bars);
            const unmitigated = result.fairValueGaps.filter(
                f => !f.isMitigated
            );
            expect(unmitigated.length).toBeGreaterThan(0);
        });
    });

    describe('Structure Break (BOS / CHoCH) 감지', () => {
        it('swing이 없으면 structureBreaks가 빈 배열이다', () => {
            const bars = Array.from({ length: MIN_SWING_BARS - 1 }, (_, i) =>
                makeBar(100, 90, 95, i)
            );
            const result = calculateSmc(bars);
            expect(result.structureBreaks).toEqual([]);
        });

        it('최초 bullish 구조 돌파는 BOS로 분류된다', () => {
            const P = SMC_SWING_PERIOD;
            const bars: Bar[] = [];
            let t = 0;
            for (let i = 0; i < P; i++) bars.push(makeBar(100, 90, 95, t++));
            bars.push(makeBar(300, 90, 195, t++)); // swing high at P
            for (let i = 0; i < P; i++) bars.push(makeBar(100, 90, 95, t++));
            bars.push(makeBar(350, 90, 310, t++)); // close > 300 → bullish BOS
            const result = calculateSmc(bars);
            const bos = result.structureBreaks.filter(
                b => b.breakType === 'bos' && b.type === 'bullish'
            );
            expect(bos.length).toBeGreaterThan(0);
        });

        it('최초 bearish 구조 돌파는 BOS로 분류된다', () => {
            const P = SMC_SWING_PERIOD;
            const bars: Bar[] = [];
            let t = 0;
            for (let i = 0; i < P; i++) bars.push(makeBar(100, 90, 95, t++));
            bars.push(makeBar(100, 10, 55, t++)); // swing low at P
            for (let i = 0; i < P; i++) bars.push(makeBar(100, 90, 95, t++));
            bars.push(makeBar(100, 90, 5, t++)); // close < 10 → bearish BOS
            const result = calculateSmc(bars);
            const bos = result.structureBreaks.filter(
                b => b.breakType === 'bos' && b.type === 'bearish'
            );
            expect(bos.length).toBeGreaterThan(0);
        });

        it('기존 bearish 추세에서 bullish 돌파는 CHoCH로 분류된다', () => {
            const P = SMC_SWING_PERIOD;
            const bars: Bar[] = [];
            let t = 0;

            // Phase 1: bearish BOS (trend → bearish)
            for (let i = 0; i < P; i++) bars.push(makeBar(100, 90, 95, t++));
            bars.push(makeBar(100, 10, 55, t++)); // swing low
            for (let i = 0; i < P; i++) bars.push(makeBar(100, 90, 95, t++));
            bars.push(makeBar(100, 90, 5, t++)); // close < 10 → bearish BOS

            // Phase 2: swing high, then bullish break → CHoCH
            for (let i = 0; i < P; i++) bars.push(makeBar(100, 90, 95, t++));
            bars.push(makeBar(300, 90, 195, t++)); // swing high
            for (let i = 0; i < P; i++) bars.push(makeBar(100, 90, 95, t++));
            bars.push(makeBar(350, 90, 310, t++)); // close > 300 → CHoCH

            const result = calculateSmc(bars);
            const choch = result.structureBreaks.filter(
                b => b.breakType === 'choch'
            );
            expect(choch.length).toBeGreaterThan(0);
        });
    });

    describe('Order Block 감지', () => {
        it('structure break가 없으면 orderBlocks가 빈 배열이다', () => {
            const bars = Array.from({ length: MIN_SWING_BARS - 1 }, (_, i) =>
                makeBar(100, 90, 95, i)
            );
            const result = calculateSmc(bars);
            expect(result.orderBlocks).toEqual([]);
        });

        // Builds a dataset with swing low at P, bearish OB candle at 3P,
        // swing high at 3P+1, then bullish breakout at 4P+2.
        // detectStructureBreaks requires BOTH swing highs and swing lows.
        function buildObDataset(P: number, extraBars: Bar[] = []): Bar[] {
            const bars: Bar[] = [];
            let t = 0;
            // Phase 1: swing low at index P
            for (let i = 0; i < P; i++) bars.push(makeBar(100, 90, 95, t++));
            bars.push(makeBar(100, 10, 55, t++)); // swing low (index P)
            for (let i = 0; i < P; i++) bars.push(makeBar(100, 90, 95, t++));
            // Phase 2: bearish candle (OB candidate) then swing high
            bars.push(makeOhlcBar(100, 105, 88, 89, t++)); // bearish OB at 3P
            bars.push(makeOhlcBar(195, 300, 90, 195, t++)); // swing high at 3P+1
            for (let i = 0; i < P; i++) bars.push(makeBar(100, 90, 95, t++));
            bars.push(makeOhlcBar(90, 350, 90, 310, t++)); // bullish BOS at 4P+2
            for (const b of extraBars) bars.push({ ...b, time: t++ });
            return bars;
        }

        it('bullish BOS 이전 마지막 bearish 캔들이 Order Block으로 감지된다', () => {
            const P = SMC_SWING_PERIOD;
            const result = calculateSmc(buildObDataset(P));
            expect(result.orderBlocks.length).toBeGreaterThan(0);
            expect(result.orderBlocks[0].type).toBe('bullish');
        });

        it('OB 가격대를 완전히 하회하면 bullish OB의 isMitigated가 true이다', () => {
            const P = SMC_SWING_PERIOD;
            // OB.low = 88; add a bar with low=80 < 88 after the breakout
            const mitigationBar = makeBar(100, 80, 85, 0); // time overridden in buildObDataset
            const result = calculateSmc(buildObDataset(P, [mitigationBar]));
            const mitigated = result.orderBlocks.filter(ob => ob.isMitigated);
            expect(mitigated.length).toBeGreaterThan(0);
        });
    });

    describe('Equal High / Low (EQL) 감지', () => {
        it('ATR이 null인 구간(데이터 부족)의 swing point는 equalHighs에 포함되지 않는다', () => {
            // MIN_SWING_BARS only: swing points exist but ATR is null at their indices
            const P = SMC_SWING_PERIOD;
            const bars: Bar[] = [
                ...Array.from({ length: P }, (_, i) =>
                    makeBar(99, 98, 98.5, i)
                ),
                makeBar(105, 98, 101, P), // swing high — ATR null here
                ...Array.from({ length: P }, (_, i) =>
                    makeBar(99, 98, 98.5, P + 1 + i)
                ),
            ];
            const result = calculateSmc(bars);
            // ATR_PERIOD=14 > swing index (P=5), so ATR is null → no equal levels
            expect(result.equalHighs).toEqual([]);
        });

        it('가격 차이가 ATR×multiplier 이내인 두 swing high는 equalHighs로 감지된다', () => {
            const P = SMC_SWING_PERIOD;
            const WARMUP = SMC_ATR_PERIOD; // ensure ATR is non-null at swing points
            const bars: Bar[] = [];
            let t = 0;

            // ATR warmup: stable bars with small range so ATR ≈ 1-2
            for (let i = 0; i < WARMUP + P; i++) {
                bars.push(makeBar(100, 98, 99, t++));
            }
            // First hump: swing high at 105
            bars.push(makeBar(105, 98, 101.5, t++));
            // Bridge between humps (> 2P bars)
            for (let i = 0; i < P * 2 + 1; i++) {
                bars.push(makeBar(100, 98, 99, t++));
            }
            // Second hump: swing high at 105 (same price → clearly within threshold)
            bars.push(makeBar(105, 98, 101.5, t++));
            // Trailing bars to confirm second hump
            for (let i = 0; i < P; i++) {
                bars.push(makeBar(100, 98, 99, t++));
            }

            const result = calculateSmc(bars);
            expect(result.equalHighs.length).toBeGreaterThan(0);
            expect(result.equalHighs[0]).toEqual({
                price: expect.any(Number),
                firstIndex: expect.any(Number),
                secondIndex: expect.any(Number),
            });
            expect(result.equalHighs[0]).not.toHaveProperty('type');
        });
    });
});
