import { describe, expect, it } from 'vitest';
import {
    ANALYSIS_TREND_MIN_BARS,
    computeAnalysisTrend,
    trendBasisOf,
} from '@/domain/analysis/analysisTrend';
import {
    EMPTY_INDICATOR_RESULT,
    ATR_DEFAULT_PERIOD,
} from '@/domain/indicators/constants';
import { calculateIndicators } from '@/domain/indicators';
import {
    TREND_EMA_PERIOD,
    TREND_SLOPE_LOOKBACK,
    TREND_SLOPE_MIN_ATR,
} from '@/domain/signals/constants';
import type { Bar, IndicatorResult, Trend } from '@/domain/types';

/** The shortest history the rule can measure: EMA20 needs 20 bars, and the slope reads it 20 bars later. */
const MIN_BARS = ANALYSIS_TREND_MIN_BARS;

function barsOf(closes: readonly number[]): Bar[] {
    return closes.map((close, i) => ({
        time: 1_700_000_000 + i * 86_400,
        open: close,
        high: close,
        low: close,
        close,
        volume: 1000,
    }));
}

interface Hand {
    readonly emaFrom: number;
    readonly emaLast: number;
    readonly atr: number | null;
    readonly close: number;
    /** Bars in the series; the EMA/ATR arrays are filled to match. */
    readonly length?: number;
}

/**
 * Bars and indicators with hand-picked EMA and ATR values at the two bars the rule
 * reads (the last, and `TREND_SLOPE_LOOKBACK` before it), so a boundary is placed
 * exactly instead of being reached through a price path.
 */
function hand({ emaFrom, emaLast, atr, close, length = MIN_BARS }: Hand): {
    bars: Bar[];
    indicators: IndicatorResult;
} {
    const last = length - 1;
    const from = last - TREND_SLOPE_LOOKBACK;
    const ema = Array.from({ length }, (_, i) => {
        if (i === last) return emaLast;
        if (i === from) return emaFrom;
        return null;
    });
    const atrSeries = Array.from({ length }, (_, i) =>
        i === last ? atr : null
    );
    return {
        bars: barsOf(
            Array.from({ length }, (_, i) => (i === last ? close : 1))
        ),
        indicators: {
            ...EMPTY_INDICATOR_RESULT,
            ema: { [TREND_EMA_PERIOD]: ema },
            atr: atrSeries,
        },
    };
}

const trendOf = (h: Hand): Trend | null =>
    computeAnalysisTrend(hand(h).bars, hand(h).indicators)?.trend ?? null;

describe('computeAnalysisTrend', () => {
    describe('slope boundary (ATR = 2, EMA from 100)', () => {
        const base = { emaFrom: 100, atr: 2 };

        it('exactly +1.00 ATR with the close above EMA20 is bullish (inclusive)', () => {
            expect(
                trendOf({
                    ...base,
                    emaLast: 100 + TREND_SLOPE_MIN_ATR * 2,
                    close: 110,
                })
            ).toBe('bullish');
        });

        it('+0.99 ATR is neutral', () => {
            expect(trendOf({ ...base, emaLast: 101.98, close: 110 })).toBe(
                'neutral'
            );
        });

        it('exactly -1.00 ATR with the close below EMA20 is bearish (inclusive)', () => {
            expect(
                trendOf({
                    ...base,
                    emaLast: 100 - TREND_SLOPE_MIN_ATR * 2,
                    close: 90,
                })
            ).toBe('bearish');
        });

        it('-0.99 ATR is neutral', () => {
            expect(trendOf({ ...base, emaLast: 98.02, close: 90 })).toBe(
                'neutral'
            );
        });
    });

    describe('close boundary', () => {
        it('a close equal to EMA20 is neutral on a rising EMA (strict)', () => {
            expect(
                trendOf({ emaFrom: 100, emaLast: 110, atr: 2, close: 110 })
            ).toBe('neutral');
        });

        it('a close equal to EMA20 is neutral on a falling EMA (strict)', () => {
            expect(
                trendOf({ emaFrom: 110, emaLast: 100, atr: 2, close: 100 })
            ).toBe('neutral');
        });

        it('a close just above EMA20 on a rising EMA is bullish', () => {
            expect(
                trendOf({ emaFrom: 100, emaLast: 110, atr: 2, close: 110.01 })
            ).toBe('bullish');
        });

        it('a close below EMA20 on a rising EMA is neutral (a bounce-back is not a trend)', () => {
            expect(
                trendOf({ emaFrom: 100, emaLast: 110, atr: 2, close: 109.99 })
            ).toBe('neutral');
        });

        it('a close above EMA20 on a falling EMA is neutral (a bounce is not a trend)', () => {
            expect(
                trendOf({ emaFrom: 110, emaLast: 100, atr: 2, close: 100.01 })
            ).toBe('neutral');
        });
    });

    describe('2-decimal rounding decides the label', () => {
        it('0.995 rounds half away from zero to 1.00 and is bullish, and the reading carries 1', () => {
            const h = hand({ emaFrom: 0, emaLast: 0.995, atr: 1, close: 5 });
            const reading = computeAnalysisTrend(h.bars, h.indicators);
            expect(reading?.slopeAtr).toBe(1);
            expect(reading?.trend).toBe('bullish');
        });

        it('-0.995 rounds to -1.00 and is bearish (a negative slope rounds like its mirror)', () => {
            const h = hand({
                emaFrom: 1,
                emaLast: 0.005,
                atr: 1,
                close: 0.001,
            });
            const reading = computeAnalysisTrend(h.bars, h.indicators);
            expect(reading?.slopeAtr).toBe(-1);
            expect(reading?.trend).toBe('bearish');
        });

        it('0.994 rounds down to 0.99 and is neutral', () => {
            const h = hand({ emaFrom: 0, emaLast: 0.994, atr: 1, close: 5 });
            const reading = computeAnalysisTrend(h.bars, h.indicators);
            expect(reading?.slopeAtr).toBe(0.99);
            expect(reading?.trend).toBe('neutral');
        });

        it('the label is the one recomputed from the printed (rounded) slope', () => {
            const h = hand({
                emaFrom: 100,
                emaLast: 103.37,
                atr: 2.5,
                close: 110,
            });
            const reading = computeAnalysisTrend(h.bars, h.indicators);
            expect(reading?.slopeAtr).toBe(1.35);
            expect(reading?.trend).toBe(
                (reading?.slopeAtr ?? 0) >= TREND_SLOPE_MIN_ATR
                    ? 'bullish'
                    : 'neutral'
            );
        });
    });

    describe('the reading', () => {
        it('carries the numbers the label was decided on', () => {
            const h = hand({
                emaFrom: 182.4,
                emaLast: 175.1,
                atr: 3.98,
                close: 171.2,
            });
            expect(computeAnalysisTrend(h.bars, h.indicators)).toEqual({
                trend: 'bearish',
                slopeAtr: -1.83,
                emaLast: 175.1,
                emaFrom: 182.4,
                close: 171.2,
            });
        });

        it('is scale-free: scaling every price by 1000 keeps the slope and the label', () => {
            const small = hand({
                emaFrom: 100,
                emaLast: 104,
                atr: 2,
                close: 106,
            });
            const large = hand({
                emaFrom: 100_000,
                emaLast: 104_000,
                atr: 2000,
                close: 106_000,
            });
            const a = computeAnalysisTrend(small.bars, small.indicators);
            const b = computeAnalysisTrend(large.bars, large.indicators);
            expect(a?.slopeAtr).toBe(2);
            expect(b?.slopeAtr).toBe(2);
            expect(a?.trend).toBe(b?.trend);
        });

        it('needs 40 bars (EMA period + lookback), derived from the constants', () => {
            expect(ANALYSIS_TREND_MIN_BARS).toBe(40);
            expect(ANALYSIS_TREND_MIN_BARS).toBe(
                TREND_EMA_PERIOD + TREND_SLOPE_LOOKBACK
            );
        });

        it('on the real indicator engine: 39 bars is not measurable, 40 bars is', () => {
            const closes = Array.from(
                { length: ANALYSIS_TREND_MIN_BARS },
                (_, i) => 100 + i * 2
            );
            const measure = (count: number) => {
                const bars = barsOf(closes.slice(0, count)).map(b => ({
                    ...b,
                    high: b.close + 1,
                    low: b.close - 1,
                }));
                return computeAnalysisTrend(bars, calculateIndicators(bars));
            };
            expect(measure(ANALYSIS_TREND_MIN_BARS - 1)).toBeNull();
            expect(measure(ANALYSIS_TREND_MIN_BARS)?.trend).toBe('bullish');
        });

        it('measures the shortest history (40 bars: the EMA 20 bars back is its first value)', () => {
            expect(
                trendOf({
                    emaFrom: 100,
                    emaLast: 110,
                    atr: 2,
                    close: 120,
                    length: MIN_BARS,
                })
            ).toBe('bullish');
        });
    });

    describe('not measurable returns null, never neutral (DOM-1)', () => {
        const ok = { emaFrom: 100, emaLast: 110, atr: 2, close: 120 };

        it('is measurable with the base values (control)', () => {
            expect(trendOf(ok)).toBe('bullish');
        });

        it('one bar fewer than the lookback needs', () => {
            expect(trendOf({ ...ok, length: MIN_BARS - 1 })).toBeNull();
        });

        it('no bars', () => {
            expect(
                computeAnalysisTrend([], {
                    ...EMPTY_INDICATOR_RESULT,
                    ema: { [TREND_EMA_PERIOD]: [] },
                })
            ).toBeNull();
        });

        it('no EMA20 series', () => {
            const h = hand(ok);
            expect(
                computeAnalysisTrend(h.bars, {
                    ...h.indicators,
                    ema: {},
                })
            ).toBeNull();
        });

        it('EMA20 null at the last bar', () => {
            const h = hand(ok);
            const ema = (h.indicators.ema[TREND_EMA_PERIOD] ?? []).map(
                (v, i, all) => (i === all.length - 1 ? null : v)
            );
            expect(
                computeAnalysisTrend(h.bars, {
                    ...h.indicators,
                    ema: { [TREND_EMA_PERIOD]: ema },
                })
            ).toBeNull();
        });

        it('EMA20 null 20 bars back', () => {
            const h = hand(ok);
            const ema = (h.indicators.ema[TREND_EMA_PERIOD] ?? []).map(
                (v, i, all) =>
                    i === all.length - 1 - TREND_SLOPE_LOOKBACK ? null : v
            );
            expect(
                computeAnalysisTrend(h.bars, {
                    ...h.indicators,
                    ema: { [TREND_EMA_PERIOD]: ema },
                })
            ).toBeNull();
        });

        it.each([
            ['NaN', Number.NaN],
            ['Infinity', Number.POSITIVE_INFINITY],
        ])('EMA20 %s at the last bar', (_label, value) => {
            expect(trendOf({ ...ok, emaLast: value })).toBeNull();
        });

        it.each([
            ['NaN', Number.NaN],
            ['-Infinity', Number.NEGATIVE_INFINITY],
        ])('EMA20 %s 20 bars back', (_label, value) => {
            expect(trendOf({ ...ok, emaFrom: value })).toBeNull();
        });

        it.each([
            ['null', null],
            ['zero', 0],
            ['negative', -1],
            ['NaN', Number.NaN],
            ['Infinity', Number.POSITIVE_INFINITY],
        ])('ATR %s', (_label, atr) => {
            expect(trendOf({ ...ok, atr })).toBeNull();
        });

        it.each([
            ['zero', 0],
            ['negative', -5],
            ['NaN', Number.NaN],
            ['Infinity', Number.POSITIVE_INFINITY],
        ])('close %s', (_label, close) => {
            expect(trendOf({ ...ok, close })).toBeNull();
        });

        it('EMA series not aligned with the bars (shorter)', () => {
            const h = hand(ok);
            expect(
                computeAnalysisTrend(h.bars, {
                    ...h.indicators,
                    ema: {
                        [TREND_EMA_PERIOD]: (
                            h.indicators.ema[TREND_EMA_PERIOD] ?? []
                        ).slice(1),
                    },
                })
            ).toBeNull();
        });

        it('ATR series not aligned with the bars (longer)', () => {
            const h = hand(ok);
            expect(
                computeAnalysisTrend(h.bars, {
                    ...h.indicators,
                    atr: [...h.indicators.atr, 2],
                })
            ).toBeNull();
        });
    });

    describe('trendBasisOf', () => {
        it('records the slope and the constants the rule ran with', () => {
            const h = hand({ emaFrom: 100, emaLast: 104, atr: 2, close: 106 });
            const reading = computeAnalysisTrend(h.bars, h.indicators);
            expect(reading).not.toBeNull();
            if (reading === null) return;
            expect(trendBasisOf(reading)).toEqual({
                slopeAtr: 2,
                lookbackBars: TREND_SLOPE_LOOKBACK,
                emaPeriod: TREND_EMA_PERIOD,
            });
        });
    });
});

/**
 * The shipped function against the rule written out a second time, on every bar of
 * several long synthetic series (a seeded random walk with drift regimes and volatility
 * regimes, at three price scales). The reference recomputes EMA20 and Wilder ATR(14) from
 * OHLC itself and applies "EMA20 moved >= 1 ATR(14) over 20 bars and the close is beyond
 * EMA20" with its own rounding, so a slip in the shipped boundary, rounding or alignment
 * shows up as a label difference on some day.
 */
describe('computeAnalysisTrend against an independent recomputation', () => {
    function lcg(seed: number): () => number {
        const state = { value: seed };
        return () => {
            state.value =
                (state.value * 1_664_525 + 1_013_904_223) % 4_294_967_296;
            return state.value / 4_294_967_296;
        };
    }

    function series(seed: number, scale: number, count: number): Bar[] {
        const next = lcg(seed);
        const walk = Array.from({ length: count }).reduce<{
            price: number;
            rows: Bar[];
        }>(
            (acc, _, i) => {
                const regime = Math.floor(i / 60) % 4;
                const drift = [0.004, -0.004, 0, 0.0015][regime];
                const vol = [0.012, 0.02, 0.006, 0.03][regime];
                const open = acc.price;
                const close = open * (1 + drift + (next() - 0.5) * 2 * vol);
                const high = Math.max(open, close) * (1 + next() * vol);
                const low = Math.min(open, close) * (1 - next() * vol);
                return {
                    price: close,
                    rows: [
                        ...acc.rows,
                        {
                            time: 1_700_000_000 + i * 86_400,
                            open: open * scale,
                            high: high * scale,
                            low: low * scale,
                            close: close * scale,
                            volume: 1000,
                        },
                    ],
                };
            },
            { price: 100, rows: [] }
        );
        return walk.rows;
    }

    function referenceEma(closes: readonly number[]): (number | null)[] {
        const k = 2 / (TREND_EMA_PERIOD + 1);
        const seed =
            closes.slice(0, TREND_EMA_PERIOD).reduce((s, v) => s + v, 0) /
            TREND_EMA_PERIOD;
        return closes.reduce<(number | null)[]>((acc, close, i) => {
            if (i < TREND_EMA_PERIOD - 1) return [...acc, null];
            if (i === TREND_EMA_PERIOD - 1) return [...acc, seed];
            return [...acc, close * k + (acc[i - 1] ?? 0) * (1 - k)];
        }, []);
    }

    function referenceAtr(bars: readonly Bar[]): (number | null)[] {
        const tr = bars.map((bar, i) =>
            i === 0
                ? 0
                : Math.max(
                      bar.high - bar.low,
                      Math.abs(bar.high - bars[i - 1].close),
                      Math.abs(bar.low - bars[i - 1].close)
                  )
        );
        const p = ATR_DEFAULT_PERIOD;
        const first = tr.slice(1, p + 1).reduce((s, v) => s + v, 0) / p;
        return tr.reduce<(number | null)[]>((acc, value, i) => {
            if (i < p) return [...acc, null];
            if (i === p) return [...acc, first];
            return [...acc, ((acc[i - 1] ?? 0) * (p - 1) + value) / p];
        }, []);
    }

    function referenceLabel(
        bars: readonly Bar[],
        ema: readonly (number | null)[],
        atr: readonly (number | null)[],
        i: number
    ): Trend | null {
        const now = ema[i];
        const before = i >= 20 ? ema[i - 20] : null;
        const range = atr[i];
        if (now === null || before === null || range === null) return null;
        const hundredths = Math.round(Math.abs((now - before) / range) * 100);
        const slope = (Math.sign(now - before) * hundredths) / 100;
        const close = bars[i].close;
        if (slope >= 1 && close > now) return 'bullish';
        if (slope <= -1 && close < now) return 'bearish';
        return 'neutral';
    }

    it.each([
        [1, 1],
        [2, 1],
        [3, 50],
        [4, 0.01],
        [5, 1000],
    ])('seed %i, price scale %f: same label on every bar', (seed, scale) => {
        const bars = series(seed, scale, 900);
        const full = calculateIndicators(bars);
        const ema = referenceEma(bars.map(b => b.close));
        const atr = referenceAtr(bars);

        const outcomes = bars.map((_, i) => {
            const slice = bars.slice(0, i + 1);
            const sliced: IndicatorResult = {
                ...full,
                ema: {
                    ...full.ema,
                    [TREND_EMA_PERIOD]: (
                        full.ema[TREND_EMA_PERIOD] ?? []
                    ).slice(0, i + 1),
                },
                atr: full.atr.slice(0, i + 1),
            };
            return {
                shipped: computeAnalysisTrend(slice, sliced)?.trend ?? null,
                reference: referenceLabel(bars, ema, atr, i),
            };
        });

        expect(outcomes.filter(o => o.shipped !== o.reference)).toEqual([]);
        // The comparison must be meaningful: all three labels occur and bars before the
        // warm-up are unmeasurable on both sides.
        const labels = new Set(outcomes.map(o => o.shipped));
        expect(labels).toEqual(
            new Set(['bullish', 'bearish', 'neutral', null])
        );
    });
});
