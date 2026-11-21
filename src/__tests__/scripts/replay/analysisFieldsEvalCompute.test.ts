import { describe, expect, it } from 'vitest';
import {
    allDaysStats,
    anyGateFailed,
    classifyR1,
    classifyR3,
    classifyR4,
    countBy,
    dayOf,
    emaSeries,
    firstParagraph,
    groupBy,
    intervalOf,
    locateRows,
    oppositeWordsOf,
    quantilesOf,
    roundHalfAwayFromZero,
    ruleSeries,
    rulesAtRow,
    share,
    slopeAtrAt,
    storedLabelStats,
    summarizeTrend,
    trendGates,
    trendPlumbing,
    usesOnlyOppositeWords,
    wilderAtrSeries,
} from '../../../../scripts/replay/analysisFieldsEvalCompute';
import {
    FIELDS_EVAL_CONSTANTS as C,
    type SeriesStats,
    type StoredTrendRow,
    type SymbolBars,
    type TrendLabel,
    type TrendSummary,
} from '../../../../scripts/replay/analysisFieldsEvalTypes';

const DAY = 86_400;

/** Bars from a close function: high and low one unit around the close, open the previous close. */
function barsOf(
    count: number,
    close: (i: number) => number,
    range = 1
): SymbolBars['bars'] {
    return Array.from({ length: count }, (_, i) => ({
        time: 1_600_000_000 + i * DAY,
        open: close(Math.max(0, i - 1)),
        high: close(i) + range,
        low: close(i) - range,
        close: close(i),
        volume: 1_000,
    }));
}

const symbolOf = (
    bars: SymbolBars['bars'],
    symbol = 'AAA',
    market: SymbolBars['market'] = 'us'
): SymbolBars => ({ symbol, market, bars });

/** A series of `length` values that are `null` except at `index`, for rule inputs. */
function sparse(
    length: number,
    values: Readonly<Record<number, number | null>>
): (number | null)[] {
    return Array.from({ length }, (_, i) => values[i] ?? null);
}

describe('shared helpers', () => {
    it('share is null for an empty denominator, not 0', () => {
        expect(share(0, 0)).toEqual({ count: 0, n: 0, share: null });
        expect(share(1, 4).share).toBe(0.25);
    });

    it('dayOf stamps a bar by its UTC date', () => {
        expect(dayOf(Date.parse('2026-11-20T00:00:00Z') / 1000)).toBe(
            '2026-11-20'
        );
    });

    it('rounds half away from zero on both signs', () => {
        expect(roundHalfAwayFromZero(0.125, 2)).toBe(0.13);
        expect(roundHalfAwayFromZero(-0.125, 2)).toBe(-0.13);
        expect(roundHalfAwayFromZero(0.994, 2)).toBe(0.99);
    });

    it('counts and groups by key', () => {
        expect(countBy(['a', 'b', 'a'], x => x)).toEqual({ a: 2, b: 1 });
        expect([
            ...groupBy([1, 2, 3, 4], n => (n % 2 ? 'odd' : 'even')),
        ]).toEqual([
            ['odd', [1, 3]],
            ['even', [2, 4]],
        ]);
    });

    it('quantilesOf reports n and the empty case as nulls', () => {
        expect(quantilesOf([])).toMatchObject({ n: 0, p50: null, mean: null });
        expect(quantilesOf([1, 2, 3])).toMatchObject({ n: 3, p50: 2, mean: 2 });
    });

    it('intervalOf has no bounds below two values', () => {
        expect(intervalOf([0.5])).toEqual({
            n: 1,
            mean: 0.5,
            low: null,
            high: null,
        });
        const wide = intervalOf([0, 1, 0, 1]);
        expect(wide.mean).toBe(0.5);
        expect(wide.low).toBeLessThan(0.5);
        expect(wide.high).toBeGreaterThan(0.5);
    });
});

describe('emaSeries', () => {
    it('seeds with the simple average and is null before the first full window', () => {
        const ema = emaSeries([1, 2, 3, 4, 5], 3);
        expect(ema.slice(0, 2)).toEqual([null, null]);
        expect(ema[2]).toBe(2);
        // k = 0.5: 4 * 0.5 + 2 * 0.5 = 3, then 5 * 0.5 + 3 * 0.5 = 4
        expect(ema.slice(3)).toEqual([3, 4]);
    });

    it('is all null below one window', () => {
        expect(emaSeries([1, 2], 3)).toEqual([null, null]);
    });
});

describe('wilderAtrSeries', () => {
    const bars = [
        { high: 10, low: 8, close: 9 },
        { high: 11, low: 9, close: 10 },
        { high: 13, low: 10, close: 12 },
        { high: 12, low: 11, close: 11.5 },
    ];

    it('averages the first true ranges, then smooths with Wilder weights', () => {
        // tr: 2, 3 (13-10), 1 (12-11); period 2: seed (2 + 3) / 2 at index 2
        const atr = wilderAtrSeries(bars, 2);
        expect(atr.slice(0, 2)).toEqual([null, null]);
        expect(atr[2]).toBe(2.5);
        expect(atr[3]).toBe((2.5 * 1 + 1) / 2);
    });

    it('uses the gap to the previous close in the true range', () => {
        const gapped = [
            { high: 10, low: 9, close: 9.5 },
            { high: 20, low: 19, close: 19.5 },
            { high: 20, low: 19, close: 19.5 },
        ];
        // tr[1] = max(1, |20-9.5|, |19-9.5|) = 10.5; tr[2] = 1; seed (10.5 + 1) / 2
        expect(wilderAtrSeries(gapped, 2)[2]).toBe(5.75);
    });

    it('is all null when the series is not longer than the period', () => {
        expect(wilderAtrSeries(bars.slice(0, 2), 2)).toEqual([null, null]);
    });
});

describe('classifyR4: the shipped trend rule', () => {
    /** Inputs for bar 20 with EMA20 moving from `before` to `now`, ATR `atr` and `close`. */
    function at(args: {
        now: number;
        before: number;
        atr: number | null;
        close: number;
    }) {
        const closes = Array.from({ length: 21 }, () => args.close);
        const ema = sparse(21, { 0: args.before, 20: args.now });
        const atr = sparse(21, { 20: args.atr });
        return { closes, ema, atr };
    }
    const label = (args: Parameters<typeof at>[0]) => {
        const { closes, ema, atr } = at(args);
        return classifyR4(closes, ema, atr, 20);
    };

    it('is bullish at a slope of exactly +1.00 ATR with the close above EMA20', () => {
        expect(label({ now: 101, before: 100, atr: 1, close: 102 })).toBe(
            'bullish'
        );
    });

    it('is neutral just under +1.00 ATR', () => {
        expect(label({ now: 100.99, before: 100, atr: 1, close: 102 })).toBe(
            'neutral'
        );
    });

    it('is bearish at exactly -1.00 ATR with the close below EMA20 and neutral at -0.99', () => {
        expect(label({ now: 99, before: 100, atr: 1, close: 98 })).toBe(
            'bearish'
        );
        expect(label({ now: 99.01, before: 100, atr: 1, close: 98 })).toBe(
            'neutral'
        );
    });

    it('classifies on the slope rounded to 2 places: 0.995 reads as 1.00', () => {
        const { closes, ema, atr } = at({
            now: 100.995,
            before: 100,
            atr: 1,
            close: 102,
        });
        expect(slopeAtrAt(closes, ema, atr, 20)).toBe(1);
        expect(classifyR4(closes, ema, atr, 20)).toBe('bullish');
        // 0.994 rounds down to 0.99 and stays neutral
        const below = at({ now: 100.994, before: 100, atr: 1, close: 102 });
        expect(classifyR4(below.closes, below.ema, below.atr, 20)).toBe(
            'neutral'
        );
    });

    it('requires the close strictly beyond EMA20', () => {
        expect(label({ now: 101, before: 100, atr: 1, close: 101 })).toBe(
            'neutral'
        );
        expect(label({ now: 99, before: 100, atr: 1, close: 99 })).toBe(
            'neutral'
        );
    });

    it('is not measurable without EMA20 twenty bars back, a usable ATR or a positive close', () => {
        expect(
            label({ now: 101, before: 100, atr: null, close: 102 })
        ).toBeNull();
        expect(label({ now: 101, before: 100, atr: 0, close: 102 })).toBeNull();
        expect(
            label({ now: 101, before: 100, atr: Number.NaN, close: 102 })
        ).toBeNull();
        expect(label({ now: 101, before: 100, atr: 1, close: 0 })).toBeNull();
        const noEarlyEma = at({ now: 101, before: 100, atr: 1, close: 102 });
        expect(
            classifyR4(
                noEarlyEma.closes,
                sparse(21, { 20: 101 }),
                noEarlyEma.atr,
                20
            )
        ).toBeNull();
        expect(
            classifyR4(noEarlyEma.closes, noEarlyEma.ema, noEarlyEma.atr, 5)
        ).toBeNull();
    });
});

describe('classifyR3: the percent rule', () => {
    const run = (now: number, before: number | null, close: number) =>
        classifyR3(
            Array.from({ length: 21 }, () => close),
            sparse(21, { 0: before, 20: now }),
            20
        );

    it('is bullish at +3% with the close above, neutral under it', () => {
        expect(run(103, 100, 104)).toBe('bullish');
        expect(run(102.99, 100, 104)).toBe('neutral');
    });

    it('is bearish at -3% with the close below, neutral under it', () => {
        expect(run(97, 100, 96)).toBe('bearish');
        expect(run(97.01, 100, 96)).toBe('neutral');
    });

    it('is not measurable without the earlier EMA or with a zero one', () => {
        expect(run(103, null, 104)).toBeNull();
        expect(run(103, 0, 104)).toBeNull();
    });
});

describe('classifyR1: the audit rule', () => {
    const labelOf = (close: (i: number) => number, at: number) => {
        const closes = Array.from({ length: 40 }, (_, i) => close(i));
        const sums = closes.reduce<number[]>(
            (acc, v) => [...acc, acc[acc.length - 1] + v],
            [0]
        );
        return classifyR1(closes, sums, at);
    };

    it('is bullish when close and SMA5 are above a rising SMA20', () => {
        expect(labelOf(i => 100 + i, 39)).toBe('bullish');
    });

    it('is bearish when close and SMA5 are below a falling SMA20', () => {
        expect(labelOf(i => 200 - i, 39)).toBe('bearish');
    });

    it('is neutral on a flat series and not measurable before SMA20 five bars back', () => {
        expect(labelOf(() => 100, 39)).toBe('neutral');
        expect(labelOf(() => 100, 23)).toBeNull();
        expect(labelOf(() => 100, 24)).toBe('neutral');
    });
});

describe('ruleSeries and allDaysStats', () => {
    it('labels a steady climb bullish and a steady fall bearish by every rule', () => {
        const up = ruleSeries(barsOf(120, i => 100 + i));
        const down = ruleSeries(barsOf(120, i => 300 - i));
        expect(up.labels.R4[119]).toBe('bullish');
        expect(up.labels.R1[119]).toBe('bullish');
        expect(up.labels.R3[119]).toBe('bullish');
        expect(down.labels.R4[119]).toBe('bearish');
        expect(down.labels.R1[119]).toBe('bearish');
        expect(down.labels.R3[119]).toBe('bearish');
        expect(up.labels.R4[10]).toBeNull();
        expect(up.slope[119]).not.toBeNull();
    });

    it('measures every day from the configured bar, pooled over symbols', () => {
        const up = symbolOf(
            barsOf(C.allDaysFromBar + 50, i => 100 + i),
            'UP'
        );
        const flat = symbolOf(
            barsOf(C.allDaysFromBar + 50, () => 100),
            'FLAT'
        );
        const stats = allDaysStats([up, flat]);
        expect(stats.R4.n).toBe(100);
        expect(stats.R4.distribution.bullish).toEqual(share(50, 100));
        expect(stats.R4.distribution.neutral).toEqual(share(50, 100));
        expect(stats.R4.dayToDayChange.count).toBe(0);
        // the flat symbol has no directional day; the climb matches its prior move every day
        expect(stats.R4.priorSignMatch).toEqual(share(50, 50));
    });

    it('counts a label change and a hard flip when a rise turns into a fall', () => {
        // up for 330 bars, then straight down: EMA20 lags, so the turn passes through neutral
        const v = symbolOf(
            barsOf(C.allDaysFromBar + 120, i =>
                i < 330 ? 100 + i : 100 + 330 - (i - 330) * 3
            )
        );
        const stats = allDaysStats([v]).R4;
        expect(stats.distribution.bullish.count).toBeGreaterThan(0);
        expect(stats.distribution.bearish.count).toBeGreaterThan(0);
        expect(stats.distribution.neutral.count).toBeGreaterThan(0);
        expect(stats.dayToDayChange.count).toBeGreaterThanOrEqual(2);
        expect(stats.hardFlip.count).toBe(0);
    });
});

describe('locating and comparing stored labels', () => {
    const bars = barsOf(150, i => 100 + i);
    const symbol = symbolOf(bars);
    const dateAt = (i: number): string => dayOf(bars[i].time);
    const row = (
        index: number,
        stored: TrendLabel,
        extra: Partial<StoredTrendRow> = {}
    ): StoredTrendRow & { caseId: string } => ({
        caseId: `AAA|${dateAt(index)}`,
        symbol: 'AAA',
        market: 'us',
        date: dateAt(index),
        stored,
        regime: null,
        trendBasisSlope: null,
        summary: null,
        ...extra,
    });

    it('finds each row on its bar and sets a row without a bar apart', () => {
        const found = row(100, 'bullish');
        const absent = row(100, 'bullish', { date: '1999-01-01' });
        const result = locateRows([symbol], [found, absent]);
        expect(result.located).toEqual([{ row: found, index: 100 }]);
        expect(result.missing).toEqual([absent]);
    });

    it('cuts the bars by calendar lookback, not by count', () => {
        const dated = barsOf(200, i => 100 + i);
        // 100 calendar days leaves 100 daily bars: the 20/20 rule is still measurable
        expect(rulesAtRow(dated, 150, 100)).not.toBeNull();
        // 30 calendar days leaves 30 bars: no SMA20 five bars back and EMA20 twenty back
        expect(rulesAtRow(dated, 150, 30)).toBeNull();
    });

    it('does not measure before the minimum bars, and counts those rows apart', () => {
        const rows = [
            row(C.minBarsForStoredLabel - 1, 'bullish'),
            row(100, 'bullish'),
        ];
        const { located } = locateRows([symbol], rows);
        const stats = storedLabelStats([symbol], located, 730);
        expect(stats.n).toBe(1);
        expect(stats.unmeasured).toBe(1);
        expect(rulesAtRow(bars, C.minBarsForStoredLabel - 1, 730)).toBeNull();
    });

    it('computes agreement, opposites, confusion and the groupings on a steady climb', () => {
        const rows = [
            row(100, 'bullish', { regime: 'uptrend' }),
            row(101, 'bearish', { regime: 'downtrend' }),
            row(102, 'neutral', { regime: 'uptrend' }),
        ];
        const { located } = locateRows([symbol], rows);
        const stats = storedLabelStats([symbol], located, 730);
        expect(stats.n).toBe(3);
        expect(stats.rules.R4.agree).toEqual(share(1, 3));
        expect(stats.rules.R4.opposite).toEqual(share(1, 3));
        expect(stats.rules.R4.confusion).toEqual({
            'bullish>bullish': 1,
            'bearish>bullish': 1,
            'neutral>bullish': 1,
        });
        expect(stats.rules.R4.byRegime.uptrend.agree).toEqual(share(1, 2));
        expect(stats.rules.R4.byRegime.downtrend.agree).toEqual(share(0, 1));
        expect(stats.rules.R4.byMarket.us.n).toBe(3);
        expect(stats.distribution.bullish).toEqual(share(1, 3));
    });

    it('measures day-to-day change on consecutive labelled bars only', () => {
        const rows = [
            row(100, 'bullish'),
            row(101, 'bearish'),
            // 6 bars later: further apart than the pairing allows
            row(101 + C.maxPairGapBars + 1, 'bullish'),
        ];
        const { located } = locateRows([symbol], rows);
        const stats = storedLabelStats([symbol], located, 730);
        expect(stats.dayToDayChange).toEqual(share(1, 1));
        expect(stats.hardFlip).toEqual(share(1, 1));
        expect(stats.rules.R4.ruleDayToDayChange).toEqual(share(0, 1));
    });

    it('keeps the last label of a date labelled twice', () => {
        const rows = [
            row(100, 'bullish'),
            row(100, 'bearish'),
            row(101, 'bearish'),
        ];
        const { located } = locateRows([symbol], rows);
        const stats = storedLabelStats([symbol], located, 730);
        expect(stats.dayToDayChange).toEqual(share(0, 1));
    });

    it('checks a stored trend and trendBasis against the shipped rule only', () => {
        const slope = ruleSeries(bars).slope[100];
        const rows = [
            row(100, 'bullish', { trendBasisSlope: slope }),
            row(101, 'bearish', { trendBasisSlope: 99 }),
            row(102, 'neutral'),
        ];
        const { located } = locateRows([symbol], rows);
        const plumbing = trendPlumbing([symbol], located, 730, rows.length);
        expect(plumbing.n).toBe(3);
        expect(plumbing.equal).toBe(1);
        expect(plumbing.mismatches.map(m => m.stored)).toEqual([
            'bearish',
            'neutral',
        ]);
        expect(plumbing.basis).toEqual({ present: 2, slopeMatches: 1 });
    });
});

describe('trendPlumbing: the trendBasis slope tolerance', () => {
    const bars = barsOf(150, i => 100 + i);
    const symbol = symbolOf(bars);
    const slope = ruleSeries(bars).slope[100] ?? Number.NaN;
    const matches = (stored: number): number => {
        const row: StoredTrendRow & { caseId: string } = {
            caseId: 'c',
            symbol: 'AAA',
            market: 'us',
            date: dayOf(bars[100].time),
            stored: 'bullish',
            regime: null,
            trendBasisSlope: stored,
            summary: null,
        };
        const { located } = locateRows([symbol], [row]);
        return trendPlumbing([symbol], located, 730, 1).basis.slopeMatches;
    };

    it('accepts a stored slope exactly 0.005 away (the rounding of 2 places) and rejects one just over', () => {
        expect(matches(slope)).toBe(1);
        expect(matches(slope + 0.005)).toBe(1);
        expect(matches(slope - 0.005)).toBe(1);
        expect(matches(slope + 0.0051)).toBe(0);
        expect(matches(slope - 0.0051)).toBe(0);
    });
});

describe('summary words (T5)', () => {
    it('takes the first paragraph', () => {
        expect(firstParagraph(' first\nline\n\nsecond ')).toBe('first\nline');
    });

    it('is opposite only when the direction words are all the other way', () => {
        expect(usesOnlyOppositeWords('하락 추세가 이어집니다', 'bullish')).toBe(
            true
        );
        expect(usesOnlyOppositeWords('상승 추세, 약세 신호', 'bullish')).toBe(
            false
        );
        expect(usesOnlyOppositeWords('강세입니다', 'bearish')).toBe(true);
        expect(usesOnlyOppositeWords('약세입니다', 'bearish')).toBe(false);
        expect(usesOnlyOppositeWords('강세입니다', 'neutral')).toBe(false);
        expect(usesOnlyOppositeWords('조용한 장입니다', 'bullish')).toBe(false);
    });

    it('counts opposite summaries over the rows that have one, and is null with none', () => {
        const base: StoredTrendRow = {
            symbol: 'A',
            market: 'us',
            date: '2026-01-01',
            stored: 'bullish',
            regime: null,
            trendBasisSlope: null,
            summary: null,
        };
        expect(oppositeWordsOf([base])).toBeNull();
        const words = oppositeWordsOf([
            { ...base, summary: '약세 전환입니다.\n\n다음 문단 상승세' },
            { ...base, summary: '상승세입니다' },
            base,
        ]);
        expect(words).toEqual({ n: 2, opposite: share(1, 2) });
    });
});

describe('summarizeTrend and its gates', () => {
    const longClimb = symbolOf(barsOf(C.allDaysFromBar + 100, i => 100 + i));

    it('throws when no day reaches the measured range', () => {
        expect(() =>
            summarizeTrend({
                symbols: [symbolOf(barsOf(100, i => 100 + i))],
                located: null,
                fromRun: false,
                lookbackDays: 730,
            })
        ).toThrow('no bar from index 300');
    });

    it('throws when no stored label can be compared', () => {
        const early = locateRows(
            [longClimb],
            [
                {
                    symbol: 'AAA',
                    market: 'us' as const,
                    date: dayOf(longClimb.bars[10].time),
                    stored: 'bullish' as const,
                    regime: null,
                    trendBasisSlope: null,
                    summary: null,
                    caseId: 'x',
                },
            ]
        );
        expect(() =>
            summarizeTrend({
                symbols: [longClimb],
                located: early.located,
                fromRun: false,
                lookbackDays: 730,
            })
        ).toThrow('no stored label could be compared');
    });

    it('has no stored, plumbing or word section without labels', () => {
        const summary = summarizeTrend({
            symbols: [longClimb],
            located: null,
            fromRun: false,
            lookbackDays: 730,
        });
        expect(summary.stored).toBeNull();
        expect(summary.plumbing).toBeNull();
        expect(summary.oppositeWords).toBeNull();
        expect(summary.allDays.fromBar).toBe(C.allDaysFromBar);
    });

    /** Statistics no gate reads, for the rules and fields a test does not set. */
    const unusedStats: SeriesStats = {
        n: 0,
        distribution: {
            bullish: share(0, 0),
            bearish: share(0, 0),
            neutral: share(0, 0),
        },
        dayToDayChange: share(0, 0),
        hardFlip: share(0, 0),
        priorSignMatch: share(0, 0),
    };

    /** A summary with the numbers the gates read, everything else neutral. */
    function summaryWith(args: {
        change: number;
        hard: number;
        shares: readonly [number, number, number];
        opposite?: number;
        onStored?: number;
        onStoredHard?: number;
        noStoredPairs?: boolean;
        plumbing?: {
            total: number;
            n: number;
            equal: number;
            basis?: { present: number; slopeMatches: number };
        };
        words?: { n: number; count: number };
    }): TrendSummary {
        const n = 1000;
        const stats = (count: number) => share(count, n);
        const [bull, bear, neut] = args.shares;
        const agreement = {
            n: 100,
            agree: share(90, 100),
            opposite: share(Math.round((args.opposite ?? 0) * 100), 100),
            confusion: {},
            byRegime: {},
            byMarket: {},
            ruleDayToDayChange: args.noStoredPairs
                ? share(0, 0)
                : share(Math.round((args.onStored ?? 0) * 100), 100),
            ruleHardFlip: args.noStoredPairs
                ? share(0, 0)
                : share(Math.round((args.onStoredHard ?? 0) * 100), 100),
        };
        return {
            allDays: {
                fromBar: 300,
                rules: {
                    R4: {
                        n,
                        distribution: {
                            bullish: stats(bull * n),
                            bearish: stats(bear * n),
                            neutral: stats(neut * n),
                        },
                        dayToDayChange: stats(args.change * n),
                        hardFlip: stats(args.hard * n),
                        priorSignMatch: stats(n),
                    },
                    R1: unusedStats,
                    R3: unusedStats,
                },
            },
            stored:
                args.opposite === undefined &&
                args.onStored === undefined &&
                args.noStoredPairs === undefined
                    ? null
                    : {
                          n: 100,
                          unmeasured: 0,
                          distribution: unusedStats.distribution,
                          dayToDayChange: share(0, 0),
                          hardFlip: share(0, 0),
                          rules: {
                              R4: agreement,
                              R1: agreement,
                              R3: agreement,
                          },
                      },
            plumbing:
                args.plumbing === undefined
                    ? null
                    : {
                          total: args.plumbing.total,
                          n: args.plumbing.n,
                          equal: args.plumbing.equal,
                          mismatches: [],
                          basis: args.plumbing.basis ?? {
                              present: 0,
                              slopeMatches: 0,
                          },
                      },
            oppositeWords:
                args.words === undefined
                    ? null
                    : {
                          n: args.words.n,
                          opposite: share(args.words.count, args.words.n),
                      },
        };
    }
    const verdict = (
        summary: TrendSummary,
        id: string,
        options?: { labelsFile: boolean }
    ) => trendGates(summary, options).find(g => g.id === id)?.pass;

    it('T1 needs every result to match and is undecided without a run', () => {
        const base = { change: 0.1, hard: 0, shares: [0.3, 0.3, 0.4] as const };
        const plumbing = (
            total: number,
            n: number,
            equal: number,
            basis?: { present: number; slopeMatches: number }
        ) => summaryWith({ ...base, plumbing: { total, n, equal, basis } });
        expect(verdict(summaryWith(base), 'T1')).toBeNull();
        expect(verdict(plumbing(10, 10, 10), 'T1')).toBe(true);
        expect(verdict(plumbing(10, 10, 9), 'T1')).toBe(false);
        expect(verdict(plumbing(0, 0, 0), 'T1')).toBe(false);
    });

    it('T1 fails when a result was left out of the comparison', () => {
        const base = { change: 0.1, hard: 0, shares: [0.3, 0.3, 0.4] as const };
        const gates = trendGates(
            summaryWith({
                ...base,
                plumbing: { total: 10, n: 9, equal: 9 },
            })
        );
        const t1 = gates.find(g => g.id === 'T1');
        expect(t1?.pass).toBe(false);
        expect(t1?.value).toContain('excluded 1');
    });

    it('T1 also needs every stored trendBasis slope to match', () => {
        const base = { change: 0.1, hard: 0, shares: [0.3, 0.3, 0.4] as const };
        const withBasis = (slopeMatches: number) =>
            summaryWith({
                ...base,
                plumbing: {
                    total: 10,
                    n: 10,
                    equal: 10,
                    basis: { present: 10, slopeMatches },
                },
            });
        expect(verdict(withBasis(10), 'T1')).toBe(true);
        expect(verdict(withBasis(9), 'T1')).toBe(false);
    });

    it('T2 passes at the limits and fails just over, on all days and on the stored dates', () => {
        const shares = [0.3, 0.3, 0.4] as const;
        expect(
            verdict(summaryWith({ change: 0.15, hard: 0.005, shares }), 'T2')
        ).toBe(true);
        expect(
            verdict(summaryWith({ change: 0.151, hard: 0, shares }), 'T2')
        ).toBe(false);
        expect(
            verdict(summaryWith({ change: 0.1, hard: 0.006, shares }), 'T2')
        ).toBe(false);
        expect(
            verdict(
                summaryWith({ change: 0.1, hard: 0, shares, onStored: 0.15 }),
                'T2'
            )
        ).toBe(true);
        expect(
            verdict(
                summaryWith({ change: 0.1, hard: 0, shares, onStored: 0.16 }),
                'T2'
            )
        ).toBe(false);
    });

    it('T2 also bounds the hard flips on the stored dates', () => {
        const shares = [0.3, 0.3, 0.4] as const;
        const base = { change: 0.1, hard: 0, shares, onStored: 0.1 };
        expect(verdict(summaryWith({ ...base, onStoredHard: 0 }), 'T2')).toBe(
            true
        );
        expect(
            verdict(summaryWith({ ...base, onStoredHard: 0.01 }), 'T2')
        ).toBe(false);
    });

    it('T2 cannot be decided from a labels file with no consecutive stored labels', () => {
        const summary = summaryWith({
            change: 0.1,
            hard: 0,
            shares: [0.3, 0.3, 0.4],
            noStoredPairs: true,
        });
        expect(verdict(summary, 'T2', { labelsFile: true })).toBeNull();
        // a run's cases are sparse by design: all days decide
        expect(verdict(summary, 'T2')).toBe(true);
    });

    it('T3 passes at 1% opposite and fails above, undecided without stored labels', () => {
        const base = { change: 0.1, hard: 0, shares: [0.3, 0.3, 0.4] as const };
        expect(verdict(summaryWith(base), 'T3')).toBeNull();
        expect(verdict(summaryWith({ ...base, opposite: 0.01 }), 'T3')).toBe(
            true
        );
        expect(verdict(summaryWith({ ...base, opposite: 0.02 }), 'T3')).toBe(
            false
        );
    });

    it('T4 needs every label between 15% and 60%', () => {
        const base = { change: 0.1, hard: 0 };
        expect(
            verdict(summaryWith({ ...base, shares: [0.15, 0.25, 0.6] }), 'T4')
        ).toBe(true);
        expect(
            verdict(summaryWith({ ...base, shares: [0.14, 0.26, 0.6] }), 'T4')
        ).toBe(false);
        expect(
            verdict(summaryWith({ ...base, shares: [0.15, 0.24, 0.61] }), 'T4')
        ).toBe(false);
    });

    it('T5 allows 2% opposite words and is undecided without summaries', () => {
        const base = { change: 0.1, hard: 0, shares: [0.3, 0.3, 0.4] as const };
        expect(verdict(summaryWith(base), 'T5')).toBeNull();
        expect(
            verdict(summaryWith({ ...base, words: { n: 100, count: 2 } }), 'T5')
        ).toBe(true);
        expect(
            verdict(summaryWith({ ...base, words: { n: 100, count: 3 } }), 'T5')
        ).toBe(false);
    });

    it('anyGateFailed ignores undecided gates', () => {
        const gate = (pass: boolean | null) => ({
            id: 'x',
            description: '',
            pass,
            value: null,
            threshold: '',
        });
        expect(anyGateFailed([gate(true), gate(null)])).toBe(false);
        expect(anyGateFailed([gate(true), gate(false)])).toBe(true);
    });
});
