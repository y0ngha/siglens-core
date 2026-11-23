import { describe, expect, it } from 'vitest';
import { aggregateBarsToWeekly } from '@/domain/analysis/aggregateBarsToWeekly';
import {
    computeHigherTimeframe,
    computeMarketBackdrop,
    higherTimeframeSeriesOf,
    type HigherContextInput,
    type HigherTimeframeComputation,
} from '@/domain/analysis/higherTimeframe';
import {
    formatHigherTimeframeBlock,
    formatMarketBackdropBlock,
} from '@/domain/analysis/higherTimeframeSection';
import {
    METRICS_INTRO,
    METRICS_INTRO_WITH_CONTEXT_BLOCKS,
} from '@/domain/analysis/confluenceSection';
import { buildAnalysisPrompt } from '@/domain/analysis/prompt';
import { calculateIndicators } from '@/domain/indicators';
import { US_EQUITY_SESSION } from '@/domain/session';
import type {
    Bar,
    BarsData,
    HigherTimeframeKind,
    HigherTimeframeReading,
    MarketBackdropReading,
    Timeframe,
} from '@/domain/types';

const QUOTING = { dp: 2, krxTick: null } as const;

const reading = (
    over: Partial<HigherTimeframeReading> = {}
): HigherTimeframeReading => ({
    kind: 'weekly',
    trend: 'bullish',
    slopeAtr: 1.62,
    rsi14: 61.2,
    closeVsMa50Pct: 12.4,
    lastBarInProgress: false,
    bars: 260,
    alignment: 'aligned',
    ...over,
});

const computation = (
    over: Partial<HigherTimeframeReading> = {},
    extra: Partial<HigherTimeframeComputation> = {}
): HigherTimeframeComputation => ({
    reading: reading(over),
    trend: {
        trend: 'bullish',
        slopeAtr: 1.62,
        emaFrom: 212.4,
        emaLast: 228.1,
        close: 231.55,
    },
    progress: null,
    ...extra,
});

const NO_EDGE =
    "on a pooled SIGLENS sample of U.S. and Korean stocks and ETFs, days when the daily and weekly trends agreed showed no measured edge in the next 10 sessions' return.";

describe('formatHigherTimeframeBlock', () => {
    it('prints the weekly block of a daily chart in the registered form', () => {
        const lines = formatHigherTimeframeBlock(
            computation(
                { lastBarInProgress: true },
                { progress: { sessionsSoFar: 3, sessionsTotal: 5 } }
            ),
            'bullish',
            QUOTING,
            true
        );
        expect(lines).toEqual([
            '### Higher Timeframe (computed, weekly bars built from daily history)',
            'Weekly trend: bullish. EMA20 moved +1.62 ATR(14) over the last 20 weekly bars (from 212.40 to 228.10) and the weekly close 231.55 is above EMA20.',
            'Weekly RSI(14) 61.2; weekly close 12.4% above its 50-week average.',
            'The last weekly bar is the current week (3 of 5 sessions so far).',
            "Alignment with this chart's trend (bullish): aligned.",
            `Descriptive only: ${NO_EDGE} Mention whether the weekly trend agrees with this chart in summary, in the response language's own words (do not print the English labels there). It does not change the top-level trend, the plan or the entry zone.`,
        ]);
    });

    it('prints no total of sessions when the calendar did not prove one', () => {
        const lines = formatHigherTimeframeBlock(
            computation(
                { lastBarInProgress: true },
                { progress: { sessionsSoFar: 3, sessionsTotal: null } }
            ),
            'bullish',
            QUOTING,
            true
        );
        expect(lines).toContain(
            'The last weekly bar is the current week (3 sessions so far).'
        );
    });

    it('says nothing about progress for a finished period or an unknown one', () => {
        const lines = formatHigherTimeframeBlock(
            computation(),
            'bullish',
            QUOTING,
            true
        );
        expect(lines.join('\n')).not.toContain('The last weekly bar');
    });

    it('prints the not-measurable form with the bars received, and never as "no trend"', () => {
        const lines = formatHigherTimeframeBlock(
            {
                reading: reading({
                    trend: null,
                    slopeAtr: null,
                    alignment: null,
                    closeVsMa50Pct: null,
                    bars: 12,
                }),
                trend: null,
                progress: null,
            },
            'bullish',
            QUOTING,
            true
        );
        expect(lines[1]).toBe(
            'Weekly trend: Not measurable: the rule needs at least 40 weekly bars (EMA20 20 bars back), a positive ATR(14) and a positive close; received 12 bars. This is an absence of measurement, not an absence of a trend.'
        );
        const text = lines.join('\n');
        expect(text).not.toContain('Alignment with');
        expect(text).not.toContain(NO_EDGE);
        expect(text).toContain('no weekly trend is computed here');
        expect(text).toContain('your own weak estimate');
    });

    it('words a close below its average and below EMA20, and drops the RSI when there is none', () => {
        const lines = formatHigherTimeframeBlock(
            computation(
                { rsi14: null, closeVsMa50Pct: -3.2, trend: 'bearish' },
                {
                    trend: {
                        trend: 'bearish',
                        slopeAtr: -1.1,
                        emaFrom: 120,
                        emaLast: 100,
                        close: 90,
                    },
                }
            ),
            'neutral',
            QUOTING,
            true
        );
        expect(lines[1]).toContain('moved -1.10 ATR(14)');
        expect(lines[1]).toContain('is below EMA20.');
        expect(lines[2]).toBe('weekly close 3.2% below its 50-week average.');
    });

    it('words a close equal to EMA20', () => {
        const lines = formatHigherTimeframeBlock(
            computation(
                {},
                {
                    trend: {
                        trend: 'neutral',
                        slopeAtr: 0.2,
                        emaFrom: 100,
                        emaLast: 100,
                        close: 100,
                    },
                }
            ),
            'bullish',
            QUOTING,
            true
        );
        expect(lines[1]).toContain('is equal to EMA20.');
    });

    it('prints no figures line when neither RSI nor the distance exists', () => {
        const lines = formatHigherTimeframeBlock(
            computation({ rsi14: null, closeVsMa50Pct: null }),
            'bullish',
            QUOTING,
            true
        );
        expect(lines.some(line => line.includes('RSI'))).toBe(false);
        expect(lines.some(line => line.includes('50-week'))).toBe(false);
    });

    it('says what mixed means, and only for mixed', () => {
        const lineOf = (alignment: 'aligned' | 'opposed' | 'mixed') =>
            formatHigherTimeframeBlock(
                computation({ alignment }),
                'neutral',
                QUOTING,
                true
            ).find(line => line.startsWith('Alignment')) ?? '';
        expect(lineOf('mixed')).toBe(
            "Alignment with this chart's trend (neutral): mixed. (at least one of the two trends is neutral)"
        );
        expect(lineOf('aligned')).toBe(
            "Alignment with this chart's trend (neutral): aligned."
        );
        expect(lineOf('opposed')).toBe(
            "Alignment with this chart's trend (neutral): opposed."
        );
    });

    it('omits the alignment when the chart trend is unmeasurable', () => {
        const lines = formatHigherTimeframeBlock(
            computation({ alignment: null }),
            null,
            QUOTING,
            true
        );
        expect(lines.some(line => line.startsWith('Alignment'))).toBe(false);
    });

    it('prints Korean prices at the quoted precision', () => {
        const lines = formatHigherTimeframeBlock(
            computation(
                {},
                {
                    trend: {
                        trend: 'bullish',
                        slopeAtr: 1.5,
                        emaFrom: 71_200,
                        emaLast: 75_400,
                        close: 76_000,
                    },
                }
            ),
            'bullish',
            { dp: 0, krxTick: 'share' },
            true
        );
        expect(lines[1]).toContain('(from 71200 to 75400)');
        expect(lines[1]).toContain('the weekly close 76000 is above EMA20.');
    });

    describe('the claim about agreement', () => {
        const claimOf = (kind: HigherTimeframeKind): string =>
            formatHigherTimeframeBlock(
                computation({ kind }),
                'bullish',
                QUOTING,
                true
            ).at(-1) ?? '';

        it('says no forward edge was measured only for the daily and weekly pairing it was measured on', () => {
            expect(claimOf('weekly')).toContain(NO_EDGE);
            expect(claimOf('daily')).not.toContain('no measured edge');
            expect(claimOf('monthly')).not.toContain('no measured edge');
        });

        it('says the weekly pairing was not measured either on a chart outside the measured set (crypto)', () => {
            const outside =
                formatHigherTimeframeBlock(
                    computation({ kind: 'weekly' }),
                    'bullish',
                    QUOTING,
                    false
                ).at(-1) ?? '';
            expect(outside).not.toContain('no measured edge');
            expect(outside).toContain(
                "the agreement between this chart's trend and the weekly trend was not measured."
            );
        });

        it('states the horizon and the market scope it was measured on', () => {
            expect(claimOf('weekly')).toContain("next 10 sessions' return");
            expect(claimOf('weekly')).toContain('a pooled SIGLENS sample');
            expect(claimOf('weekly')).toContain(
                'U.S. and Korean stocks and ETFs'
            );
        });

        it('says the other pairings were not measured', () => {
            expect(claimOf('daily')).toContain(
                "the agreement between this chart's trend and the daily trend was not measured."
            );
            expect(claimOf('monthly')).toContain(
                "the agreement between this chart's trend and the monthly trend was not measured."
            );
        });
    });

    describe('daily (an intraday chart)', () => {
        it('names the daily bars, the 50-day average and an open session', () => {
            const lines = formatHigherTimeframeBlock(
                computation({ kind: 'daily', lastBarInProgress: true }),
                'bullish',
                QUOTING,
                true
            );
            expect(lines[0]).toBe(
                '### Higher Timeframe (computed, daily bars)'
            );
            expect(lines[1]).toContain('Daily trend: bullish.');
            expect(lines[1]).toContain('over the last 20 daily bars');
            expect(lines[2]).toBe(
                'Daily RSI(14) 61.2; daily close 12.4% above its 50-day average.'
            );
            expect(lines).toContain(
                'The last daily bar is the current session, still open.'
            );
        });

        it('says nothing about the last bar once its session is over', () => {
            const lines = formatHigherTimeframeBlock(
                computation({ kind: 'daily', lastBarInProgress: false }),
                'bullish',
                QUOTING,
                true
            );
            expect(lines.join('\n')).not.toContain('still open');
        });
    });

    describe('monthly (a weekly chart)', () => {
        it('names the monthly bars, the 50-month average and the current month', () => {
            const lines = formatHigherTimeframeBlock(
                computation(
                    { kind: 'monthly', lastBarInProgress: true },
                    { progress: { sessionsSoFar: 5, sessionsTotal: 22 } }
                ),
                'bullish',
                QUOTING,
                true
            );
            expect(lines[0]).toBe(
                '### Higher Timeframe (computed, monthly bars built from daily history)'
            );
            expect(lines[1]).toContain('Monthly trend: bullish.');
            expect(lines[2]).toContain('its 50-month average');
            expect(lines).toContain(
                'The last monthly bar is the current month (5 of 22 sessions so far).'
            );
        });
    });
});

describe('formatMarketBackdropBlock', () => {
    const backdrop = (
        over: Partial<MarketBackdropReading> = {}
    ): MarketBackdropReading => ({
        label: 'S&P 500 (SPY)',
        trend: 'bullish',
        closeVsMa200Pct: 6.2,
        endDate: '2026-11-20',
        relative: [
            { sessions: 20, symbolPct: 4.1, benchmarkPct: 1.3 },
            { sessions: 60, symbolPct: 9.8, benchmarkPct: 5 },
        ],
        ...over,
    });

    it('prints the benchmark trend, its distance from the 200-day average and both windows with their end date', () => {
        expect(formatMarketBackdropBlock(backdrop(), 'AAPL')).toEqual([
            '### Market Backdrop (computed, daily bars)',
            'S&P 500 (SPY): trend bullish (same rule as the chart trend above); close 6.2% above its 200-day average.',
            'AAPL vs S&P 500 (SPY), last 20 sessions: +4.1% vs +1.3%; last 60 sessions: +9.8% vs +5.0% (both to 2026-11-20).',
            'Descriptive only: market context; quote these percentages as printed and do not infer an index price from them. It does not change the top-level trend, the plan or the entry zone.',
        ]);
    });

    it('words a close below the average and negative changes with their sign', () => {
        const lines = formatMarketBackdropBlock(
            backdrop({
                closeVsMa200Pct: -8.1,
                relative: [
                    { sessions: 20, symbolPct: -25.2, benchmarkPct: -8.8 },
                    { sessions: 60, symbolPct: -36.1, benchmarkPct: 0 },
                ],
            }),
            'SNOW'
        );
        expect(lines[1]).toContain('close 8.1% below its 200-day average');
        expect(lines[2]).toContain('last 20 sessions: -25.2% vs -8.8%');
        expect(lines[2]).toContain('last 60 sessions: -36.1% vs +0.0%');
    });

    it('says a missing trend is not measurable and drops the average clause it cannot state', () => {
        const lines = formatMarketBackdropBlock(
            backdrop({ trend: null, closeVsMa200Pct: null }),
            'AAPL'
        );
        expect(lines[1]).toBe(
            'S&P 500 (SPY): trend not measurable (too little benchmark history).'
        );
    });

    it('prints n/a for a window the history is too short for', () => {
        const lines = formatMarketBackdropBlock(
            backdrop({
                relative: [
                    { sessions: 20, symbolPct: 4.1, benchmarkPct: 1.3 },
                    { sessions: 60, symbolPct: null, benchmarkPct: 5 },
                ],
            }),
            'NEWCO'
        );
        expect(lines[2]).toContain('last 60 sessions: n/a vs +5.0%');
    });

    it('drops the relative line when the series share no session', () => {
        const lines = formatMarketBackdropBlock(
            backdrop({
                endDate: null,
                relative: [
                    { sessions: 20, symbolPct: null, benchmarkPct: null },
                    { sessions: 60, symbolPct: null, benchmarkPct: null },
                ],
            }),
            'AAPL'
        );
        expect(lines).toHaveLength(3);
        expect(lines.some(line => line.includes(' vs '))).toBe(false);
    });

    it('prints percentages and dates only: no index price enters the prompt', () => {
        const text = formatMarketBackdropBlock(backdrop(), 'AAPL').join('\n');
        const stripped = text
            .replaceAll('S&P 500 (SPY)', '')
            .replace(/\d{4}-\d{2}-\d{2}/g, '')
            .replace(/\d+-day|\d+ sessions?/g, '');
        const bare = [...stripped.matchAll(/[+-]?\d[\d,]*(?:\.\d+)?%?/g)]
            .map(m => m[0])
            .filter(token => !token.endsWith('%'));
        expect(bare).toEqual([]);
    });
});

// --- through the builder consumers call (TE-14) -----------------------------------------

const DAY_SEC = 86_400;
const MONDAY_2024 = Date.UTC(2024, 0, 1) / 1000;

function weekdayBars(count: number, closeAt: (i: number) => number): Bar[] {
    return Array.from(
        { length: count * 2 },
        (_, d) => MONDAY_2024 + d * DAY_SEC
    )
        .filter(time => {
            const day = new Date(time * 1000).getUTCDay();
            return day !== 0 && day !== 6;
        })
        .slice(0, count)
        .map((time, i) => ({
            time,
            open: closeAt(i) - 0.5,
            high: closeAt(i) + 1,
            low: closeAt(i) - 1,
            close: closeAt(i),
            volume: 1000 + i,
        }));
}

const closeAt = (i: number): number => 100 + i * 0.35 + 3 * Math.sin(i / 4);

describe('the blocks in a built prompt', () => {
    const history = weekdayBars(1300, closeAt).filter(
        bar => bar.time <= Date.parse('2026-10-07T00:00:00Z') / 1000
    );
    const standard = history.slice(-500);
    const dailyData: BarsData = {
        bars: standard,
        indicators: calculateIndicators(standard),
        fearGreedBars: history,
    };
    const clock = {
        session: US_EQUITY_SESSION,
        now: new Date('2026-10-07T22:00:00Z'),
    };

    function build(
        timeframe: Timeframe,
        bars: Bar[],
        context?: HigherContextInput
    ) {
        return buildAnalysisPrompt({
            symbol: 'AAPL',
            companyName: 'Apple Inc.',
            bars,
            indicators: calculateIndicators(bars),
            skills: [],
            timeframe,
            assetClass: 'equity',
            currency: 'USD',
            krxTick: 'share',
            marketClock: clock,
            higherContext: context,
        });
    }

    const higher = higherTimeframeSeriesOf('1Day', dailyData);
    if (higher === null) throw new Error('fixture has no weekly series');
    const benchmarkBars = weekdayBars(1300, i => 400 + i * 0.5).filter(
        bar => bar.time <= Date.parse('2026-10-07T00:00:00Z') / 1000
    );
    const benchmark = {
        bars: benchmarkBars.slice(-500),
        indicators: calculateIndicators(benchmarkBars.slice(-500)),
    };
    const context: HigherContextInput = {
        higher,
        backdrop: {
            label: 'S&P 500 (SPY)',
            symbolDaily: history,
            benchmark,
        },
    };

    /** The prompt with the two registered blocks cut: from the heading to the line before the next heading. */
    const withoutBlocks = (dynamic: string): string =>
        dynamic
            .split('\n')
            .reduce<{ lines: string[]; cutting: boolean }>(
                (acc, line) => {
                    const starts =
                        line.startsWith('### Higher Timeframe (computed') ||
                        line.startsWith('### Market Backdrop (computed');
                    const ends =
                        line.startsWith('### ') || line.startsWith('## ');
                    const cutting = starts || (acc.cutting && !ends);
                    return {
                        lines: cutting ? acc.lines : [...acc.lines, line],
                        cutting,
                    };
                },
                { lines: [], cutting: false }
            )
            .lines.join('\n')
            .replace(METRICS_INTRO_WITH_CONTEXT_BLOCKS, METRICS_INTRO);

    it('prints both blocks right after the trend block, ahead of the confluence block', () => {
        const { dynamic } = build('1Day', standard, context);
        const order = [
            '### Trend (computed)',
            '### Higher Timeframe (computed, weekly bars built from daily history)',
            '### Market Backdrop (computed, daily bars)',
            '### Indicator Agreement',
        ].map(heading => dynamic.indexOf(heading));
        expect(order.every(index => index >= 0)).toBe(true);
        expect(order).toEqual([...order].toSorted((a, b) => a - b));
    });

    it('leaves every other byte of the prompt as it was without the blocks', () => {
        const without = build('1Day', standard);
        const withBlocks = build('1Day', standard, context);
        expect(withBlocks.dynamic).not.toBe(without.dynamic);
        expect(withoutBlocks(withBlocks.dynamic)).toBe(without.dynamic);
        expect(withBlocks.stable).toBe(without.stable);
    });

    it('names the blocks that bring their own bars in the intro only when one is printed', () => {
        const without = build('1Day', standard).dynamic;
        const withBlocks = build('1Day', standard, context).dynamic;
        expect(without).toContain(METRICS_INTRO);
        expect(without).not.toContain(METRICS_INTRO_WITH_CONTEXT_BLOCKS);
        expect(withBlocks).toContain(METRICS_INTRO_WITH_CONTEXT_BLOCKS);
        expect(withBlocks).not.toContain(METRICS_INTRO);
        // Either block alone brings its own bars.
        expect(
            build('1Day', standard, { ...context, backdrop: null }).dynamic
        ).toContain(METRICS_INTRO_WITH_CONTEXT_BLOCKS);
    });

    it('a crypto chart never gets the measured claim, even for the weekly block', () => {
        const crypto = buildAnalysisPrompt({
            symbol: 'BTC-USD',
            companyName: 'Bitcoin',
            bars: standard,
            indicators: calculateIndicators(standard),
            skills: [],
            timeframe: '1Day',
            assetClass: 'crypto',
            currency: 'USD',
            krxTick: 'share',
            marketClock: clock,
            higherContext: { higher, backdrop: null },
        });
        expect(crypto.dynamic).toContain('### Higher Timeframe');
        expect(crypto.dynamic).not.toContain('no measured edge');
        expect(build('1Day', standard, context).dynamic).toContain(
            'no measured edge'
        );
    });

    it('with no context the readings are null and the prompt carries no block', () => {
        const out = build('1Day', standard);
        expect(out.higherTimeframe).toBeNull();
        expect(out.marketBackdrop).toBeNull();
        expect(out.dynamic).not.toContain('### Higher Timeframe');
        expect(out.dynamic).not.toContain('### Market Backdrop');
    });

    it('a null member prints nothing for it', () => {
        const onlyHigher = build('1Day', standard, {
            ...context,
            backdrop: null,
        });
        expect(onlyHigher.dynamic).toContain('### Higher Timeframe');
        expect(onlyHigher.dynamic).not.toContain('### Market Backdrop');
        expect(onlyHigher.marketBackdrop).toBeNull();
        const onlyBackdrop = build('1Day', standard, {
            ...context,
            higher: null,
        });
        expect(onlyBackdrop.dynamic).not.toContain('### Higher Timeframe');
        expect(onlyBackdrop.higherTimeframe).toBeNull();
        expect(onlyBackdrop.marketBackdrop?.label).toBe('S&P 500 (SPY)');
    });

    it('returns the readings it printed, from one computation', () => {
        const out = build('1Day', standard, context);
        const expected = computeHigherTimeframe({
            series: higher,
            analysisTrend: out.trend?.trend ?? null,
            clock,
        }).reading;
        expect(out.higherTimeframe).toEqual(expected);
        expect(out.marketBackdrop).toEqual(
            computeMarketBackdrop({
                label: 'S&P 500 (SPY)',
                symbolDaily: history,
                benchmark,
            })
        );
        // The printed slope is the stored one, signed at two decimals.
        const slope = out.higherTimeframe?.slopeAtr ?? NaN;
        expect(out.dynamic).toContain(
            `Weekly trend: ${out.higherTimeframe?.trend}. EMA20 moved ${slope >= 0 ? '+' : ''}${slope.toFixed(2)} ATR(14)`
        );
    });

    it("states the week in progress from the run's clock", () => {
        const out = build('1Day', standard, context);
        expect(out.higherTimeframe?.lastBarInProgress).toBe(true);
        expect(out.dynamic).toContain(
            'The last weekly bar is the current week (3 of 5 sessions so far).'
        );
    });

    describe('intraday parity', () => {
        const trendLine = (dynamic: string, label: 'Trend' | 'Daily trend') =>
            dynamic.split('\n').find(line => line.startsWith(`${label}: `)) ??
            '';

        it("an intraday chart's daily block carries the trend a daily chart's own trend block prints", () => {
            const daily = build('1Day', standard);
            const hourlyBars = weekdayBars(400, i => 100 + i * 0.1);
            const hourly = build('1Hour', hourlyBars, {
                higher: higherTimeframeSeriesOf('1Hour', dailyData),
                backdrop: null,
            });
            const dailyTrend = trendLine(daily.dynamic, 'Trend');
            const blockTrend = trendLine(hourly.dynamic, 'Daily trend');
            expect(dailyTrend).not.toBe('');
            expect(blockTrend).toBe(
                dailyTrend
                    .replace('Trend:', 'Daily trend:')
                    .replace(
                        'over the last 20 bars',
                        'over the last 20 daily bars'
                    )
                    .replace('and the close', 'and the daily close')
            );
            expect(hourly.higherTimeframe?.trend).toBe(daily.trend?.trend);
            expect(hourly.higherTimeframe?.slopeAtr).toBe(
                daily.trend?.slopeAtr
            );
        });
    });

    describe('a weekly chart', () => {
        it('reads the monthly bars of the same daily history', () => {
            const weekly = aggregateBarsToWeekly(history);
            const series = higherTimeframeSeriesOf('1Week', {
                bars: weekly,
                indicators: calculateIndicators(weekly),
                fearGreedBars: history,
            });
            const out = build('1Week', weekly, {
                higher: series,
                backdrop: null,
            });
            expect(out.higherTimeframe?.kind).toBe('monthly');
            expect(out.dynamic).toContain(
                '### Higher Timeframe (computed, monthly bars built from daily history)'
            );
            expect(out.dynamic).toContain('Monthly trend:');
        });
    });
});
