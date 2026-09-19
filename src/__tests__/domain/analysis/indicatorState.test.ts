import { describe, expect, it } from 'vitest';
import {
    ADX_WEAK_THRESHOLD,
    buildIndicatorStateSection,
    INDICATOR_STATE_SECTION_HEADER,
    type IndicatorStateInput,
} from '@/domain/analysis/indicatorState';
import { ADX_TRENDING_THRESHOLD } from '@/domain/analysis/marketReferenceConstants';
import {
    STOCHASTIC_OVERBOUGHT_LEVEL,
    STOCHASTIC_OVERSOLD_LEVEL,
} from '@/domain/indicators/constants';

const baseInput: IndicatorStateInput = {
    price: 100,
    ma: { 5: [104], 20: [102], 60: [101], 120: [100] },
    // ema9=103 > ema21=100 > ema60=95 -> upper +3, middle +8, lower +5 -> stage 1.
    ema: { 9: [103], 21: [100], 60: [95] },
    maPeriods: [5, 20, 60, 120],
    emaPeriods: [9],
    macd: { macd: 1, signal: 0.5, histogram: 0.5 },
    macdHistogramTrend: 'rising',
    dmi: { diPlus: 30, diMinus: 15, adx: 28 },
    stochastic: { percentK: 85, percentD: 70 },
    ichimoku: {
        tenkan: 105,
        kijun: 100,
        senkouA: 95,
        senkouB: 90,
        chikou: 100,
    },
    bollinger: { upper: 110, middle: 100, lower: 90 },
    supertrend: { supertrend: 95, trend: 'up' },
    parabolicSar: { sar: 90, trend: 'up' },
    atr: 2,
    diffDp: 2,
    lastVolume: 1500,
    priorVolumes: Array.from({ length: 20 }, () => 1000),
};

describe('buildIndicatorStateSection', () => {
    it('renders the header first', () => {
        const section = buildIndicatorStateSection(baseInput);
        expect(section.startsWith(INDICATOR_STATE_SECTION_HEADER)).toBe(true);
    });

    describe('Price vs MA/EMA', () => {
        it('renders above/below by x.xx% per period (normal)', () => {
            const section = buildIndicatorStateSection(baseInput);
            // price 100 vs MA5 104 -> below by 3.85%
            expect(section).toContain('MA(5) below by 3.85%');
            // price 100 vs MA120 100 -> above by 0.00% (>=0 counted as above)
            expect(section).toContain('MA(120) above by 0.00%');
            expect(section).toContain('EMA(9) below by');
        });

        it('is N/A when the MA period has no value', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                ma: { 5: [null] },
                maPeriods: [5],
            });
            expect(section).toContain('MA(5) N/A');
        });

        it('is N/A when the level is zero (zero base)', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                ma: { 5: [0] },
                maPeriods: [5],
            });
            expect(section).toContain('MA(5) N/A');
        });

        it('is N/A when the level is negative', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                ma: { 5: [-10] },
                maPeriods: [5],
            });
            expect(section).toContain('MA(5) N/A');
        });

        it('is N/A when price is NaN', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                price: Number.NaN,
                maPeriods: [5],
            });
            expect(section).toContain('MA(5) N/A');
        });

        it('is N/A when price is null', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                price: null,
                maPeriods: [5],
            });
            expect(section).toContain('MA(5) N/A');
        });

        it('is N/A when price is zero or negative — an unknown reference, not a real reading (spec 2026-09-18)', () => {
            const zero = buildIndicatorStateSection({
                ...baseInput,
                price: 0,
                maPeriods: [5],
            });
            expect(zero).toContain('MA(5) N/A');
            const negative = buildIndicatorStateSection({
                ...baseInput,
                price: -10,
                maPeriods: [5],
            });
            expect(negative).toContain('MA(5) N/A');
        });

        it('skips a NaN entry in the series and falls back to the last finite value (spec 2026-09-18)', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                ma: { 5: [104, Number.NaN] },
                maPeriods: [5],
            });
            // price 100 vs 104 -> below by 3.85%, same as the base fixture —
            // the trailing NaN must not read as "the last value".
            expect(section).toContain('MA(5) below by 3.85%');
        });
    });

    describe('MA stack', () => {
        it('reports bullish when values strictly decrease with period', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                ma: { 5: [104], 20: [102], 60: [101], 120: [100] },
            });
            expect(section).toContain(
                '- MA stack: bullish (MA5>MA20>MA60>MA120)'
            );
        });

        it('reports bearish when values strictly increase with period', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                ma: { 5: [100], 20: [101], 60: [102], 120: [104] },
            });
            expect(section).toContain(
                '- MA stack: bearish (MA5<MA20<MA60<MA120)'
            );
        });

        it('reports mixed when order is neither strictly increasing nor decreasing', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                ma: { 5: [101], 20: [104], 60: [100], 120: [103] },
            });
            expect(section).toContain('- MA stack: mixed');
        });

        it('is N/A when fewer than 2 periods have a value', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                ma: { 5: [104], 20: [null], 60: [null], 120: [null] },
            });
            expect(section).toContain('- MA stack: N/A');
        });
    });

    describe('MACD', () => {
        it('reports above signal / above zero / histogram trend (normal)', () => {
            const section = buildIndicatorStateSection(baseInput);
            expect(section).toContain(
                '- MACD: above signal, above zero, histogram rising'
            );
        });

        it('reports below signal / below zero / falling', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                macd: { macd: -1, signal: -0.5, histogram: -0.5 },
                macdHistogramTrend: 'falling',
            });
            expect(section).toContain(
                '- MACD: below signal, below zero, histogram falling'
            );
        });

        it('is N/A when macd is undefined or histogram trend is null', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                macd: undefined,
                macdHistogramTrend: null,
            });
            expect(section).toContain(
                '- MACD: signal N/A, zero N/A, histogram N/A'
            );
        });

        it('is N/A when macd values are null', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                macd: { macd: null, signal: null, histogram: null },
            });
            expect(section).toContain('- MACD: signal N/A, zero N/A,');
        });
    });

    describe('DMI', () => {
        it('reports +DI above -DI and ADX trending (>= threshold)', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                dmi: { diPlus: 30, diMinus: 15, adx: ADX_TRENDING_THRESHOLD },
            });
            expect(section).toContain('+DI above -DI');
            expect(section).toContain(
                `ADX ${ADX_TRENDING_THRESHOLD.toFixed(2)} trending`
            );
        });

        it('reports ADX weak below the weak threshold', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                dmi: {
                    diPlus: 10,
                    diMinus: 20,
                    adx: ADX_WEAK_THRESHOLD - 1,
                },
            });
            expect(section).toContain('+DI below -DI');
            expect(section).toContain('weak');
        });

        it('reports ADX between when in the middle band', () => {
            const midpoint = (ADX_WEAK_THRESHOLD + ADX_TRENDING_THRESHOLD) / 2;
            const section = buildIndicatorStateSection({
                ...baseInput,
                dmi: { diPlus: 20, diMinus: 20, adx: midpoint },
            });
            expect(section).toContain('between');
        });

        it('is N/A when dmi is undefined', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                dmi: undefined,
            });
            expect(section).toContain('- DMI: +DI N/A, ADX N/A');
        });
    });

    describe('Stochastic', () => {
        it('reports overbought at/above the threshold', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                stochastic: {
                    percentK: STOCHASTIC_OVERBOUGHT_LEVEL,
                    percentD: 50,
                },
            });
            expect(section).toContain('%K above %D, zone overbought');
        });

        it('reports oversold at/below the threshold', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                stochastic: {
                    percentK: STOCHASTIC_OVERSOLD_LEVEL,
                    percentD: 50,
                },
            });
            expect(section).toContain('%K below %D, zone oversold');
        });

        it('reports neutral zone otherwise', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                stochastic: { percentK: 50, percentD: 40 },
            });
            expect(section).toContain('zone neutral');
        });

        it('is N/A when stochastic is undefined', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                stochastic: undefined,
            });
            expect(section).toContain('- Stochastic: %K N/A, zone N/A');
        });
    });

    describe('Ichimoku', () => {
        it('reports above cloud and tenkan above kijun', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                price: 200,
                ichimoku: {
                    tenkan: 105,
                    kijun: 100,
                    senkouA: 95,
                    senkouB: 90,
                    chikou: null,
                },
            });
            expect(section).toContain(
                '- Ichimoku: price above cloud, tenkan above kijun'
            );
        });

        it('reports inside cloud', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                price: 92,
                ichimoku: {
                    tenkan: 95,
                    kijun: 100,
                    senkouA: 95,
                    senkouB: 90,
                    chikou: null,
                },
            });
            expect(section).toContain('price inside cloud');
            expect(section).toContain('tenkan below kijun');
        });

        it('reports below cloud', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                price: 80,
                ichimoku: {
                    tenkan: 95,
                    kijun: 100,
                    senkouA: 95,
                    senkouB: 90,
                    chikou: null,
                },
            });
            expect(section).toContain('price below cloud');
        });

        it('is N/A when senkou values are missing', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                ichimoku: {
                    tenkan: null,
                    kijun: null,
                    senkouA: null,
                    senkouB: null,
                    chikou: null,
                },
            });
            expect(section).toContain('- Ichimoku: price N/A, tenkan N/A');
        });

        it('cloud position is N/A when price is zero or negative (spec 2026-09-18)', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                price: 0,
                ichimoku: {
                    tenkan: 105,
                    kijun: 100,
                    senkouA: 95,
                    senkouB: 90,
                    chikou: null,
                },
            });
            expect(section).toContain('- Ichimoku: price N/A,');
        });
    });

    describe('Bollinger', () => {
        it('reports above upper', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                price: 115,
                bollinger: { upper: 110, middle: 100, lower: 90 },
            });
            expect(section).toContain(
                '- Bollinger: price position above upper'
            );
        });

        it('reports upper half', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                price: 105,
                bollinger: { upper: 110, middle: 100, lower: 90 },
            });
            expect(section).toContain('price position upper half');
        });

        it('reports lower half', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                price: 95,
                bollinger: { upper: 110, middle: 100, lower: 90 },
            });
            expect(section).toContain('price position lower half');
        });

        it('reports below lower', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                price: 85,
                bollinger: { upper: 110, middle: 100, lower: 90 },
            });
            expect(section).toContain('price position below lower');
        });

        it('is N/A when bands are missing', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                bollinger: { upper: null, middle: null, lower: null },
            });
            expect(section).toContain('- Bollinger: N/A');
        });

        it('is N/A when price is zero or negative (spec 2026-09-18)', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                price: -5,
                bollinger: { upper: 110, middle: 100, lower: 90 },
            });
            expect(section).toContain('- Bollinger: N/A');
        });
    });

    describe('Supertrend / Parabolic SAR distance', () => {
        it('reports distance normally', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                price: 100,
                supertrend: { supertrend: 95, trend: 'up' },
                parabolicSar: { sar: 105, trend: 'down' },
            });
            expect(section).toContain('- Supertrend: above by 5.26%');
            expect(section).toContain('- Parabolic SAR: below by 4.76%');
        });

        it('is N/A when the level is zero (zero base)', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                supertrend: { supertrend: 0, trend: 'up' },
            });
            expect(section).toContain('- Supertrend: N/A');
        });

        it('is N/A when the level is negative', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                supertrend: { supertrend: -1, trend: 'up' },
            });
            expect(section).toContain('- Supertrend: N/A');
        });

        it('is N/A when the level is NaN', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                parabolicSar: { sar: Number.NaN, trend: null },
            });
            expect(section).toContain('- Parabolic SAR: N/A');
        });

        it('is N/A when the level is null', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                parabolicSar: { sar: null, trend: null },
            });
            expect(section).toContain('- Parabolic SAR: N/A');
        });
    });

    describe('ATR % of price', () => {
        it('computes atr / price × 100 (normal)', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                price: 100,
                atr: 2,
            });
            expect(section).toContain('- ATR % of price: 2.00%');
        });

        it('is N/A when price is zero (zero base)', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                price: 0,
                atr: 2,
            });
            expect(section).toContain('- ATR % of price: N/A');
        });

        it('is N/A when price is negative', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                price: -100,
                atr: 2,
            });
            expect(section).toContain('- ATR % of price: N/A');
        });

        it('is N/A when atr is NaN', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                atr: Number.NaN,
            });
            expect(section).toContain('- ATR % of price: N/A');
        });

        it('is N/A when atr is null', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                atr: null,
            });
            expect(section).toContain('- ATR % of price: N/A');
        });
    });

    describe('MACD cycle (spec 2026-09-18 §A4(i), macd-cycle.md)', () => {
        // (ema9, ema21, ema60) constructed directly from the skill's "EMA
        // Order" column for each stage (Short/Mid/Long = EMA9/21/60):
        // 1 Short>Mid>Long, 2 Mid>Short>Long, 3 Mid>Long>Short,
        // 4 Long>Mid>Short, 5 Long>Short>Mid, 6 Short>Long>Mid.
        it.each([
            [103, 100, 95, 1],
            [100, 103, 95, 2],
            [90, 100, 95, 3],
            [90, 95, 100, 4],
            [95, 90, 100, 5],
            [100, 90, 95, 6],
        ])(
            'ema9=%s ema21=%s ema60=%s -> stage %s',
            (ema9, ema21, ema60, stage) => {
                const section = buildIndicatorStateSection({
                    ...baseInput,
                    ema: { 9: [ema9], 21: [ema21], 60: [ema60] },
                });
                expect(section).toContain(`stage ${stage}`);
            }
        );

        it('renders the exact upper/middle/lower label + values at diffDp precision', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                ema: { 9: [103], 21: [100], 60: [95] },
                diffDp: 2,
            });
            expect(section).toContain(
                '- MACD cycle (EMA9/21/60): upper (EMA9−EMA21) +3.00, middle (EMA9−EMA60) +8.00, lower (EMA21−EMA60) +5.00; stage 1'
            );
        });

        it('reports "stage N/A (transition)" when one of the three differences is exactly zero (a tie matches no table row)', () => {
            // Only 6 of the 8 +/- combinations are even reachable by 3 real,
            // DISTINCT numbers (pairwise differences of 3 totally-ordered
            // values have exactly 3! = 6 possible sign patterns) — so the
            // "no matching row" branch is only reachable via a genuine tie
            // (a value of exactly 0), not an alternate sign combination.
            const section = buildIndicatorStateSection({
                ...baseInput,
                ema: { 9: [100], 21: [100], 60: [95] }, // upper === 0
            });
            expect(section).toContain('stage N/A (transition)');
        });

        it('is N/A when any of EMA9/21/60 is missing', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                ema: { 9: [103], 21: [100] }, // no 60
            });
            expect(section).toContain('- MACD cycle (EMA9/21/60): N/A');
        });
    });

    it('never renders its own "- Bollinger %B:" line — the Pro-Indicator section always prints one, so this would duplicate it (spec 2026-09-18)', () => {
        const section = buildIndicatorStateSection(baseInput);
        expect(section).not.toContain('Bollinger %B');
    });

    describe('Volume vs 20-bar average (spec 2026-09-18 §A4(iii))', () => {
        it('computes last bar volume as a multiple of the 20-bar average', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                lastVolume: 1500,
                priorVolumes: Array.from({ length: 20 }, () => 1000),
            });
            expect(section).toContain(
                '- Volume: last bar 1.50× 20-bar average'
            );
        });

        it('is N/A when there are fewer than 20 prior volumes', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                priorVolumes: Array.from({ length: 19 }, () => 1000),
            });
            expect(section).toContain('- Volume: N/A');
        });

        it('slices its own trailing 20-bar window from raw history (spec 2026-09-18) — extra older bars, even non-finite ones, are ignored', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                lastVolume: 1500,
                // 5 garbage entries the caller's history happens to carry,
                // THEN the real trailing 20 — this used to require the
                // caller to slice exactly 20 itself.
                priorVolumes: [
                    Number.NaN,
                    Number.NaN,
                    Number.NaN,
                    Number.NaN,
                    Number.NaN,
                    ...Array.from({ length: 20 }, () => 1000),
                ],
            });
            expect(section).toContain(
                '- Volume: last bar 1.50× 20-bar average'
            );
        });

        it('is N/A when any prior volume is non-finite', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                priorVolumes: [
                    Number.NaN,
                    ...Array.from({ length: 19 }, () => 1000),
                ],
            });
            expect(section).toContain('- Volume: N/A');
        });

        it('is N/A when the 20-bar average is 0 (zero base)', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                priorVolumes: Array.from({ length: 20 }, () => 0),
            });
            expect(section).toContain('- Volume: N/A');
        });

        it('is N/A when lastVolume is null', () => {
            const section = buildIndicatorStateSection({
                ...baseInput,
                lastVolume: null,
            });
            expect(section).toContain('- Volume: N/A');
        });
    });
});
