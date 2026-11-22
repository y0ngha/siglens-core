import { describe, expect, it } from 'vitest';
import { aggregateBarsToWeekly } from '@/domain/analysis/aggregateBarsToWeekly';
import { computeAnalysisTrend } from '@/domain/analysis/analysisTrend';
import { lastOf } from '@/domain/analysis/analysisUtils';
import {
    BACKDROP_SESSIONS,
    HIGHER_TIMEFRAME_MA_PERIOD,
    computeHigherTimeframe,
    computeMarketBackdrop,
    dailyHistoryOf,
    higherTimeframeSeriesOf,
    type HigherTimeframeSeries,
} from '@/domain/analysis/higherTimeframe';
import { calculateIndicators } from '@/domain/indicators';
import { CRYPTO_SESSION, US_EQUITY_SESSION } from '@/domain/session';
import type { Bar, BarsData, MarketSessionSpec, Trend } from '@/domain/types';

const DAY_SEC = 86_400;
const MONDAY_2024 = Date.UTC(2024, 0, 1) / 1000;

/** `count` weekday daily bars (Monday to Friday, UTC midnight) from 2024-01-01, closes from `closeAt(i)`. */
function weekdayBars(
    count: number,
    closeAt: (i: number) => number,
    start = MONDAY_2024
): Bar[] {
    return Array.from({ length: count * 2 }, (_, d) => start + d * DAY_SEC)
        .filter(time => {
            const day = new Date(time * 1000).getUTCDay();
            return day !== 0 && day !== 6;
        })
        .slice(0, count)
        .map((time, i) => {
            const close = closeAt(i);
            return {
                time,
                open: close - 0.5,
                high: close + 1,
                low: close - 1,
                close,
                volume: 1000 + i,
            };
        });
}

const rising = (i: number): number => 100 + i * 0.4 + 2 * Math.sin(i / 3);
const falling = (i: number): number => 600 - i * 0.4 + 2 * Math.sin(i / 3);
const sideways = (i: number): number => 100 + Math.sin(i / 2);

function dataOf(bars: Bar[], fearGreedBars?: Bar[]): BarsData {
    return {
        bars,
        indicators: calculateIndicators(bars),
        ...(fearGreedBars === undefined ? {} : { fearGreedBars }),
    };
}

/** The series of `timeframe` from the daily history `long`, or a thrown error naming the missing fixture. */
function seriesOf(
    timeframe: '1Hour' | '1Day' | '1Week',
    long: Bar[]
): HigherTimeframeSeries {
    const data =
        timeframe === '1Week'
            ? dataOf(aggregateBarsToWeekly(long), long)
            : dataOf(long.slice(-500), long);
    const series = higherTimeframeSeriesOf(timeframe, data);
    if (series === null) throw new Error(`no ${timeframe} series in fixture`);
    return series;
}

/** The ISO weeks of `bars`, counted the plain way: one per distinct Monday. */
const distinctWeeks = (bars: readonly Bar[]): number =>
    new Set(
        bars.map(bar => {
            const day = new Date(bar.time * 1000).getUTCDay();
            return bar.time - (day === 0 ? 6 : day - 1) * DAY_SEC;
        })
    ).size;

const distinctMonths = (bars: readonly Bar[]): number =>
    new Set(
        bars.map(bar => new Date(bar.time * 1000).toISOString().slice(0, 7))
    ).size;

const upTo = (bars: readonly Bar[], isoDate: string): Bar[] =>
    bars.filter(bar => bar.time <= Date.parse(`${isoDate}T00:00:00Z`) / 1000);

describe('dailyHistoryOf', () => {
    const daily = weekdayBars(30, rising);
    const long = weekdayBars(60, rising);

    it('prefers the long history', () => {
        expect(dailyHistoryOf('1Day', dataOf(daily, long))).toBe(long);
        expect(dailyHistoryOf('1Week', dataOf(daily, long))).toBe(long);
    });

    it('falls back to the standard bars when there is no long history', () => {
        expect(dailyHistoryOf('1Hour', dataOf(daily))).toBe(daily);
        expect(dailyHistoryOf('1Day', dataOf(daily, []))).toBe(daily);
    });

    it('never reads the weekly bars of a 1Week request as daily ones', () => {
        expect(dailyHistoryOf('1Week', dataOf(daily))).toEqual([]);
        expect(dailyHistoryOf('1Week', dataOf(daily, []))).toEqual([]);
    });
});

describe('higherTimeframeSeriesOf', () => {
    const long = weekdayBars(1300, rising);

    it('gives an intraday chart the daily bars and indicators as fetched', () => {
        const standard = long.slice(-500);
        const daily = dataOf(standard, long);
        const series = higherTimeframeSeriesOf('1Hour', daily);
        expect(series?.kind).toBe('daily');
        expect(series?.bars).toBe(standard);
        expect(series?.indicators).toBe(daily.indicators);
        expect(series?.dailyBars).toBe(long);
    });

    it('builds ISO weeks from the long history for a daily chart, with indicators on those weeks', () => {
        const series = seriesOf('1Day', long);
        expect(series.kind).toBe('weekly');
        expect(series.bars).toHaveLength(distinctWeeks(long));
        expect(series.bars).toEqual(aggregateBarsToWeekly(long));
        expect(series.indicators.ema[20]).toHaveLength(series.bars.length);
        expect(series.dailyBars).toBe(long);
    });

    it('builds UTC months from the same history for a weekly chart', () => {
        const series = seriesOf('1Week', long);
        expect(series.kind).toBe('monthly');
        expect(series.bars).toHaveLength(distinctMonths(long));
        expect(series.dailyBars).toBe(long);
    });

    it('has no higher timeframe without the daily history: a weekly request without its daily source, an empty series', () => {
        expect(
            higherTimeframeSeriesOf(
                '1Week',
                dataOf(aggregateBarsToWeekly(long))
            )
        ).toBeNull();
        expect(higherTimeframeSeriesOf('1Hour', dataOf([]))).toBeNull();
        expect(higherTimeframeSeriesOf('1Day', dataOf([], []))).toBeNull();
    });
});

describe('computeHigherTimeframe', () => {
    const long = weekdayBars(1300, rising);
    const weekly = seriesOf('1Day', long);

    it('applies the analysis trend rule to the higher-timeframe bars', () => {
        const { reading, trend } = computeHigherTimeframe({
            series: weekly,
            analysisTrend: 'bullish',
        });
        const own = computeAnalysisTrend(weekly.bars, weekly.indicators);
        expect(own).not.toBeNull();
        expect(trend).toEqual(own);
        expect(reading.kind).toBe('weekly');
        expect(reading.trend).toBe('bullish');
        expect(reading.slopeAtr).toBe(own?.slopeAtr);
        expect(reading.bars).toBe(weekly.bars.length);
    });

    it('rounds RSI(14) to one decimal from the last indicator value', () => {
        const { reading } = computeHigherTimeframe({
            series: weekly,
            analysisTrend: null,
        });
        const rsi = lastOf(weekly.indicators.rsi);
        expect(rsi).not.toBeNull();
        expect(reading.rsi14).toBe(Math.round((rsi ?? 0) * 10) / 10);
    });

    it('measures the close against the plain 50-bar average, one decimal', () => {
        const { reading } = computeHigherTimeframe({
            series: weekly,
            analysisTrend: null,
        });
        const closes = weekly.bars
            .slice(-HIGHER_TIMEFRAME_MA_PERIOD)
            .map(bar => bar.close);
        const average = closes.reduce((a, b) => a + b, 0) / closes.length;
        const last = closes[closes.length - 1];
        expect(reading.closeVsMa50Pct).toBe(
            Math.round(((last - average) / average) * 1000) / 10
        );
    });

    describe('alignment', () => {
        const alignmentWith = (
            series: HigherTimeframeSeries,
            analysisTrend: Trend | null
        ) =>
            computeHigherTimeframe({ series, analysisTrend }).reading.alignment;

        it('both bullish is aligned', () => {
            expect(alignmentWith(weekly, 'bullish')).toBe('aligned');
        });

        it('a bullish higher timeframe against a bearish chart is opposed', () => {
            expect(alignmentWith(weekly, 'bearish')).toBe('opposed');
        });

        it('a neutral chart against a bullish higher timeframe is mixed', () => {
            expect(alignmentWith(weekly, 'neutral')).toBe('mixed');
        });

        it('an unmeasurable chart trend leaves it null', () => {
            expect(alignmentWith(weekly, null)).toBeNull();
        });

        it('both bearish is aligned, and a bearish higher timeframe against a bullish chart is opposed', () => {
            const down = seriesOf('1Day', weekdayBars(1300, falling));
            expect(
                computeHigherTimeframe({ series: down, analysisTrend: null })
                    .reading.trend
            ).toBe('bearish');
            expect(alignmentWith(down, 'bearish')).toBe('aligned');
            expect(alignmentWith(down, 'bullish')).toBe('opposed');
        });

        it('two neutral trends are mixed, not aligned', () => {
            expect(
                alignmentWith(
                    seriesOf('1Day', weekdayBars(1300, sideways)),
                    'neutral'
                )
            ).toBe('mixed');
        });

        it('a neutral higher timeframe is mixed with a bullish chart', () => {
            const flatSeries = seriesOf('1Day', weekdayBars(1300, sideways));
            expect(
                computeHigherTimeframe({
                    series: flatSeries,
                    analysisTrend: 'bullish',
                }).reading.trend
            ).toBe('neutral');
            expect(alignmentWith(flatSeries, 'bullish')).toBe('mixed');
        });
    });

    describe('too little history', () => {
        const short = seriesOf('1Day', weekdayBars(150, rising));

        it('is not measurable, never neutral, and has no alignment', () => {
            const { reading, trend } = computeHigherTimeframe({
                series: short,
                analysisTrend: 'bullish',
            });
            expect(short.bars.length).toBeLessThan(40);
            expect(trend).toBeNull();
            expect(reading.trend).toBeNull();
            expect(reading.slopeAtr).toBeNull();
            expect(reading.alignment).toBeNull();
            expect(reading.bars).toBe(short.bars.length);
        });

        it('has no distance from the 50-bar average under 50 bars', () => {
            expect(short.bars.length).toBeLessThan(HIGHER_TIMEFRAME_MA_PERIOD);
            expect(
                computeHigherTimeframe({ series: short, analysisTrend: null })
                    .reading.closeVsMa50Pct
            ).toBeNull();
        });
    });

    describe('the forming last bar', () => {
        // 2026-10-07 is a Wednesday: the 5th trading day of October 2026 and the 3rd of its week.
        const history = upTo(long, '2026-10-07');
        const wednesdayMidSession = new Date('2026-10-07T15:00:00Z');
        const wednesdayAfterClose = new Date('2026-10-07T22:00:00Z');
        const thursdayAfterClose = new Date('2026-10-08T22:00:00Z');
        const fridayAfterClose = new Date('2026-10-09T22:00:00Z');
        const usClock = (now: Date) => ({ session: US_EQUITY_SESSION, now });
        const weekdayOnly: MarketSessionSpec = {
            kind: 'scheduled',
            timeZone: 'America/New_York',
            openMinute: 9 * 60 + 30,
            closeMinute: 16 * 60,
            weekendDays: [0, 6],
        };

        it('is unknown without a clock: not in progress and no sessions claimed', () => {
            const out = computeHigherTimeframe({
                series: seriesOf('1Day', history),
                analysisTrend: null,
            });
            expect(out.reading.lastBarInProgress).toBe(false);
            expect(out.progress).toBeNull();
        });

        it('counts observed sessions against the calendar total while the week is open', () => {
            const out = computeHigherTimeframe({
                series: seriesOf('1Day', history),
                analysisTrend: null,
                clock: usClock(wednesdayAfterClose),
            });
            expect(out.reading.lastBarInProgress).toBe(true);
            expect(out.progress).toEqual({
                sessionsSoFar: 3,
                sessionsTotal: 5,
            });
        });

        it('states no total when the session has no holiday data', () => {
            const out = computeHigherTimeframe({
                series: seriesOf('1Day', history),
                analysisTrend: null,
                clock: { session: weekdayOnly, now: wednesdayAfterClose },
            });
            expect(out.progress).toEqual({
                sessionsSoFar: 3,
                sessionsTotal: null,
            });
        });

        it('is finished once the market is closed for the week', () => {
            const out = computeHigherTimeframe({
                series: seriesOf('1Day', upTo(long, '2026-10-09')),
                analysisTrend: null,
                clock: usClock(fridayAfterClose),
            });
            expect(out.reading.lastBarInProgress).toBe(false);
            expect(out.progress).toBeNull();
        });

        it('a month in progress reports the sessions so far and the calendar total', () => {
            const out = computeHigherTimeframe({
                series: seriesOf('1Week', history),
                analysisTrend: null,
                clock: usClock(wednesdayAfterClose),
            });
            expect(out.reading.kind).toBe('monthly');
            expect(out.reading.lastBarInProgress).toBe(true);
            // 1, 2, 5, 6 and 7 October of 22 weekdays; Columbus Day is not an exchange holiday.
            expect(out.progress).toEqual({
                sessionsSoFar: 5,
                sessionsTotal: 22,
            });
        });

        it('a finished month has no progress', () => {
            const out = computeHigherTimeframe({
                series: seriesOf('1Week', upTo(long, '2026-09-30')),
                analysisTrend: null,
                clock: usClock(wednesdayAfterClose),
            });
            expect(out.reading.lastBarInProgress).toBe(false);
            expect(out.progress).toBeNull();
        });

        describe('daily', () => {
            const daily = seriesOf('1Hour', history);
            const readAt = (
                clock: Parameters<typeof computeHigherTimeframe>[0]['clock']
            ) =>
                computeHigherTimeframe({
                    series: daily,
                    analysisTrend: null,
                    clock,
                }).reading.lastBarInProgress;

            it('is forming while its session is open', () => {
                expect(readAt(usClock(wednesdayMidSession))).toBe(true);
            });

            it('is finished at the close and on a later day', () => {
                expect(readAt(usClock(wednesdayAfterClose))).toBe(false);
                expect(readAt(usClock(thursdayAfterClose))).toBe(false);
            });

            it('is unknown without a clock', () => {
                expect(readAt(undefined)).toBe(false);
            });

            it('a 24/7 market is forming through its UTC day and finished the next one', () => {
                expect(
                    readAt({
                        session: CRYPTO_SESSION,
                        now: new Date('2026-10-07T10:00:00Z'),
                    })
                ).toBe(true);
                expect(
                    readAt({
                        session: CRYPTO_SESSION,
                        now: new Date('2026-10-08T00:00:00Z'),
                    })
                ).toBe(false);
            });

            it('never reports session counts', () => {
                expect(
                    computeHigherTimeframe({
                        series: daily,
                        analysisTrend: null,
                        clock: usClock(wednesdayMidSession),
                    }).progress
                ).toBeNull();
            });
        });
    });
});

describe('computeMarketBackdrop', () => {
    const symbolDaily = weekdayBars(100, i => 100 + i);
    const benchmarkBars = weekdayBars(100, i => 200 + i);
    const benchmarkOf = (bars: Bar[]) => ({
        bars,
        indicators: calculateIndicators(bars),
    });
    const label = 'S&P 500 (SPY)';

    it('compares the symbol with the benchmark over 20 and 60 sessions to the shared last date', () => {
        const reading = computeMarketBackdrop({
            label,
            symbolDaily,
            benchmark: benchmarkOf(benchmarkBars),
        });
        expect(reading.label).toBe(label);
        expect(reading.endDate).toBe('2024-05-17');
        expect(reading.relative).toEqual([
            { sessions: 20, symbolPct: 11.2, benchmarkPct: 7.2 },
            { sessions: 60, symbolPct: 43.2, benchmarkPct: 25.1 },
        ]);
        expect(reading.relative.map(r => r.sessions)).toEqual([
            ...BACKDROP_SESSIONS,
        ]);
    });

    it('ends both windows on the latest date they share, not on the benchmark newest bar', () => {
        const ahead = weekdayBars(101, i => 200 + i);
        const reading = computeMarketBackdrop({
            label,
            symbolDaily,
            benchmark: benchmarkOf(ahead),
        });
        expect(reading.endDate).toBe('2024-05-17');
        expect(reading.relative[0].benchmarkPct).toBe(7.2);
    });

    it('leaves a window null when a series has too little history for it', () => {
        const reading = computeMarketBackdrop({
            label,
            symbolDaily: symbolDaily.slice(-30),
            benchmark: benchmarkOf(benchmarkBars),
        });
        expect(reading.relative[0].symbolPct).toBe(11.2);
        expect(reading.relative[1].symbolPct).toBeNull();
        expect(reading.relative[1].benchmarkPct).toBe(25.1);
    });

    it('has no end date and no changes when the series share no session', () => {
        const apart = weekdayBars(
            100,
            i => 100 + i,
            MONDAY_2024 + 365 * DAY_SEC
        );
        const reading = computeMarketBackdrop({
            label,
            symbolDaily: apart,
            benchmark: benchmarkOf(benchmarkBars),
        });
        expect(reading.endDate).toBeNull();
        expect(reading.relative).toEqual([
            { sessions: 20, symbolPct: null, benchmarkPct: null },
            { sessions: 60, symbolPct: null, benchmarkPct: null },
        ]);
    });

    it("reads the benchmark's own trend by the chart-trend rule and says not measurable under 40 bars", () => {
        const up = weekdayBars(300, rising);
        const measurable = computeMarketBackdrop({
            label,
            symbolDaily,
            benchmark: benchmarkOf(up),
        });
        expect(measurable.trend).toBe('bullish');
        const tooShort = computeMarketBackdrop({
            label,
            symbolDaily,
            benchmark: benchmarkOf(up.slice(0, 30)),
        });
        expect(tooShort.trend).toBeNull();
    });

    it('measures the benchmark close against its 200-day average to one decimal, null under 200 bars', () => {
        // 249 closes of 100 and a last close of 120: SMA200 = (199 * 100 + 120) / 200 = 100.1.
        const spike = weekdayBars(250, i => (i === 249 ? 120 : 100));
        expect(
            computeMarketBackdrop({
                label,
                symbolDaily,
                benchmark: benchmarkOf(spike),
            }).closeVsMa200Pct
        ).toBe(19.9);
        expect(
            computeMarketBackdrop({
                label,
                symbolDaily,
                benchmark: benchmarkOf(spike.slice(-199)),
            }).closeVsMa200Pct
        ).toBeNull();
    });

    it('prints a negative change with its sign preserved at one decimal', () => {
        const reading = computeMarketBackdrop({
            label,
            symbolDaily: weekdayBars(100, i => 200 - i),
            benchmark: benchmarkOf(benchmarkBars),
        });
        // 101 / 121 - 1 over 20 sessions = -16.5%.
        expect(reading.relative[0].symbolPct).toBe(-16.5);
    });
});
