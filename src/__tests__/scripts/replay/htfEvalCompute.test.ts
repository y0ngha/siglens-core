import { describe, expect, it } from 'vitest';
import {
    HTF_EVAL_CONSTANTS,
    aggregateMonths,
    aggregateWeeks,
    alignmentOf,
    backdropReading,
    coreTimeframe,
    decimalsOf,
    higherReading,
    isoDateSeconds,
    isoWeekStart,
    krxTick,
    roundToKrxTick,
    matchesPrinted,
    monthStart,
    periodProgress,
    rsiLast,
    smaLast,
    trendOf,
    usableBars,
    weekdayOf,
    windowBars,
} from '../../../../scripts/replay/htfEvalCompute';
import { aggregateBarsToMonthly } from '@/domain/analysis/aggregateBarsToMonthly';
import { aggregateBarsToWeekly } from '@/domain/analysis/aggregateBarsToWeekly';
import { computeAnalysisTrend } from '@/domain/analysis/analysisTrend';
import { calculateIndicators } from '@/domain/indicators';
import { calculateRSI } from '@/domain/indicators/rsi';
import type { Bar } from '@/domain/types';
import { tradingBars } from './replayFixtures';

const bars = tradingBars({
    symbol: 'NVDA',
    startIso: '2022-01-03',
    count: 600,
    close: i => 100 + 0.2 * i + 9 * Math.sin(i / 9),
});
const day = (iso: string): number => isoDateSeconds(iso);

describe('ISO weeks and months', () => {
    it('starts a week on Monday 00:00 UTC, Sunday belonging to the week before', () => {
        // 2026-11-16 is a Monday
        expect(isoWeekStart(day('2026-11-16'))).toBe(day('2026-11-16'));
        expect(isoWeekStart(day('2026-11-18') + 3_600)).toBe(day('2026-11-16'));
        expect(isoWeekStart(day('2026-11-22'))).toBe(day('2026-11-16'));
        expect(isoWeekStart(day('2026-11-23'))).toBe(day('2026-11-23'));
        expect(weekdayOf(isoWeekStart(day('2021-01-01')))).toBe(1);
    });

    it('starts a month on the 1st', () => {
        expect(monthStart(day('2026-11-30'))).toBe(day('2026-11-01'));
        expect(monthStart(day('2026-12-01'))).toBe(day('2026-12-01'));
    });

    it('aggregates like the shipped aggregation on a long series (open, high, low, close, volume, time)', () => {
        const own = aggregateWeeks(bars);
        const core = aggregateBarsToWeekly(bars);
        expect(own.length).toBe(core.length);
        own.forEach((week, i) => {
            expect({
                time: week.time,
                open: week.open,
                high: week.high,
                low: week.low,
                close: week.close,
                volume: week.volume,
            }).toEqual(core[i]);
        });
        const months = aggregateMonths(bars);
        expect(months.map(m => m.time)).toEqual(
            aggregateBarsToMonthly(bars).map(m => m.time)
        );
    });

    it('counts the sessions of a week, a holiday week included', () => {
        // Thanksgiving week 2022: Thursday the 24th is closed
        const week = aggregateWeeks(bars).find(
            w => w.time === day('2022-11-21')
        );
        expect(week?.sessions).toBe(4);
        expect(aggregateWeeks(bars)[0].sessions).toBeGreaterThan(0);
    });

    it('keeps a one-bar week and sums volume, takes extremes and the first open', () => {
        const one: Bar[] = [
            {
                time: day('2026-11-18'),
                open: 10,
                high: 12,
                low: 9,
                close: 11,
                volume: 5,
            },
        ];
        expect(aggregateWeeks(one)).toEqual([
            {
                time: day('2026-11-16'),
                open: 10,
                high: 12,
                low: 9,
                close: 11,
                volume: 5,
                sessions: 1,
            },
        ]);
        const two: Bar[] = [
            ...one,
            {
                time: day('2026-11-19'),
                open: 11,
                high: 15,
                low: 8,
                close: 14,
                volume: 7,
            },
        ];
        expect(aggregateWeeks(two)[0]).toMatchObject({
            open: 10,
            high: 15,
            low: 8,
            close: 14,
            volume: 12,
            sessions: 2,
        });
    });

    it('buckets a crypto seven-day week from Monday to Sunday', () => {
        const crypto: Bar[] = Array.from({ length: 8 }, (_, i) => ({
            time: day('2026-11-16') + i * 86_400,
            open: 1,
            high: 2,
            low: 1,
            close: 1.5,
            volume: 1,
        }));
        expect(aggregateWeeks(crypto).map(w => w.sessions)).toEqual([7, 1]);
    });

    it('skips bars without usable prices', () => {
        const dirty: Bar[] = [
            {
                time: day('2026-11-16'),
                open: 0,
                high: 2,
                low: 1,
                close: 1,
                volume: 1,
            },
            {
                time: day('2026-11-17'),
                open: 1,
                high: 2,
                low: 1,
                close: Number.NaN,
                volume: 1,
            },
            {
                time: day('2026-11-18'),
                open: 1,
                high: 2,
                low: 1,
                close: 1,
                volume: 1,
            },
        ];
        expect(usableBars(dirty)).toHaveLength(1);
        expect(aggregateWeeks(dirty)[0].sessions).toBe(1);
    });
});

describe('windows', () => {
    it('cuts from the UTC date `days` before asOf (inclusive) to asOf (inclusive)', () => {
        const asOf = '2023-06-01';
        const w = windowBars(bars, asOf, 30);
        expect(w[w.length - 1].time).toBe(day(asOf));
        // 2023-05-02 is exactly 30 days before and a trading day: inclusive
        expect(w[0].time).toBe(day('2023-05-02'));
        expect(windowBars(bars, asOf, 29)[0].time).toBeGreaterThan(
            day('2023-05-02')
        );
    });
});

describe('trend, RSI and averages', () => {
    it('gives the shipped trend on the same bars (label, slope and endpoints)', () => {
        [250, 400, 599].forEach(end => {
            const window = bars.slice(Math.max(0, end - 500), end + 1);
            const core = computeAnalysisTrend(
                window,
                calculateIndicators(window)
            );
            const own = trendOf(window);
            expect(own?.trend).toBe(core?.trend);
            expect(own?.slopeAtr).toBe(core?.slopeAtr);
            expect(own?.emaLast).toBeCloseTo(core?.emaLast ?? NaN, 9);
            expect(own?.emaFrom).toBeCloseTo(core?.emaFrom ?? NaN, 9);
        });
    });

    it('is not measurable under 40 bars or without a positive ATR', () => {
        expect(trendOf(bars.slice(0, 39))).toBeNull();
        expect(trendOf(bars.slice(0, 40))).not.toBeNull();
        const flat = bars
            .slice(0, 60)
            .map(b => ({ ...b, open: 5, high: 5, low: 5, close: 5 }));
        expect(trendOf(flat)).toBeNull();
    });

    it('computes the Wilder RSI the shipped indicator computes', () => {
        const closes = bars.map(b => b.close);
        const core = calculateRSI(closes).at(-1);
        expect(rsiLast(closes, 14)).toBeCloseTo(core ?? NaN, 9);
        expect(rsiLast(closes.slice(0, 14), 14)).toBeNull();
        expect(
            rsiLast([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 14)
        ).toBe(100);
        expect(
            rsiLast(
                Array.from({ length: 20 }, () => 3),
                14
            )
        ).toBeNull();
    });

    it('averages the last N values and is null under N', () => {
        expect(smaLast([1, 2, 3, 4], 2)).toBe(3.5);
        expect(smaLast([1], 2)).toBeNull();
    });
});

describe('alignment', () => {
    it('is aligned, opposed, mixed or null', () => {
        expect(alignmentOf('bullish', 'bullish')).toBe('aligned');
        expect(alignmentOf('bearish', 'bearish')).toBe('aligned');
        expect(alignmentOf('bullish', 'bearish')).toBe('opposed');
        expect(alignmentOf('bearish', 'bullish')).toBe('opposed');
        expect(alignmentOf('neutral', 'neutral')).toBe('mixed');
        expect(alignmentOf('bullish', 'neutral')).toBe('mixed');
        expect(alignmentOf(null, 'bullish')).toBeNull();
        expect(alignmentOf('bullish', null)).toBeNull();
    });
});

describe('the unfinished period', () => {
    const asOf = '2022-06-08'; // a Wednesday
    it('says in progress with the sessions so far and in total when a later session of the week is stored', () => {
        expect(periodProgress(bars, asOf, isoWeekStart)).toEqual({
            inProgress: true,
            sessionsSoFar: 3,
            sessionsTotal: 5,
            totalKnown: true,
        });
    });

    it('says finished on the last session of the week and counts the holiday week by what traded', () => {
        expect(periodProgress(bars, '2022-06-10', isoWeekStart)).toEqual({
            inProgress: false,
            sessionsSoFar: 5,
            sessionsTotal: 5,
            totalKnown: true,
        });
        expect(periodProgress(bars, '2022-11-23', isoWeekStart)).toMatchObject({
            inProgress: true,
            sessionsSoFar: 3,
            sessionsTotal: 4,
        });
    });

    it('is not computable when asOf is the last stored bar', () => {
        const last = new Date(bars[bars.length - 1].time * 1000)
            .toISOString()
            .slice(0, 10);
        expect(periodProgress(bars, last, isoWeekStart)).toBeNull();
    });

    it('works on months', () => {
        expect(periodProgress(bars, '2022-06-08', monthStart)?.inProgress).toBe(
            true
        );
        expect(periodProgress(bars, '2022-06-30', monthStart)?.inProgress).toBe(
            false
        );
    });
});

describe('higherReading', () => {
    const asOf = '2023-03-01';
    const long = windowBars(bars, asOf, HTF_EVAL_CONSTANTS.longWindowDays);
    const daily = windowBars(bars, asOf, HTF_EVAL_CONSTANTS.dailyWindowDays);

    it('reads trend, RSI, distance from the 50-bar average, bar count and alignment', () => {
        const weeks = aggregateWeeks(long);
        const reading = higherReading({
            kind: 'weekly',
            analysisBars: daily,
            higherBars: weeks,
            progress: periodProgress(bars, asOf, isoWeekStart),
        });
        expect(reading.bars).toBe(weeks.length);
        expect(reading.trend?.trend).toBe(trendOf(weeks)?.trend);
        expect(reading.rsi14).toBe(
            rsiLast(
                weeks.map(w => w.close),
                14
            )
        );
        const ma = smaLast(
            weeks.map(w => w.close),
            50
        );
        expect(reading.closeVsMa50Pct).toBeCloseTo(
            (((weeks.at(-1)?.close ?? 0) - (ma ?? 0)) / (ma ?? 1)) * 100,
            9
        );
        expect(reading.alignment).toBe(
            alignmentOf(
                trendOf(daily)?.trend ?? null,
                reading.trend?.trend ?? null
            )
        );
    });

    it('has null figures when the higher series is too short', () => {
        const reading = higherReading({
            kind: 'monthly',
            analysisBars: daily,
            higherBars: aggregateMonths(long).slice(0, 10),
            progress: null,
        });
        expect(reading.trend).toBeNull();
        expect(reading.closeVsMa50Pct).toBeNull();
        expect(reading.alignment).toBeNull();
    });
});

describe('backdropReading', () => {
    const bench = tradingBars({
        symbol: 'SPY',
        startIso: '2022-01-03',
        count: 600,
        close: i => 400 + 2 * i,
    });
    const symbolDaily = bars.slice(0, 400);
    const benchmarkDaily = bench.slice(0, 400);

    it('reads the benchmark trend and 200-day distance and both changes to the latest common date', () => {
        const r = backdropReading({ symbolDaily, benchmarkDaily });
        expect(r.trend?.trend).toBe('bullish');
        const last = benchmarkDaily.at(-1)?.close ?? 0;
        const ma =
            smaLast(
                benchmarkDaily.map(b => b.close),
                200
            ) ?? 1;
        expect(r.closeVsMa200Pct).toBeCloseTo(((last - ma) / ma) * 100, 9);
        expect(r.relative.map(x => x.sessions)).toEqual([20, 60]);
        expect(r.relative[0].benchmarkPct).toBeCloseTo(
            (last / (benchmarkDaily.at(-21)?.close ?? 1) - 1) * 100,
            9
        );
        expect(r.endDate).toBe(
            new Date((benchmarkDaily.at(-1)?.time ?? 0) * 1000)
                .toISOString()
                .slice(0, 10)
        );
    });

    it('ends both series on the latest date they share when one runs ahead', () => {
        const r = backdropReading({
            symbolDaily: symbolDaily.slice(0, -3),
            benchmarkDaily,
        });
        expect(r.endDate).toBe(
            new Date((symbolDaily.at(-4)?.time ?? 0) * 1000)
                .toISOString()
                .slice(0, 10)
        );
        expect(r.relative[0].benchmarkPct).toBeCloseTo(
            ((benchmarkDaily.at(-4)?.close ?? 1) /
                (benchmarkDaily.at(-24)?.close ?? 1) -
                1) *
                100,
            9
        );
    });

    it('is null where history is short and where the series share no date', () => {
        const short = backdropReading({
            symbolDaily: symbolDaily.slice(0, 30),
            benchmarkDaily: benchmarkDaily.slice(0, 30),
        });
        expect(short.trend).toBeNull();
        expect(short.closeVsMa200Pct).toBeNull();
        expect(short.relative[1].symbolPct).toBeNull();
        const none = backdropReading({ symbolDaily: [], benchmarkDaily });
        expect(none.endDate).toBeNull();
        expect(none.relative[0].symbolPct).toBeNull();
    });
});

describe('printed precision', () => {
    it('counts decimals and compares within half a unit of the printed digit', () => {
        expect(decimalsOf('12.40')).toBe(2);
        expect(decimalsOf('1,234')).toBe(0);
        expect(matchesPrinted('12.40', 12.404)).toBe(true);
        expect(matchesPrinted('12.40', 12.41)).toBe(false);
        expect(matchesPrinted('-0.5', -0.45)).toBe(true);
        expect(matchesPrinted('1,234', 1234.4)).toBe(true);
        expect(matchesPrinted('x', 1)).toBe(false);
        expect(matchesPrinted('1.0', null)).toBe(false);
        // a price within half a unit of the printed digit, nothing wider
        expect(matchesPrinted('70,000', 70_000.4)).toBe(true);
        expect(matchesPrinted('70,000', 70_040)).toBe(false);
    });

    it('has a Korean tick that grows with the price, and rounds half up to it', () => {
        expect(
            [1_000, 3_000, 10_000, 30_000, 100_000, 300_000, 700_000].map(
                krxTick
            )
        ).toEqual([1, 5, 10, 50, 100, 500, 1_000]);
        expect(roundToKrxTick(70_040)).toBe(70_000);
        expect(roundToKrxTick(70_050)).toBe(70_100);
        expect(roundToKrxTick(205_325)).toBe(205_500);
        expect(roundToKrxTick(1_234.4)).toBe(1_234);
    });
});

/** mulberry32, so every series below is the same on every run. */
const seeded = (seed: number): (() => number) => {
    const state = { a: seed >>> 0 };
    return () => {
        state.a = (state.a + 0x6d2b79f5) >>> 0;
        const t1 = Math.imul(state.a ^ (state.a >>> 15), 1 | state.a);
        const t2 = (t1 + Math.imul(t1 ^ (t1 >>> 7), 61 | t1)) ^ t1;
        return ((t2 ^ (t2 >>> 14)) >>> 0) / 4294967296;
    };
};

/** A random walk with a drift, stamped on the trading calendar. */
function walk(seed: number, drift: number, volatility: number): Bar[] {
    const rand = seeded(seed);
    const shape = tradingBars({
        symbol: 'NVDA',
        startIso: '2018-01-02',
        count: 1_100,
    });
    const closes = shape.reduce<number[]>(
        (acc, _, i) =>
            i === 0
                ? [200]
                : [
                      ...acc,
                      acc[i - 1] * (1 + drift + volatility * (rand() - 0.5)),
                  ],
        []
    );
    return shape.map((bar, i) => {
        const open = i === 0 ? closes[0] : closes[i - 1];
        const spread = 1 + 0.004 + 0.01 * rand();
        return {
            time: bar.time,
            open,
            high: Math.max(open, closes[i]) * spread,
            low: Math.min(open, closes[i]) / spread,
            close: closes[i],
            volume: Math.round(1_000 + 9_000 * rand()),
        };
    });
}

describe('against the shipped functions on seeded series', () => {
    const series = [
        walk(1, 0.0015, 0.02),
        walk(2, -0.0015, 0.02),
        walk(3, 0, 0.03),
        walk(4, 0.0008, 0.05),
        walk(5, -0.0006, 0.01),
    ];

    it('gives the same trend label, slope, EMA endpoints and RSI on every 25th window, all three labels seen', () => {
        const seen = new Set<string>();
        series.forEach(all => {
            Array.from(
                { length: Math.floor((all.length - 400) / 25) },
                (_, k) => 400 + k * 25
            ).forEach(end => {
                const window = all.slice(end - 400, end + 1);
                const core = computeAnalysisTrend(
                    window,
                    calculateIndicators(window)
                );
                const own = trendOf(window);
                expect(own?.trend).toBe(core?.trend);
                expect(own?.slopeAtr).toBe(core?.slopeAtr);
                expect(own?.emaLast).toBeCloseTo(core?.emaLast ?? NaN, 8);
                expect(own?.emaFrom).toBeCloseTo(core?.emaFrom ?? NaN, 8);
                const closes = window.map(b => b.close);
                expect(rsiLast(closes, 14)).toBeCloseTo(
                    calculateRSI(closes).at(-1) ?? NaN,
                    8
                );
                seen.add(own?.trend ?? 'null');
            });
        });
        expect([...seen].toSorted()).toEqual(['bearish', 'bullish', 'neutral']);
    });

    it('aggregates to the same weekly and monthly bars, open, high, low, close and volume', () => {
        series.forEach(all => {
            expect(
                aggregateWeeks(all).map(({ sessions: _s, ...bar }) => bar)
            ).toEqual(aggregateBarsToWeekly(all));
            expect(
                aggregateMonths(all).map(({ sessions: _s, ...bar }) => bar)
            ).toEqual(aggregateBarsToMonthly(all));
        });
    });
});

describe('coreTimeframe', () => {
    it('passes a timeframe core lists and refuses one it does not', () => {
        expect(coreTimeframe('1Day')).toBe('1Day');
        // `1Week` is refused until core lists it (WP-19 core-1); then this holds the other way
        expect(() => coreTimeframe('1Week')).toThrow(/known:/);
    });
});
