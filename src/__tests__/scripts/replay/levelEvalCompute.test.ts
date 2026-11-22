import { afterEach, describe, expect, it, vi } from 'vitest';
import { labelLevelOutcome } from '@/domain/outcomes/labelLevelOutcome';
import type {
    LevelSide,
    OutcomeBarTuple,
    OutcomeWindow,
} from '@/domain/outcomes/types';
import type { Bar, ReferenceLevel } from '@/domain/types';
import { makeResamplings } from '../../../../scripts/replay/engineEvalCompute';
import {
    isoWeekKey,
    mulberry32,
} from '../../../../scripts/replay/engineEvalStats';
import {
    addRobust,
    auc,
    bandOf,
    evaluateLevel,
    featureNames,
    fitLogistic,
    forwardReturns,
    groupStat,
    groupTable,
    heldTables,
    labelDay,
    levelFeaturesAt,
    levelHash,
    meanRanks,
    meanRanksWithCost,
    nonPositiveSummary,
    partnerDays,
    quantileEdges,
    robustGroups,
    robustRows,
    scoreSummary,
    solveLinear,
    spearman,
    structuralAnchors,
    structuralSummary,
    toDayRow,
    touchRateByDistance,
    transplantPicks,
    transplantPrice,
    type RobustTally,
} from '../../../../scripts/replay/levelEvalCompute';
import {
    LEVEL_EVAL_CONSTANTS as C,
    type DayFeatures,
    type HeldOutcome,
    type LevelFeatures,
    type LevelRow,
    type RrAnchors,
} from '../../../../scripts/replay/levelEvalTypes';
import { sha256Hex } from '../../../../scripts/replay/fsUtil';
import { tradingBars } from './replayFixtures';

const force = vi.hoisted(() => ({ on: false }));

// The real labeller, unless a test forces it to disagree with the instrument's evaluator.
vi.mock('@/domain/outcomes/labelLevelOutcome', async importOriginal => {
    const actual =
        await importOriginal<
            typeof import('@/domain/outcomes/labelLevelOutcome')
        >();
    return {
        ...actual,
        labelLevelOutcome: (
            ...args: Parameters<typeof actual.labelLevelOutcome>
        ) => {
            const label = actual.labelLevelOutcome(...args);
            return force.on && label.outcome === 'respected'
                ? { ...label, outcome: 'broken' as const }
                : label;
        },
    };
});

afterEach(() => {
    force.on = false;
});

const bar = (
    open: number,
    high: number,
    low: number,
    close: number
): OutcomeBarTuple => [0, open, high, low, close];

const flat = (count: number, price = 100): OutcomeBarTuple[] =>
    Array.from({ length: count }, () =>
        bar(price, price + 0.5, price - 0.5, price)
    );

/** Reference 100, ATR 2: a support at 96 is 2 ATR away, its touch band is 96.2, its barrier 95 / 97. */
const windowOf = (
    forward: readonly OutcomeBarTuple[],
    over: Partial<OutcomeWindow> = {}
): OutcomeWindow => ({
    referencePrice: 100,
    adjFactor: 1,
    anchorForming: false,
    anchorSource: 'prompt_bar',
    atr: 2,
    preCloses: [100],
    anchorBar: bar(100, 101, 99, 100),
    forward,
    ...over,
});

/** `base` with the bars at `at` replaced. */
const withBars = (
    base: readonly OutcomeBarTuple[],
    at: Readonly<Record<number, OutcomeBarTuple>>
): OutcomeBarTuple[] => base.map((b, i) => at[i] ?? b);

describe('evaluateLevel', () => {
    const touchHold = withBars(flat(20), { 0: bar(98, 98, 96, 97.5) });
    const cases: readonly {
        name: string;
        side: LevelSide;
        price: number;
        window: OutcomeWindow;
        expected: HeldOutcome;
    }[] = [
        {
            name: 'a support nobody reaches',
            side: 'support',
            price: 96,
            window: windowOf(flat(20)),
            expected: 'untouched',
        },
        {
            name: 'a touch followed by a close 0.5 ATR back',
            side: 'support',
            price: 96,
            window: windowOf(touchHold),
            expected: 'respected',
        },
        {
            name: 'a touch followed by a close through the barrier',
            side: 'support',
            price: 96,
            window: windowOf(withBars(flat(20), { 0: bar(97, 97, 96, 94.5) })),
            expected: 'broken',
        },
        {
            name: 'an open beyond the barrier (a gap)',
            side: 'support',
            price: 96,
            window: windowOf(
                withBars(flat(20), { 0: bar(94.5, 96.5, 94, 96) })
            ),
            expected: 'broken',
        },
        {
            name: 'ten follow bars with no event',
            side: 'support',
            price: 96,
            window: windowOf(
                Array.from({ length: 20 }, () => bar(96.5, 96.6, 96, 96.5))
            ),
            expected: 'inconclusive',
        },
        {
            name: 'a touch the window ends before it resolves',
            side: 'support',
            price: 96,
            window: windowOf(
                Array.from({ length: 5 }, (_, i) =>
                    i < 2 ? bar(99, 99.5, 98.5, 99) : bar(96.5, 96.6, 96, 96.5)
                )
            ),
            expected: 'touched_late',
        },
        {
            name: 'a resistance that holds',
            side: 'resistance',
            price: 104,
            window: windowOf(
                withBars(flat(20), { 0: bar(102, 104, 102, 102.5) })
            ),
            expected: 'respected',
        },
        {
            name: 'a resistance that breaks',
            side: 'resistance',
            price: 104,
            window: windowOf(
                withBars(flat(20), { 0: bar(103, 104, 103, 105.5) })
            ),
            expected: 'broken',
        },
        {
            name: 'a support above the reference price',
            side: 'support',
            price: 101,
            window: windowOf(flat(20)),
            expected: 'skipped',
        },
        {
            name: 'a level closer than 0.25 ATR',
            side: 'support',
            price: 99.6,
            window: windowOf(flat(20)),
            expected: 'skipped',
        },
        {
            name: 'a window without an ATR',
            side: 'support',
            price: 96,
            window: windowOf(flat(20), { atr: null }),
            expected: 'skipped',
        },
        {
            name: 'a non-positive price, which no bar reaches',
            side: 'support',
            price: -5,
            window: windowOf(flat(20)),
            expected: 'untouched',
        },
    ];

    it.each(cases)('$name', ({ side, price, window, expected }) => {
        expect(evaluateLevel(side, price, window)).toBe(expected);
        // The instrument's own copy must agree with the labeller it measures.
        expect(labelLevelOutcome({ side, price }, window).outcome).toBe(
            expected
        );
    });

    it('sweeps the barrier: a close 0.5 ATR back is not a hold at 1 ATR', () => {
        const window = windowOf(
            Array.from({ length: 20 }, (_, i) =>
                i === 0 ? bar(98, 98, 96, 97.5) : bar(97.5, 97.8, 97.2, 97.5)
            )
        );
        expect(evaluateLevel('support', 96, window, 0.5)).toBe('respected');
        expect(evaluateLevel('support', 96, window, 1)).toBe('inconclusive');
    });
});

describe('the date transplant', () => {
    it('puts the same distance in ATR on the same side of another reference price', () => {
        const other = windowOf(flat(20), { referencePrice: 50, atr: 1 });
        expect(transplantPrice('support', 2, other)).toBe(48);
        expect(transplantPrice('resistance', 2, other)).toBe(52);
    });

    it('hashes symbol, day, side and rank', () => {
        expect(levelHash('AAA', 300, 'support', 1)).toBe(
            BigInt(`0x${sha256Hex('AAA|300|support|1')}`)
        );
        expect(levelHash('AAA', 300, 'support', 1)).not.toBe(
            levelHash('AAA', 300, 'support', 2)
        );
    });

    it('draws partners within 250 bars, excluding the day itself, and none below three', () => {
        const days = [100, 200, 300, 400, 900];
        expect(partnerDays(300, days)).toEqual([100, 200, 400]);
        expect(partnerDays(900, days)).toEqual([]);
        expect(partnerDays(300, [300, 310, 320])).toEqual([]);
        // A day within the real level's forward window and follow bars shares its outcome window.
        expect(
            partnerDays(300, [100, 200, 260, 270, 299, 301, 330, 340, 400])
        ).toEqual([100, 200, 260, 340, 400]);
        expect(partnerDays(300, [100, 200, 260, 299, 301, 340])).toEqual([
            100, 200, 260, 340,
        ]);
        expect(partnerDays(300, [100, 299, 301, 330])).toEqual([]);
    });

    it('shifts the whole hash right by 16 bits per pick, as the design did', () => {
        const partners = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
        const hash = 1n | (2n << 16n) | (3n << 32n);
        // 12885032961 % 10 = 1, (hash >> 16) = 196610 % 10 = 0, (hash >> 32) = 3.
        expect(transplantPicks(hash, partners)).toEqual([20, 10, 40]);
        expect(transplantPicks(0n, partners)).toEqual([10, 10, 10]);
        expect(transplantPicks(hash, [])).toEqual([]);
    });
});

describe('levelFeaturesAt', () => {
    const bars: Bar[] = tradingBars({
        symbol: 'AAA',
        startIso: '2018-01-02',
        count: 760,
        close: i =>
            100 + 0.04 * i + 9 * Math.sin(i / 6) + 3 * Math.sin(i / 2.3),
    });
    const t = 560;

    it('prints levels on the right side of the close with positive distances', () => {
        const day = levelFeaturesAt(bars, t, { symbol: 'AAA', market: 'us' });
        expect(day).not.toBeNull();
        expect(day?.levels.length).toBeGreaterThan(10);
        day?.levels.forEach(level => {
            expect(level.dAtr).toBeGreaterThan(0);
            expect(
                level.side === 'support'
                    ? level.price < (day?.close ?? 0)
                    : level.price > (day?.close ?? 0)
            ).toBe(true);
            expect(level.kinds).toBeGreaterThanOrEqual(1);
            expect(level.nearN).toBeGreaterThanOrEqual(level.kinds);
        });
        expect(day?.nonPositive.horizons).toBe(0);
    });

    it('reads nothing after the study day: poisoned future bars change no feature', () => {
        const clean = levelFeaturesAt(bars, t, { symbol: 'AAA', market: 'us' });
        const poisoned = bars.map((b, i) =>
            i <= t
                ? b
                : {
                      time: b.time,
                      open: Number.NaN,
                      high: Number.NaN,
                      low: Number.NaN,
                      close: Number.NaN,
                      volume: Number.NaN,
                  }
        );
        const same = levelFeaturesAt(poisoned, t, {
            symbol: 'AAA',
            market: 'us',
        });
        expect(clean).not.toBeNull();
        expect(JSON.stringify(same)).toBe(JSON.stringify(clean));
    });

    it('is null when the close is not usable', () => {
        const broken = bars.map((b, i) => (i === t ? { ...b, close: 0 } : b));
        expect(
            levelFeaturesAt(broken, t, { symbol: 'AAA', market: 'us' })
        ).toBeNull();
    });

    it('measures forward returns from the study day', () => {
        const day = levelFeaturesAt(bars, t, { symbol: 'AAA', market: 'us' });
        expect(day).not.toBeNull();
        if (day === null) return;
        const row = toDayRow(day, bars);
        expect(row).not.toHaveProperty('levels');
        expect(row.ret10).toBeCloseTo(
            (bars[t + 10].close / bars[t].close - 1) * 100
        );
        expect(forwardReturns(bars, bars.length - 5).ret10).toBeNull();
        expect(forwardReturns(bars, bars.length - 5).ret20).toBeNull();
    });
});

// ─── Rows ─────────────────────────────────────────────────────────────────────

const T0 = Date.UTC(2020, 5, 1) / 1000;
const DAY = 86_400;

const featuresOf = (over: Partial<LevelFeatures> = {}): LevelFeatures => ({
    side: 'support',
    rank: 0,
    kind: 'ma',
    family: 'ma',
    price: 95,
    dAtr: 1,
    kinds: 1,
    nearN: 1,
    episodes: 0,
    reactions: 0,
    lastTouchAgo: null,
    volRatio: 1,
    ...over,
});

const rowOf = (over: Partial<LevelRow> = {}): LevelRow => {
    const time = over.time ?? T0;
    return {
        ...featuresOf(),
        symbol: 'AAA',
        market: 'us',
        t: 300,
        time,
        week: isoWeekKey(time),
        outcome: 'respected',
        shift: ['respected', 'broken'],
        transplant: ['respected', 'broken', 'broken'],
        ...over,
    };
};

const resamplingOf = (rows: readonly LevelRow[]) =>
    makeResamplings([...new Set(rows.map(r => r.week))].toSorted());

describe('groupStat', () => {
    const rows = [
        rowOf({ time: T0 }),
        rowOf({ time: T0 + 7 * DAY, outcome: 'respected' }),
        rowOf({ time: T0 + 14 * DAY, outcome: 'broken' }),
        rowOf({ time: T0 + 21 * DAY, outcome: 'skipped', transplant: [] }),
        rowOf({ time: T0 + 28 * DAY, outcome: 'untouched' }),
    ];

    it('counts resolved touches against the transplant of the same levels', () => {
        const stat = groupStat(rows, resamplingOf(rows));
        // 'skipped' is out; 'untouched' is a level but not a resolved touch.
        expect(stat.levels).toBe(4);
        expect(stat.held).toEqual({ n: 3, share: 2 / 3 });
        // Four live levels, three placebo draws each, one in three respected.
        expect(stat.transplant).toEqual({ n: 12, share: 4 / 12 });
        expect(stat.difference.mean).toBeCloseTo(2 / 3 - 1 / 3);
        expect(stat.shiftFar.share).toBe(1);
        expect(stat.shiftClose.share).toBe(0);
    });

    it('gives null, never 0, for a group with no resolved touch', () => {
        const none = [rowOf({ outcome: 'untouched', transplant: [] })];
        const stat = groupStat(none, resamplingOf(none));
        expect(stat.held).toEqual({ n: 0, share: null });
        expect(stat.transplant.share).toBeNull();
        expect(stat.difference.mean).toBeNull();
    });

    it('splits a table by key, keys sorted', () => {
        const table = groupTable(
            [
                rowOf({ side: 'resistance' }),
                rowOf({ side: 'support' }),
                rowOf({ side: 'support', outcome: 'broken' }),
            ],
            r => r.side,
            resamplingOf(rows)
        );
        expect(Object.keys(table)).toEqual(['resistance', 'support']);
        expect(table.support.held).toEqual({ n: 2, share: 0.5 });
    });
});

describe('heldTables and touchRateByDistance', () => {
    const rows = [
        rowOf({ family: 'fib', dAtr: 0.3, volRatio: null, lastTouchAgo: 3 }),
        rowOf({
            family: 'pivot',
            dAtr: 1.2,
            kinds: 9,
            episodes: 8,
            reactions: 5,
            lastTouchAgo: 30,
        }),
        rowOf({
            family: 'pivot',
            dAtr: 7,
            volRatio: 3,
            lastTouchAgo: 90,
            market: 'kr',
            time: T0 + 2000 * DAY,
        }),
        rowOf({ outcome: 'untouched', transplant: [], dAtr: 0.3 }),
    ];

    it('has every table of the brief, capping the saturating keys', () => {
        const tables = heldTables(rows, resamplingOf(rows));
        expect(Object.keys(tables).toSorted()).toEqual([
            'distanceAtr',
            'episodes',
            'family',
            'half',
            'kinds',
            'market',
            'reactions',
            'recency',
            'side',
            'volumeQuintile',
        ]);
        expect(Object.keys(tables.kinds)).toContain(String(C.kindsCap));
        expect(Object.keys(tables.episodes)).toContain(String(C.episodesCap));
        expect(Object.keys(tables.reactions)).toContain(String(C.reactionsCap));
        expect(Object.keys(tables.distanceAtr)).toContain('3.0');
        expect(Object.keys(tables.recency).toSorted()).toEqual([
            '<=5',
            '<=60',
            '>60',
            'none',
        ]);
        expect(tables.market.kr.levels).toBe(1);
        expect(tables.half['2022+'].levels).toBe(1);
    });

    it('reads how often a level is reached, by distance', () => {
        const rates = touchRateByDistance(rows);
        expect(rates['0.0']).toEqual({ n: 2, share: 0.5 });
        expect(rates['3.0']).toBeUndefined();
    });
});

describe('numerics', () => {
    it('cuts quantile edges and bands a value by the edges below it', () => {
        const edges = quantileEdges([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
        expect(edges).toHaveLength(4);
        expect(bandOf(0, edges)).toBe(0);
        expect(bandOf(5.5, edges)).toBe(2);
        expect(bandOf(11, edges)).toBe(4);
        expect(quantileEdges([], 5)).toEqual([]);
    });

    it('solves a small linear system', () => {
        expect(
            solveLinear(
                [
                    [2, 1],
                    [1, 3],
                ],
                [5, 10]
            ).map(v => Math.round(v * 1e9) / 1e9)
        ).toEqual([1, 3]);
    });

    it('computes the rank AUC with ties sharing their rank', () => {
        expect(auc([0.1, 0.2, 0.8, 0.9], [false, false, true, true])).toBe(1);
        expect(auc([0.1, 0.2, 0.8, 0.9], [true, true, false, false])).toBe(0);
        expect(auc([0.5, 0.5, 0.5, 0.5], [true, false, true, false])).toBe(0.5);
        expect(auc([0.1, 0.9], [true, true])).toBeNull();
    });

    it('computes Spearman, null without variance or pairs', () => {
        expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
        expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
        expect(spearman([1, 1, 1, 1], [1, 2, 3, 4])).toBeNull();
        expect(spearman([1, 2], [1, 2])).toBeNull();
    });

    it('meanRanks gives ties the mean of the ranks they span, in input order', () => {
        expect(meanRanks([30, 10, 20, 10, 30, 30])).toEqual([
            5, 1.5, 3, 1.5, 5, 5,
        ]);
        expect(meanRanks([])).toEqual([]);
    });

    it('meanRanks refuses a non-finite value, and auc and spearman then are not computable', () => {
        [Number.NaN, Infinity, -Infinity].forEach(bad => {
            expect(() => meanRanks([1, bad, 3])).toThrow(/finite/);
            expect(auc([0.1, bad, 0.9], [false, true, true])).toBeNull();
            expect(spearman([1, 2, bad], [1, 2, 3])).toBeNull();
            expect(spearman([1, 2, 3], [1, bad, 3])).toBeNull();
        });
    });

    it('meanRanks scans each tie group once: at most 2n comparisons, whatever the ties', () => {
        // The group search used to restart from 0 for every group: about n^2 / 2 comparisons
        // for distinct values. The bound is a count, not a clock.
        const n = 5000;
        const inputs = {
            distinct: Array.from({ length: n }, (_, i) => (i * 7919) % n),
            allTies: Array.from({ length: n }, () => 3),
            mixed: Array.from({ length: n }, (_, i) => Math.floor(i / 7) % 40),
        };
        Object.values(inputs).forEach(values => {
            expect(meanRanksWithCost(values).comparisons).toBeLessThanOrEqual(
                2 * n
            );
        });
        const { ranks } = meanRanksWithCost(inputs.distinct);
        expect(ranks[inputs.distinct.indexOf(0)]).toBe(1);
        expect(ranks[inputs.distinct.indexOf(n - 1)]).toBe(n);
        expect(meanRanks(inputs.allTies)[0]).toBe((n + 1) / 2);
    });

    it('fits a logistic model that recovers the sign of a planted effect', () => {
        const random = mulberry32(7);
        const x = Array.from({ length: 600 }, () => [1, random() * 2 - 1]);
        const y = x.map(row =>
            random() < 1 / (1 + Math.exp(-3 * row[1])) ? 1 : 0
        );
        const w = fitLogistic(x, y);
        expect(w[1]).toBeGreaterThan(1.5);
        expect(Math.abs(w[0])).toBeLessThan(0.6);
    });

    it('names its features with the family dummies after the first family', () => {
        expect(featureNames(['a', 'b', 'c']).slice(-2)).toEqual([
            'fam=b',
            'fam=c',
        ]);
    });
});

describe('scoreSummary', () => {
    const random = mulberry32(11);
    const makeRows = (
        count: number,
        start: number,
        signal: boolean,
        spacingDays = 1
    ): LevelRow[] =>
        Array.from({ length: count }, (_, i) => {
            const kinds = 1 + Math.floor(random() * 4);
            const held = signal ? kinds >= 3 : random() < 0.5;
            return rowOf({
                time: start + i * spacingDays * DAY,
                kinds,
                volRatio: 0.5 + random() * 1.5,
                outcome: held ? 'respected' : 'broken',
                transplant: ['respected', 'broken'],
                market: i % 2 === 0 ? 'us' : 'kr',
            });
        });
    const train = (signal: boolean) =>
        makeRows(400, Date.UTC(2019, 0, 1) / 1000, signal);
    // Spread over four and a half years so both halves of the test period hold rows.
    const test = (signal: boolean) =>
        makeRows(400, Date.UTC(2022, 2, 1) / 1000, signal, 4);

    it('learns a planted signal and scores it out of sample', () => {
        const rows = [...train(true), ...test(true)];
        const summary = scoreSummary(rows, resamplingOf(rows));
        expect(summary?.aucTest).toBeGreaterThan(0.7);
        expect(summary?.trainRows).toBe(400);
        expect(summary?.testRows).toBe(400);
        expect(summary?.bandsTest).toHaveLength(C.scoreBands);
        expect(summary?.topMinusBottom?.mean).toBeGreaterThan(0.3);
        expect(summary?.edges).toHaveLength(C.scoreBands - 1);
        // The gain over the placebo holds in each market and each half, point estimates all positive.
        const byMarket = summary?.topMinusTransplantByMarket ?? {};
        const byHalf = summary?.topMinusTransplantByHalf ?? {};
        expect(Object.keys(byMarket)).toEqual(['us', 'kr']);
        expect(Object.keys(byHalf)).toEqual(['first', 'second']);
        [...Object.values(byMarket), ...Object.values(byHalf)].forEach(v =>
            expect(v ?? -1).toBeGreaterThan(0.2)
        );
    });

    it('finds nothing in noise: the top band does not beat its placebo', () => {
        const rows = [...train(false), ...test(false)];
        const summary = scoreSummary(rows, resamplingOf(rows));
        expect(summary?.aucTest).toBeLessThan(0.62);
        expect(summary?.aucTest).toBeGreaterThan(0.38);
        expect(summary?.topMinusTransplant?.low ?? 0).toBeLessThan(0.1);
    });

    it('keeps the embargo out of both periods and is null without a test period', () => {
        const embargoed = rowOf({
            time: C.splitTime - 5 * DAY,
            outcome: 'respected',
        });
        const rows = [...train(true), embargoed, ...test(true)];
        expect(scoreSummary(rows, resamplingOf(rows))?.trainRows).toBe(400);
        expect(scoreSummary(rows, resamplingOf(rows))?.testRows).toBe(400);
        const trainOnly = train(true);
        expect(scoreSummary(trainOnly, resamplingOf(trainOnly))).toBeNull();
    });

    it('reports the placebo gap by market and by half of the test period', () => {
        const rows = [...train(true), ...test(true)];
        const summary = scoreSummary(rows, resamplingOf(rows));
        expect(Object.keys(summary?.topMinusTransplantByMarket ?? {})).toEqual([
            'us',
            'kr',
        ]);
        expect(Object.keys(summary?.topMinusTransplantByHalf ?? {})).toEqual([
            'first',
            'second',
        ]);
    });
});

describe('the barrier sweep', () => {
    const window = windowOf(
        Array.from({ length: 20 }, (_, i) =>
            i === 0 ? bar(98, 98, 96, 97.5) : bar(97.5, 97.8, 97.2, 97.5)
        )
    );

    it('tallies the real outcome and the placebo draws at every barrier, for every group of the level', () => {
        const tallies = new Map<string, RobustTally>();
        const row = rowOf({ price: 96, dAtr: 2 });
        addRobust(tallies, row, window, [window, window]);
        // Barrier 0.5: real respected, both placebo draws respected. Barrier 1: all inconclusive.
        expect(tallies.get('0.5|all')).toEqual([1, 1, 2, 2]);
        expect(tallies.get('1|all')).toEqual([0, 0, 0, 0]);
        expect(robustGroups(row)).toContain('fam=ma');
        expect(tallies.has('0.5|side=support')).toBe(true);
    });

    it('prints only groups with enough resolved levels', () => {
        const rows = robustRows(
            new Map<string, RobustTally>([
                ['0.5|all', [300, 600, 280, 600]],
                ['0.5|fam=x', [1, 2, 1, 2]],
            ])
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ barrierAtr: 0.5, group: 'all' });
        expect(rows[0].difference).toBeCloseTo(20 / 600);
    });
});

describe('labelDay', () => {
    it('labels with the labeller, draws the placebo from the partner windows and counts disagreements', () => {
        const window = windowOf(
            withBars(flat(20), { 0: bar(98, 98, 96, 97.5) })
        );
        const other = windowOf(flat(20, 200), { referencePrice: 200, atr: 4 });
        const day: DayFeatures = {
            symbol: 'AAA',
            market: 'us',
            t: 300,
            time: T0,
            close: 100,
            atr: 2,
            rr: null,
            nonPositive: { horizons: 0, printed: 0, fibOverlay: 0, labels: [] },
            levels: [
                featuresOf({ price: 96, dAtr: 2 }),
                featuresOf({ price: 101, dAtr: 0.5, rank: 1 }),
            ],
        };
        const windows = new Map([
            [310, other],
            [320, other],
            [330, other],
        ]);
        const { rows, disagreements } = labelDay(
            day,
            window,
            windows,
            [310, 320, 330]
        );
        expect(rows[0].outcome).toBe('respected');
        expect(rows[0].transplant).toHaveLength(3);
        // Another day on which the transplanted level (192) is never reached.
        expect(rows[0].transplant.every(o => o === 'untouched')).toBe(true);
        expect(rows[1].outcome).toBe('skipped');
        expect(rows[1].transplant).toEqual([]);
        expect(rows[0].week).toBe(isoWeekKey(T0));
        expect(disagreements).toBe(0);
    });
});

describe('labeller and evaluator disagreement', () => {
    it('counts a real level the two label differently', () => {
        const window = windowOf(
            withBars(flat(20), { 0: bar(98, 98, 96, 97.5) })
        );
        const day: DayFeatures = {
            symbol: 'AAA',
            market: 'us',
            t: 300,
            time: T0,
            close: 100,
            atr: 2,
            rr: null,
            nonPositive: { horizons: 0, printed: 0, fibOverlay: 0, labels: [] },
            levels: [featuresOf({ price: 96, dAtr: 2 })],
        };
        expect(labelDay(day, window, new Map(), []).disagreements).toBe(0);
        force.on = true;
        expect(labelDay(day, window, new Map(), []).disagreements).toBe(1);
    });
});

describe('structural ratio and non-positive levels', () => {
    const rr = (over: Partial<RrAnchors> = {}): RrAnchors => ({
        horizon: 'short',
        upKind: 'pivot_standard',
        downKind: 'round',
        ratio: 1,
        upAtr: 0.5,
        downAtr: 0.5,
        ...over,
    });
    const day = (over: Partial<ReturnType<typeof toDayRow>> = {}) => ({
        symbol: 'AAA',
        market: 'us' as const,
        t: 300,
        time: T0,
        close: 100,
        atr: 2,
        rr: rr(),
        nonPositive: { horizons: 0, printed: 0, fibOverlay: 0, labels: [] },
        ret10: 1,
        ret20: 2,
        ...over,
    });

    it('summarises the anchors, the ratio and what it says about the next ten sessions', () => {
        const summary = structuralSummary([
            day({ rr: rr({ ratio: 0.5 }), ret10: 3 }),
            day({ rr: rr({ ratio: 1 }), ret10: 1 }),
            day({ rr: rr({ ratio: 2, upKind: 'camarilla' }), ret10: -1 }),
            day({ rr: null }),
        ]);
        expect(summary.days).toBe(4);
        expect(summary.measurable).toBe(3);
        expect(summary.ratioMedian).toBe(1);
        expect(summary.ratioBelowOne).toBeCloseTo(1 / 3);
        expect(summary.anchorShare.pivot_standard).toBeCloseTo(2 / 6);
        expect(summary.anchorShare.round).toBeCloseTo(3 / 6);
        expect(summary.forward10ByBand['<0.67'].n).toBe(1);
        expect(summary.forward10ByBand['>=1.5'].mean).toBe(-1);
        expect(summary.spearmanRet10).toBeCloseTo(-1);
        expect(summary.horizons).toEqual({ short: 3 });
    });

    it('counts non-positive levels by surface and names them', () => {
        const summary = nonPositiveSummary([
            day(),
            day({
                symbol: 'BBB',
                nonPositive: {
                    horizons: 1,
                    printed: 1,
                    fibOverlay: 2,
                    labels: ['long:Fib ext 161.8%:-3.0000'],
                },
            }),
        ]);
        expect(summary).toMatchObject({
            days: 2,
            daysWithHorizonLevel: 1,
            daysWithPrintedLevel: 1,
            daysWithFibOverlayLevel: 1,
            total: 4,
            share: 0.5,
            symbols: ['BBB'],
            labels: { 'Fib ext 161.8%': 1 },
        });
        expect(nonPositiveSummary([]).share).toBeNull();
    });

    it('anchors on the tightest horizon with a level beyond the noise band on both sides', () => {
        const level = (
            price: number,
            distancePercent: number,
            kind: ReferenceLevel['kind'],
            atPrice = false
        ): ReferenceLevel => ({
            price,
            label: kind,
            kind,
            distancePercent,
            ...(atPrice ? { atPrice: true as const } : {}),
        });
        const horizon = (
            support: ReferenceLevel[],
            resistance: ReferenceLevel[]
        ) => ({ levels: { support, resistance } });
        const anchors = structuralAnchors(
            {
                short: horizon(
                    [level(99.9, -0.1, 'ma', true)],
                    [level(100.1, 0.1, 'ma')]
                ),
                medium: horizon(
                    [level(98, -2, 'round'), level(97, -3, 'ma')],
                    [level(103, 3, 'pivot_standard')]
                ),
                long: horizon([], []),
            },
            0.5,
            100,
            2
        );
        expect(anchors).toMatchObject({
            horizon: 'medium',
            upKind: 'pivot_standard',
            downKind: 'round',
            ratio: 1.5,
            upAtr: 1.5,
            downAtr: 1,
        });
    });
});
