import { describe, expect, it } from 'vitest';
import {
    BENCHMARK_CONSTANTS,
    FailClosedError,
    assertFinite,
    buildSleeve,
    computeBenchmarks,
    distributionOf,
    maxDrawdownPct,
    meanCurve,
    pickDecisionDays,
    placeHolds,
    placeboRaces,
    placedCurve,
    raceBracket,
    randomEntryDraw,
    shareAbove,
    shareShallower,
    roundForOutput,
    sameLengthDriftPct,
    strategyAccount,
    weekClusterInterval,
    type BenchmarkInput,
    type BenchmarkTrade,
} from '../../../../scripts/replay/backtestBenchmarksCompute';
import { mulberry32 } from '@/domain/outcomes/weekClusterBootstrap';
import {
    DAYS,
    FIXTURE_DATES,
    T0,
    T1,
    T2,
    T3,
    aaaClose,
    bbbClose,
    fixtureBars,
    fixtureInput,
    flatInput,
    marketEntryTrade,
} from './backtestBenchmarkFixtures';

/** The oracle of this file is hand calculation: each expected value below is arithmetic on the fixture's closed-form prices. */
const days = Array.from({ length: DAYS }, (_, d) => d);
const maxDrawdownOf = (curve: readonly number[]): number =>
    Math.min(
        ...curve.map(
            (v, i) => (v / Math.max(1, ...curve.slice(0, i + 1)) - 1) * 100
        )
    );

describe('computeBenchmarks on the hand-made run (oracle: hand calculation)', () => {
    const { benchmarks, perTrade, perTicker, diagnostics } =
        computeBenchmarks(fixtureInput());

    it('values the hold portfolio on daily closes: (1.29 + 0.98) / 2 - 1 and a 0.1 / 1.135 drawdown', () => {
        expect(benchmarks.holdPortfolio.returnPct).toBeCloseTo(13.5, 10);
        // Mean curve peaks at (1.09 + 1.18) / 2 = 1.135 on day 9 and bottoms at (1.19 + 0.88) / 2 = 1.035 on day 19.
        expect(benchmarks.holdPortfolio.maxDrawdownPct).toBeCloseTo(
            (1.035 / 1.135 - 1) * 100,
            10
        );
    });

    it("uses each ticker's own exposure: AAA (5 + 2) / 30, BBB 2 / 30, mean 15%", () => {
        expect(perTicker.map(t => t.exposurePct)).toEqual([
            expect.closeTo((7 / 30) * 100, 10),
            expect.closeTo((2 / 30) * 100, 10),
        ]);
        expect(benchmarks.exposureMatchedHold.exposurePct).toBeCloseTo(15, 10);
    });

    it('holds each ticker for its exposure and cash for the rest', () => {
        // AAA 1 + 7/30 * 0.29, BBB 1 + 2/30 * (-0.02), equal weight.
        const expected =
            ((1 + (7 / 30) * 0.29 + (1 + (2 / 30) * -0.02)) / 2 - 1) * 100;
        expect(benchmarks.exposureMatchedHold.returnPct).toBeCloseTo(
            expected,
            10
        );
        expect(perTicker.map(t => t.exposureMatchedHoldPct)).toEqual([
            expect.closeTo((7 / 30) * 29, 10),
            expect.closeTo((2 / 30) * -2, 10),
        ]);
        const curve = days.map(
            d =>
                (1 -
                    7 / 30 +
                    (7 / 30) * ((100 + d) / 100) +
                    (1 - 2 / 30 + (2 / 30) * (bbbClose(d) / 100))) /
                2
        );
        expect(benchmarks.exposureMatchedHold.maxDrawdownPct).toBeCloseTo(
            maxDrawdownOf(curve),
            10
        );
    });

    it('marks the open trade to the close: peak 1.03, trough (1.06 + 0.9565) / 2', () => {
        // Days 7 to 9: AAA closed at 1.06, BBB flat at 1. Day 12 on: BBB closed at 1 - 0.0435 while AAA sits at 1.06.
        expect(benchmarks.strategyMarkToMarketMaxDrawdownPct).toBeCloseTo(
            ((1.06 + 0.9565) / 2 / 1.03 - 1) * 100,
            10
        );
        expect(perTicker.map(t => t.markToMarketMaxDrawdownPct)).toEqual([
            expect.closeTo(0, 10),
            expect.closeTo(-4.35, 10),
        ]);
    });

    it('compounds the stored returns: AAA 1.06 * 1.0167, BBB 0.9565', () => {
        expect(diagnostics.strategy.closedReturnPct).toBeCloseTo(
            ((1.06 * 1.0167 + 0.9565) / 2 - 1) * 100,
            10
        );
        // Closed-trade drawdown: the same sleeves valued only at exits.
        expect(diagnostics.strategy.closedMaxDrawdownPct).toBeCloseTo(
            ((1.06 + 0.9565) / 2 / ((1.06 + 1) / 2) - 1) * 100,
            10
        );
    });

    it('subtracts the same-length drift from each trade', () => {
        const mean = (xs: readonly number[]): number =>
            xs.reduce((a, b) => a + b, 0) / xs.length;
        // T1: 5-day hold of AAA from start days 0..24; T3: 2-day hold from 0..27; T2: BBB 2-day hold from 0..27.
        const driftT1 = mean(days.slice(0, 25).map(j => (5 / (100 + j)) * 100));
        const driftT3 = mean(days.slice(0, 28).map(j => (2 / (100 + j)) * 100));
        const driftT2 = mean(
            days
                .slice(0, 28)
                .map(j => (bbbClose(j + 2) / bbbClose(j) - 1) * 100)
        );
        expect(perTrade.map(r => r.sameLengthDriftPct)).toEqual([
            expect.closeTo(driftT1, 10),
            expect.closeTo(driftT2, 10),
            expect.closeTo(driftT3, 10),
        ]);
        const excess = [6 - driftT1, -4.35 - driftT2, 1.67 - driftT3];
        expect(perTrade.map(r => r.excessPct)).toEqual(
            excess.map(e => expect.closeTo(e, 10))
        );
        expect(benchmarks.perTradeExcess).toMatchObject({
            basis: 'same_length_drift',
            n: 3,
            clusters: 'week',
        });
        expect(benchmarks.perTradeExcess.meanPct).toBeCloseTo(mean(excess), 10);
        const baselineMean = mean([driftT1, driftT2, driftT3]);
        expect(benchmarks.perTradeExcess.baselineMeanPct).toBeCloseTo(
            baselineMean,
            10
        );
        expect(benchmarks.perTradeExcess.meanPct).toBeCloseTo(
            mean([6, -4.35, 1.67]) - baselineMean,
            10
        );
        expect(benchmarks.perTradeExcess.ci95.low).toBeGreaterThanOrEqual(
            Math.min(...excess) - 1e-9
        );
        expect(benchmarks.perTradeExcess.ci95.high).toBeLessThanOrEqual(
            Math.max(...excess) + 1e-9
        );
    });

    it('keeps the trades in input order and carries the pairing identity', () => {
        expect(perTrade.map(r => r.ticker)).toEqual(['AAA', 'BBB', 'AAA']);
        expect(benchmarks).toMatchObject({
            version: 1,
            tradesSha256: 'sha-of-trades',
            barsFingerprint: 'fingerprint',
            coreSha: 'abc123',
        });
    });

    it('counts the bracket trades by their first half: T1 tp1, T2 sl1, T3 neither', () => {
        expect(benchmarks.bracket.n).toBe(2);
        // Re-race of the fixed initial levels: T1 reaches 104 first, T2 reaches 112 first (a stop).
        expect(benchmarks.bracket.initialPlan).toEqual({
            resolvedRaces: 2,
            targetFirstShare: 0.5,
        });
        expect(benchmarks.bracket.storedTargetFirstShare).toBe(0.5);
        expect(benchmarks.bracket.placebo.resolvedRaces).toBeGreaterThan(0);
        expect(benchmarks.bracket.placebo.resolvedRaces).toBeLessThanOrEqual(6);
        expect(
            benchmarks.bracket.placebo.targetFirstShare
        ).toBeGreaterThanOrEqual(0);
        expect(benchmarks.bracket.placebo.targetFirstShare).toBeLessThanOrEqual(
            1
        );
        expect(diagnostics.bracket.reRace).toEqual({
            agree: 2,
            disagreeWithReviews: 0,
        });
    });

    it('states the random-entry draws and shares inside 0..1', () => {
        const { randomEntry } = benchmarks;
        expect(randomEntry.draws).toBe(BENCHMARK_CONSTANTS.randomEntryDraws);
        expect(randomEntry.returnPct.p5).toBeLessThanOrEqual(
            randomEntry.returnPct.median
        );
        expect(randomEntry.returnPct.median).toBeLessThanOrEqual(
            randomEntry.returnPct.p95
        );
        expect(randomEntry.maxDrawdownPct.p95).toBeLessThanOrEqual(0);
        expect(randomEntry.shareAboveStrategyReturn).toBeGreaterThanOrEqual(0);
        expect(randomEntry.shareAboveStrategyReturn).toBeLessThanOrEqual(1);
        expect(randomEntry.shareWithSmallerDrawdown).toBeGreaterThanOrEqual(0);
        expect(randomEntry.shareWithSmallerDrawdown).toBeLessThanOrEqual(1);
    });

    it('is deterministic: two runs give identical output', () => {
        expect(JSON.stringify(computeBenchmarks(fixtureInput()))).toBe(
            JSON.stringify(computeBenchmarks(fixtureInput()))
        );
    });

    it('is finite everywhere', () => {
        expect(() =>
            assertFinite(computeBenchmarks(fixtureInput()))
        ).not.toThrow();
    });
});

describe('strategyAccount', () => {
    const sleeve = buildSleeve(
        'AAA',
        fixtureBars(aaaClose),
        { periodStart: FIXTURE_DATES[0], periodEnd: FIXTURE_DATES[DAYS - 1] },
        [T1, T2, T3]
    );
    const account = strategyAccount(sleeve);

    it('compounds at the exit day and values the open trade by leg', () => {
        expect(account.closed[6]).toBe(1);
        expect(account.closed[7]).toBeCloseTo(1.06, 12);
        expect(account.closed[22]).toBeCloseTo(1.06 * 1.0167, 12);
        // Day 2: both halves open at close 102 against the 100 entry. Day 3: A is out at 104, B at 103.
        expect(account.markToMarket[2]).toBeCloseTo(1.02, 12);
        expect(account.markToMarket[3]).toBeCloseTo(
            0.5 * 1.04 + 0.5 * 1.03,
            12
        );
        expect(account.markToMarket[6]).toBeCloseTo(
            0.5 * 1.04 + 0.5 * 1.06,
            12
        );
        expect(account.markToMarket[7]).toBeCloseTo(1.06, 12);
    });

    it('implies the return of the legs for the whole run', () => {
        // T1 legs 0.5 * 4% + 0.5 * 8% = 6%; T3 legs 122 / 120.
        expect(account.finalFromLegs).toBeCloseTo(1.06 * (122 / 120), 12);
    });
});

describe('sameLengthDriftPct', () => {
    it('averages over every start day with room for the hold', () => {
        // Closes 100, 110, 121: 1-day returns 10% and 10%.
        expect(sameLengthDriftPct([100, 110, 121], 1)).toBeCloseTo(10, 10);
        // 2-day: one start, 121 / 100 - 1.
        expect(sameLengthDriftPct([100, 110, 121], 2)).toBeCloseTo(21, 10);
    });

    it('refuses a hold that does not fit', () => {
        expect(() => sameLengthDriftPct([100, 110], 2)).toThrow(
            FailClosedError
        );
    });
});

describe('maxDrawdownPct and meanCurve', () => {
    it('starts the peak at 1, so a first-day fall counts', () => {
        expect(maxDrawdownPct([0.9, 0.95])).toBeCloseTo(-10, 10);
        expect(maxDrawdownPct([1, 1.2, 0.9, 1.5])).toBeCloseTo(-25, 10);
        expect(maxDrawdownPct([1, 2])).toBe(0);
    });

    it('averages sleeves day by day', () => {
        expect(
            meanCurve([
                [1, 2],
                [3, 4],
            ])
        ).toEqual([2, 3]);
    });
});

describe('weekClusterInterval', () => {
    it('is the mean with a percentile interval inside the observed range', () => {
        const values = [
            { week: 'w1', value: 1 },
            { week: 'w1', value: 3 },
            { week: 'w2', value: 5 },
            { week: 'w3', value: 7 },
        ];
        const interval = weekClusterInterval(values, 2_000, 7);
        expect(interval.mean).toBe(4);
        expect(interval.low).toBeGreaterThanOrEqual(1);
        expect(interval.high).toBeLessThanOrEqual(7);
        expect(interval.low).toBeLessThan(interval.high);
        expect(weekClusterInterval(values, 2_000, 7)).toEqual(interval);
    });

    it('refuses no values', () => {
        expect(() => weekClusterInterval([], 10, 1)).toThrow(FailClosedError);
    });
});

describe('placeHolds and placedCurve (placebo invariants)', () => {
    it('places every length exactly once, in order and without overlap, inside the period', () => {
        const lengths = [5, 2, 9, 1, 1];
        Array.from({ length: 300 }, (_, seed) => seed).forEach(seed => {
            const windows = placeHolds(lengths, 40, mulberry32(seed));
            expect(
                windows.map(w => w.length).toSorted((a, b) => a - b)
            ).toEqual(lengths.toSorted((a, b) => a - b));
            windows.forEach((w, i) => {
                expect(w.start).toBeGreaterThanOrEqual(0);
                expect(w.start + w.length).toBeLessThanOrEqual(39);
                if (i > 0) {
                    expect(w.start).toBeGreaterThanOrEqual(
                        windows[i - 1].start + windows[i - 1].length
                    );
                }
            });
        });
    });

    it('fills the period exactly when there is no spare day', () => {
        const windows = placeHolds([3, 2], 6, mulberry32(1));
        expect(windows.reduce((s, w) => s + w.length, 0)).toBe(5);
        expect(windows[0].start).toBe(0);
        expect(windows[1].start).toBe(windows[0].length);
    });

    it('refuses lengths that cannot fit without overlap', () => {
        expect(() => placeHolds([3, 3], 6, mulberry32(1))).toThrow(
            FailClosedError
        );
    });

    it('places nothing for no trades', () => {
        expect(placeHolds([], 10, mulberry32(1))).toEqual([]);
    });

    it('identity placement reproduces the real close-to-close holds', () => {
        const sleeve = buildSleeve(
            'AAA',
            fixtureBars(aaaClose),
            {
                periodStart: FIXTURE_DATES[0],
                periodEnd: FIXTURE_DATES[DAYS - 1],
            },
            [T1, T3]
        );
        const real = sleeve.trades.map(p => ({
            start: p.entryIdx,
            length: p.length,
        }));
        const curve = placedCurve(sleeve.closes, real);
        expect(curve[DAYS - 1]).toBeCloseTo((107 / 102) * (122 / 120), 12);
        // Flat outside the windows, growing inside them.
        expect(curve[2]).toBe(1);
        expect(curve[3]).toBeCloseTo(103 / 102, 12);
        expect(curve[19]).toBeCloseTo(107 / 102, 12);
    });

    it("keeps each ticker's exposure equal to the strategy's in every draw", () => {
        const input = fixtureInput();
        const sleeves = input.run.tickers.map(t =>
            buildSleeve(t, input.bars[t], input.run, input.trades)
        );
        const inPositionDays = (
            windows: readonly { length: number }[]
        ): number => windows.reduce((s, w) => s + w.length, 0);
        const strategyDays = sleeves.map(s =>
            s.trades.reduce((sum, p) => sum + p.length, 0)
        );
        Array.from(
            { length: BENCHMARK_CONSTANTS.randomEntryDraws },
            (_, k) => k
        ).forEach(draw => {
            const { windows } = randomEntryDraw(
                sleeves,
                draw,
                BENCHMARK_CONSTANTS.randomEntrySeed
            );
            expect(windows.map(inPositionDays)).toEqual(strategyDays);
        });
    });
});

describe("raceBracket (the simulator's race)", () => {
    const bar = (open: number, high: number, low: number, close = open) => ({
        time: 0,
        open,
        high,
        low,
        close,
        volume: 1,
    });

    it('counts a bar touching both levels as the stop', () => {
        const bars = [bar(100, 100, 100), bar(100, 106, 94)];
        expect(raceBracket(bars, 0, 105, 95, true, 60)).toBe('stop');
    });

    it('fills a gap at the open on the bars after the entry', () => {
        expect(
            raceBracket(
                [bar(100, 100, 100), bar(110, 111, 109)],
                0,
                105,
                95,
                true,
                60
            )
        ).toBe('target');
        expect(
            raceBracket(
                [bar(100, 100, 100), bar(90, 91, 89)],
                0,
                105,
                95,
                true,
                60
            )
        ).toBe('stop');
    });

    it('tests the entry bar on its range only when the entry was a limit fill inside it', () => {
        // The entry bar opens above the target, but the fill happened inside the bar: no gap.
        const bars = [bar(110, 111, 99), bar(100, 101, 99)];
        expect(raceBracket(bars, 0, 105, 95, false, 60)).toBe('target');
        expect(raceBracket(bars, 0, 112, 95, false, 60)).toBe('open');
        // As a close entry the same bar is skipped.
        expect(raceBracket(bars, 0, 105, 95, true, 60)).toBe('open');
    });

    it('stops after the holding limit and at the end of the bars', () => {
        const flat = Array.from({ length: 10 }, () => bar(100, 101, 99));
        expect(
            raceBracket([...flat, bar(100, 130, 99)], 0, 120, 90, true, 5)
        ).toBe('open');
        expect(
            raceBracket([...flat, bar(100, 130, 99)], 0, 120, 90, true, 60)
        ).toBe('target');
        expect(raceBracket(flat.slice(0, 1), 0, 120, 90, true, 60)).toBe(
            'open'
        );
    });

    it("places the trade's own distances on other days of the ticker", () => {
        const sleeve = buildSleeve(
            'AAA',
            fixtureBars(aaaClose),
            {
                periodStart: FIXTURE_DATES[0],
                periodEnd: FIXTURE_DATES[DAYS - 1],
            },
            [T1]
        );
        // T1: +4% target, -4% stop. From close 100 on day 0 the target is 104, reached on day 3 (high 104).
        // From close 128 on day 28 the target is 133.12 and the 2 bars left never reach it.
        expect(placeboRaces(sleeve, T1, [0, 28])).toEqual(['target', 'open']);
    });

    it('refuses a trade whose levels do not bracket its entry', () => {
        const sleeve = buildSleeve(
            'AAA',
            fixtureBars(aaaClose),
            {
                periodStart: FIXTURE_DATES[0],
                periodEnd: FIXTURE_DATES[DAYS - 1],
            },
            [T1]
        );
        const upsideDown: BenchmarkTrade = {
            ...T1,
            initialPlan: { ...T1.initialPlan, tp1: 99 },
        };
        expect(() => placeboRaces(sleeve, upsideDown, [0])).toThrow(
            FailClosedError
        );
    });

    it('draws decision days inside the period with a bar after them', () => {
        const sleeve = buildSleeve(
            'AAA',
            fixtureBars(aaaClose),
            {
                periodStart: FIXTURE_DATES[0],
                periodEnd: FIXTURE_DATES[DAYS - 1],
            },
            [T1]
        );
        const picks = pickDecisionDays(sleeve, 500, mulberry32(3));
        expect(Math.min(...picks)).toBe(0);
        expect(Math.max(...picks)).toBe(DAYS - 2);
    });
});

describe('distributionOf and roundForOutput', () => {
    it('takes the 5th, 50th and 95th percentile', () => {
        const values = Array.from({ length: 101 }, (_, i) => i);
        expect(distributionOf(values)).toEqual({ p5: 5, median: 50, p95: 95 });
        expect(() => distributionOf([])).toThrow(FailClosedError);
    });

    it('rounds figures to four decimals and leaves integers and strings', () => {
        expect(
            roundForOutput({
                a: 1.234567,
                b: 650227714,
                c: 'x',
                d: [0.00004999],
            })
        ).toEqual({ a: 1.2346, b: 650227714, c: 'x', d: [0] });
    });

    it('refuses a non-finite figure anywhere in the tree', () => {
        expect(() => assertFinite({ a: { b: [1, Number.NaN] } })).toThrow(
            'result.a.b[1]'
        );
        expect(() => assertFinite({ a: Infinity })).toThrow(FailClosedError);
    });
});

describe('fail closed (TE-16)', () => {
    const refuses = (
        overrides: Partial<BenchmarkInput>,
        message: RegExp
    ): void => {
        expect(() => computeBenchmarks(fixtureInput(overrides))).toThrow(
            FailClosedError
        );
        expect(() => computeBenchmarks(fixtureInput(overrides))).toThrow(
            message
        );
    };

    it('an empty trade list', () => {
        refuses({ trades: [] }, /no trades/);
    });

    it('run tickers that differ from the baselines', () => {
        refuses(
            { run: { ...fixtureInput().run, tickers: ['BBB', 'AAA'] } },
            /differ/
        );
    });

    it('a ticker without bars', () => {
        refuses({ bars: { AAA: fixtureBars(aaaClose) } }, /no bars for BBB/);
    });

    it('a trade of a ticker outside the run', () => {
        refuses({ trades: [T1, { ...T2, ticker: 'ZZZ' }] }, /outside the run/);
    });

    it('a trade date that is not a bar of the period', () => {
        refuses(
            { trades: [T1, { ...T2, entryDate: '2030-01-01' }, T3] },
            /entry date 2030-01-01/
        );
        refuses(
            {
                trades: [
                    T1,
                    T2,
                    {
                        ...T3,
                        legs: [
                            { ...T3.legs[0], exitDate: '2030-01-01' },
                            T3.legs[1],
                        ],
                    },
                ],
            },
            /leg exit date/
        );
    });

    it('overlapping trades of one ticker', () => {
        refuses(
            {
                trades: [
                    T1,
                    {
                        ...T3,
                        entryType: 'wait_limit',
                        entryDate: FIXTURE_DATES[5],
                        exitDate: FIXTURE_DATES[7],
                        holdingDays: 2,
                        legs: [
                            { ...T3.legs[0], exitDate: FIXTURE_DATES[7] },
                            { ...T3.legs[1], exitDate: FIXTURE_DATES[7] },
                        ],
                    },
                ],
            },
            /overlap/
        );
    });

    it('a trade that exits before it enters', () => {
        refuses(
            {
                trades: [
                    T1,
                    { ...T3, exitDate: FIXTURE_DATES[10], legs: T3.legs },
                ],
            },
            /exits before it enters/
        );
    });

    it('a leg that is still open', () => {
        refuses(
            {
                trades: [
                    T1,
                    {
                        ...T3,
                        legs: [{ ...T3.legs[0], reason: 'open' }, T3.legs[1]],
                    },
                ],
            },
            /still open/
        );
    });

    it('baselines the bars do not reproduce', () => {
        refuses(
            {
                baselines: [
                    { ...fixtureInput().baselines[0], buyHoldPct: 30 },
                    fixtureInput().baselines[1],
                ],
            },
            /AAA: the bars give hold/
        );
        refuses(
            {
                baselines: [
                    { ...fixtureInput().baselines[0], tradingDays: 29 },
                    fixtureInput().baselines[1],
                ],
            },
            /29 days/
        );
    });

    it('stored returns that do not match their legs', () => {
        refuses({ trades: [T1, { ...T2, returnPct: 9 }, T3] }, /legs imply/);
    });

    it('a first half the initial plan cannot explain, when no holding review could have moved it', () => {
        const flipped: BenchmarkTrade = {
            ...T1,
            legs: [{ ...T1.legs[0], reason: 'sl1' }, T1.legs[1]],
        };
        refuses(
            { trades: [flipped, T2, T3] },
            /no holding review could have moved it/
        );
    });

    it('counts, but does not refuse, a disagreement a holding review could explain', () => {
        const reviewed: BenchmarkTrade = {
            ...T1,
            holdingReviews: 2,
            legs: [{ ...T1.legs[0], reason: 'sl1' }, T1.legs[1]],
        };
        const { diagnostics, benchmarks } = computeBenchmarks(
            fixtureInput({ trades: [reviewed, T2, T3] })
        );
        expect(diagnostics.bracket.reRace).toEqual({
            agree: 1,
            disagreeWithReviews: 1,
        });
        // The stored first half says stop for both trades; the fixed initial levels still say T1 reached its target first.
        expect(benchmarks.bracket.storedTargetFirstShare).toBe(0);
        expect(benchmarks.bracket.initialPlan.targetFirstShare).toBe(0.5);
    });

    it('a stored holdingDays that disagrees with the bar span of its dates', () => {
        refuses(
            { trades: [{ ...T1, holdingDays: 4 }, T2, T3] },
            /holdingDays 4 but its dates span 5 bars/
        );
    });

    it('legs whose sizes do not sum to 1', () => {
        refuses(
            {
                trades: [
                    T1,
                    T2,
                    {
                        ...T3,
                        legs: [{ ...T3.legs[0], size: 0.6 }, T3.legs[1]],
                    },
                ],
            },
            /sum to 1.1, not 1/
        );
    });

    it('one trade whose stored return does not match its legs', () => {
        refuses(
            { trades: [T1, { ...T2, returnPct: -4.0 }, T3] },
            /BBB .*: the stored return -4% but its legs imply/
        );
    });

    it('a market entry whose price is not its entry bar close', () => {
        refuses(
            { trades: [T1, T2, T3, marketEntryTrade(90)] },
            /enter_close entry at 90 is not the entry bar's close 89/
        );
    });

    it('a period with no bars of a ticker', () => {
        refuses(
            {
                run: {
                    ...fixtureInput().run,
                    periodStart: '2031-01-01',
                    periodEnd: '2031-02-01',
                },
            },
            /fewer than two bars/
        );
    });

    it('tickers whose bars cover different numbers of days', () => {
        refuses(
            {
                bars: {
                    AAA: fixtureBars(aaaClose),
                    BBB: fixtureBars(bbbClose).slice(0, 29),
                },
            },
            /different numbers of bars/
        );
    });

    it('a run without bracket trades', () => {
        refuses(
            { trades: [T3], baselines: fixtureInput().baselines },
            /no bracket trade/
        );
    });
});

describe('the strict shares (R1)', () => {
    it('shareAbove counts only draws strictly above the threshold', () => {
        expect(shareAbove([1, 2, 3, 3], 3)).toBe(0);
        expect(shareAbove([1, 2, 3, 3], 2)).toBe(0.5);
        expect(shareAbove([1, 2, 3, 3], 0)).toBe(1);
    });

    it("shareShallower counts only drawdowns strictly shallower than the strategy's", () => {
        expect(shareShallower([-5, -10, -10, -20], -10)).toBe(0.25);
        expect(shareShallower([-10, -10], -10)).toBe(0);
        expect(shareShallower([0, 0], -5)).toBe(1);
    });

    it("on a flat run every draw returns exactly the strategy's 0 (not above) and sits above its -5% mark-to-market drawdown", () => {
        const { benchmarks, diagnostics } = computeBenchmarks(flatInput());
        expect(diagnostics.strategy.closedReturnPct).toBe(0);
        expect(benchmarks.randomEntry.returnPct).toEqual({
            p5: 0,
            median: 0,
            p95: 0,
        });
        expect(benchmarks.randomEntry.shareAboveStrategyReturn).toBe(0);
        // Closed-trade drawdown is 0 here; only the mark-to-market one is -5%.
        expect(diagnostics.strategy.closedMaxDrawdownPct).toBe(0);
        expect(benchmarks.strategyMarkToMarketMaxDrawdownPct).toBeCloseTo(
            -5,
            10
        );
        expect(benchmarks.randomEntry.maxDrawdownPct.median).toBe(0);
        expect(benchmarks.randomEntry.shareWithSmallerDrawdown).toBe(1);
    });
});

describe('weekClusterInterval resamples whole weeks (R2)', () => {
    it('one week: the interval collapses to the mean', () => {
        const interval = weekClusterInterval(
            [
                { week: 'w1', value: 1 },
                { week: 'w1', value: 4 },
            ],
            500,
            5
        );
        expect(interval.low).toBe(2.5);
        expect(interval.high).toBe(2.5);
        expect(interval.mean).toBe(2.5);
    });

    it('two weeks: resample means are 2, 3 or 5 and the bounds are among them', () => {
        // w1 = [1, 3] (sum 4, 2 obs), w2 = [5]. Resampling two weeks: (w1,w1) 2, (w1,w2) and (w2,w1) 3, (w2,w2) 5,
        // with probabilities 1/4, 1/2, 1/4, so the 2.5th and 97.5th percentiles are 2 and 5.
        // A trade-level bootstrap would reach 1 (all draws 1, probability 1/27) and put the lower bound at 1.
        const interval = weekClusterInterval(
            [
                { week: 'w1', value: 1 },
                { week: 'w1', value: 3 },
                { week: 'w2', value: 5 },
            ],
            2_000,
            11
        );
        expect([2, 3, 5]).toContain(interval.low);
        expect([2, 3, 5]).toContain(interval.high);
        expect(interval.low).toBe(2);
        expect(interval.high).toBe(5);
        expect(interval.mean).toBe(3);
    });
});

describe('a 0-day trade and a market entry in the run (R3, r3)', () => {
    const withZero = computeBenchmarks(
        fixtureInput({ trades: [T1, T2, T3, T0] })
    );

    it('has a drift of 0, so its excess is its own return, and adds no exposure', () => {
        const zero = withZero.perTrade[3];
        expect(zero.sameLengthDriftPct).toBe(0);
        expect(zero.excessPct).toBe(1.06);
        expect(withZero.perTicker[1].exposurePct).toBeCloseTo(
            (2 / 30) * 100,
            10
        );
    });

    it("places a 0-day hold in the placebo too, so every draw holds the strategy's 2 days of BBB", () => {
        const input = fixtureInput({ trades: [T1, T2, T3, T0] });
        const sleeves = input.run.tickers.map(t =>
            buildSleeve(t, input.bars[t], input.run, input.trades)
        );
        Array.from({ length: 200 }, (_, draw) => draw).forEach(draw => {
            const { windows } = randomEntryDraw(sleeves, draw, 1);
            expect(windows[1].map(w => w.length).toSorted()).toEqual([0, 2]);
            expect(windows[1].reduce((s, w) => s + w.length, 0)).toBe(2);
        });
    });

    it('races a market entry from the bar after its close', () => {
        const { benchmarks } = computeBenchmarks(
            fixtureInput({ trades: [T1, T2, T3, marketEntryTrade()] })
        );
        expect(benchmarks.bracket.n).toBe(3);
        // T1 and the market entry reach their targets first, T2 its stop.
        expect(benchmarks.bracket.initialPlan).toEqual({
            resolvedRaces: 3,
            targetFirstShare: 2 / 3,
        });
        expect(benchmarks.bracket.storedTargetFirstShare).toBe(2 / 3);
    });
});
