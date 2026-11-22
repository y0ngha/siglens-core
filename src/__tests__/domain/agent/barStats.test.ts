import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
    computeBarChangeStats,
    type BarChangeStatsIndicators,
    computeBarRangeStats,
    computeCloseStreak,
    computeEarningsReactions,
    LONG_TERM_MA_CROSS,
    scanLongTermMaCrosses,
} from '@/domain/agent/barStats';
import { findMaCrosses } from '@/domain/indicators/maCrosses';
import type { Bar } from '@/domain/types';
import {
    BAR_STATS_CORPUS_SIZE,
    makeBarStatsCorpus,
} from '@/__tests__/fixtures/barStatsCorpus';

const DAY = 86_400;
const T0 = Math.floor(Date.UTC(2026, 9, 5) / 1000);

function bar(time: number, close: number, extra: Partial<Bar> = {}): Bar {
    return {
        time,
        open: close,
        high: close,
        low: close,
        close,
        volume: 1,
        ...extra,
    };
}

const dailyBars = (closes: readonly number[]): Bar[] =>
    closes.map((close, i) => bar(T0 + i * DAY, close));

describe('computeBarRangeStats', () => {
    // high 130 (bar 1), low 80 (bar 2), highClose 120 (bar 1), lowClose 90 (bar 2)
    const window = [
        bar(T0, 100, { high: 105, low: 95 }),
        bar(T0 + DAY, 120, { high: 130, low: 100 }),
        bar(T0 + 2 * DAY, 90, { high: 110, low: 80 }),
        bar(T0 + 3 * DAY, 110, { high: 115, low: 105 }),
    ];

    it('returns the four extremes with the bar time and unrounded distances', () => {
        const stats = computeBarRangeStats(window, 110);
        expect(stats.high).toEqual({
            value: 130,
            time: T0 + DAY,
            fromLastCloseRatio: (110 - 130) / 130,
        });
        expect(stats.low).toEqual({
            value: 80,
            time: T0 + 2 * DAY,
            fromLastCloseRatio: (110 - 80) / 80,
        });
        expect(stats.highClose).toEqual({
            value: 120,
            time: T0 + DAY,
            fromLastCloseRatio: (110 - 120) / 120,
        });
        expect(stats.lowClose).toEqual({
            value: 90,
            time: T0 + 2 * DAY,
            fromLastCloseRatio: (110 - 90) / 90,
        });
    });

    it('resolves a tie to the most recent bar', () => {
        const tied = [
            bar(T0, 120, { high: 130, low: 80 }),
            bar(T0 + DAY, 100, { high: 110, low: 90 }),
            bar(T0 + 2 * DAY, 120, { high: 130, low: 80 }),
            bar(T0 + 3 * DAY, 100, { high: 110, low: 90 }),
        ];
        const stats = computeBarRangeStats(tied, 100);
        expect(stats.high?.time).toBe(T0 + 2 * DAY);
        expect(stats.low?.time).toBe(T0 + 2 * DAY);
        expect(stats.highClose?.time).toBe(T0 + 2 * DAY);
        expect(stats.lowClose?.time).toBe(T0 + 3 * DAY);
    });

    it('ignores a non-finite bar so one glitch does not poison the window', () => {
        const glitched = [
            bar(T0, 100, { high: 119, low: 90 }),
            bar(T0 + DAY, 100, {
                high: Number.NaN,
                low: Number.NEGATIVE_INFINITY,
            }),
            bar(T0 + 2 * DAY, Number.NaN, { high: Number.POSITIVE_INFINITY }),
        ];
        const stats = computeBarRangeStats(glitched, 100);
        expect(stats.high?.value).toBe(119);
        expect(stats.low?.value).toBe(90);
        expect(stats.highClose?.value).toBe(100);
    });

    it('gives null extremes when no bar has a finite value', () => {
        const none = [
            bar(T0, Number.NaN, {
                high: Number.NaN,
                low: Number.NaN,
            }),
        ];
        expect(computeBarRangeStats(none, 100)).toEqual({
            high: null,
            low: null,
            highClose: null,
            lowClose: null,
        });
        expect(computeBarRangeStats([], 100).high).toBeNull();
    });

    it('nulls every distance for a missing, non-finite or non-positive reference', () => {
        const ratios = (lastClose: number | null) => {
            const s = computeBarRangeStats(window, lastClose);
            return [s.high, s.low, s.highClose, s.lowClose].map(
                e => e?.fromLastCloseRatio
            );
        };
        expect(ratios(null)).toEqual([null, null, null, null]);
        expect(ratios(Number.NaN)).toEqual([null, null, null, null]);
        expect(ratios(Number.POSITIVE_INFINITY)).toEqual([
            null,
            null,
            null,
            null,
        ]);
    });

    it('nulls the distance (not the extreme) when the extreme itself is not above zero', () => {
        const stats = computeBarRangeStats(
            [bar(T0, 0, { high: 0, low: -5 })],
            10
        );
        expect(stats.high).toEqual({
            value: 0,
            time: T0,
            fromLastCloseRatio: null,
        });
        expect(stats.low?.fromLastCloseRatio).toBeNull();
    });
});

describe('computeCloseStreak', () => {
    const streak = (closes: readonly number[], excludeLastBar = false) =>
        computeCloseStreak(dailyBars(closes), { excludeLastBar });
    const timeOf = (index: number) => T0 + index * DAY;

    it('counts a falling run: 10,9,8 is down 2, since the first down day', () => {
        expect(streak([10, 9, 8])).toEqual({
            direction: 'down',
            days: 2,
            sinceTime: timeOf(1),
            truncated: true,
        });
    });

    it('counts a rising run that began after a down day', () => {
        expect(streak([5, 4, 5, 6, 7])).toEqual({
            direction: 'up',
            days: 3,
            sinceTime: timeOf(2),
            truncated: false,
        });
    });

    it('reads one down day after a rise as down 1, not no streak', () => {
        expect(streak([8, 9, 10, 9])).toEqual({
            direction: 'down',
            days: 1,
            sinceTime: timeOf(3),
            truncated: false,
        });
    });

    it('reports flat with the run of unchanged closes', () => {
        expect(streak([9, 10, 10, 10])).toEqual({
            direction: 'flat',
            days: 2,
            sinceTime: timeOf(2),
            truncated: false,
        });
    });

    it('leaves the forming last bar out', () => {
        expect(streak([10, 9, 8, 50], true)).toEqual({
            direction: 'down',
            days: 2,
            sinceTime: timeOf(1),
            truncated: true,
        });
    });

    it('marks truncated only when the run reaches the first loaded bar', () => {
        expect(streak([10, 9, 8])?.truncated).toBe(true);
        expect(streak([9, 10, 9, 8])).toMatchObject({
            days: 2,
            truncated: false,
        });
    });

    it('does not check bar spacing: non-daily bars are counted like daily ones', () => {
        // The caller owns the 1Day gate; hourly bars with gaps still produce a streak.
        const hourly = [10, 9, 8].map((close, i) =>
            bar(T0 + i * 3600 * (i + 1), close)
        );
        expect(computeCloseStreak(hourly, { excludeLastBar: false })).toEqual({
            direction: 'down',
            days: 2,
            sinceTime: hourly[1]!.time,
            truncated: true,
        });
    });

    it('returns null with fewer than 2 completed bars', () => {
        expect(streak([])).toBeNull();
        expect(streak([10])).toBeNull();
        expect(streak([10, 9], true)).toBeNull();
    });

    it('returns null when a non-finite close sits inside the walked run', () => {
        expect(streak([10, Number.NaN, 8])).toBeNull();
        expect(streak([10, 9, Number.NaN])).toBeNull();
        expect(streak([10, 9, 8, Number.POSITIVE_INFINITY])).toBeNull();
    });

    it('does not mind a non-finite close beyond the walked run', () => {
        // The streak breaks at the 10 → 11 move, before the NaN is reached.
        expect(streak([Number.NaN, 10, 11, 9, 8])).toMatchObject({
            direction: 'down',
            days: 2,
            truncated: false,
        });
        // A NaN right at the boundary of the run hides where the run starts.
        expect(streak([Number.NaN, 10, 9, 8])).toBeNull();
    });
});

describe('scanLongTermMaCrosses / LONG_TERM_MA_CROSS', () => {
    it('is findMaCrosses with the 50/200/252 parameters, unchanged', () => {
        const closes = Array.from({ length: 600 }, (_, i) =>
            Math.round(100 + 40 * Math.sin(i / 25))
        );
        const series = dailyBars(closes);
        expect(LONG_TERM_MA_CROSS).toEqual({
            fast: 50,
            slow: 200,
            lookbackBars: 252,
        });
        const scan = scanLongTermMaCrosses(series);
        expect(scan).toEqual(findMaCrosses(series.slice(), 50, 200, 252));
        expect(scan.complete).toBe(true);
        expect(scan.crosses.length).toBeGreaterThan(0);
    });

    it('is incomplete when the history cannot cover the whole window', () => {
        const scan = scanLongTermMaCrosses(dailyBars(Array(300).fill(100)));
        expect(scan.complete).toBe(false);
        expect(scan.crosses).toEqual([]);
    });

    it('does not mutate the input array', () => {
        const series = dailyBars([1, 2, 3]);
        const copy = series.slice();
        scanLongTermMaCrosses(series);
        expect(series).toEqual(copy);
    });
});

describe('computeBarChangeStats', () => {
    const BARS_BACK = { '1bar': 1, '5bars': 5 } as const;
    const noIndicators: BarChangeStatsIndicators = {
        atr: [],
        ma: {},
        ema: {},
    };
    const stats = (
        series: readonly Bar[],
        indicators = noIndicators,
        partialPeriod = false
    ) =>
        computeBarChangeStats(series, indicators, {
            barsBack: BARS_BACK,
            partialPeriod,
        });

    it('measures change over a fixed number of bars, unrounded', () => {
        const s = stats(dailyBars([100, 101, 102, 103, 104, 110]));
        expect(s.lastClose).toBe(110);
        expect(s.changeRatio['1bar']).toBe((110 - 104) / 104);
        expect(s.changeRatio['5bars']).toBe((110 - 100) / 100);
    });

    it('needs MORE bars than the look-back, and a positive base', () => {
        expect(stats(dailyBars([100, 110, 120, 130, 140])).changeRatio).toEqual(
            { '1bar': (140 - 130) / 130, '5bars': null }
        );
        expect(stats(dailyBars([0, 5])).changeRatio['1bar']).toBeNull();
        expect(
            stats(dailyBars([100, Number.NaN])).changeRatio['1bar']
        ).toBeNull();
    });

    it('has null for everything on an empty series', () => {
        expect(stats([])).toEqual({
            lastClose: null,
            changeRatio: { '1bar': null, '5bars': null },
            volumeVsAvg20: null,
            atrRatio: null,
            ma50DistanceRatio: null,
            maDistanceRatio: {},
            emaDistanceRatio: {},
        });
    });

    describe('volumeVsAvg20', () => {
        const withVolumes = (volumes: readonly number[]): Bar[] =>
            volumes.map((v, i) => bar(T0 + i * DAY, 100, { volume: v }));
        const flat20 = Array(20).fill(100) as number[];

        it('is the last volume over the mean of the 20 bars before it', () => {
            expect(stats(withVolumes([...flat20, 250])).volumeVsAvg20).toBe(
                2.5
            );
        });

        it('is null with fewer than 20 prior bars, a bad volume, or a zero mean', () => {
            expect(
                stats(withVolumes([...flat20.slice(1), 250])).volumeVsAvg20
            ).toBeNull();
            expect(
                stats(withVolumes([Number.NaN, ...flat20.slice(1), 250]))
                    .volumeVsAvg20
            ).toBeNull();
            expect(
                stats(withVolumes([...flat20, Number.NaN])).volumeVsAvg20
            ).toBeNull();
            expect(
                stats(withVolumes([...Array(20).fill(0), 5])).volumeVsAvg20
            ).toBeNull();
        });

        it('is null for a partial week or month', () => {
            expect(
                stats(withVolumes([...flat20, 250]), noIndicators, true)
                    .volumeVsAvg20
            ).toBeNull();
        });
    });

    describe('atrRatio', () => {
        const series = dailyBars([100, 200]);
        const withAtr = (atr: (number | null)[]) => ({
            atr,
            ma: {},
            ema: {},
        });

        it('is the last ATR over the last close, not a distance from a base', () => {
            expect(stats(series, withAtr([null, 10])).atrRatio).toBe(10 / 200);
        });

        it('is null for a missing ATR or a non-positive / non-finite close', () => {
            expect(stats(series, withAtr([1, null])).atrRatio).toBeNull();
            expect(stats(series, withAtr([])).atrRatio).toBeNull();
            expect(stats(series, withAtr([1, Number.NaN])).atrRatio).toBeNull();
            expect(
                stats(dailyBars([100, 0]), withAtr([1, 1])).atrRatio
            ).toBeNull();
        });
    });

    describe('moving-average distances', () => {
        const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
        const series = dailyBars(closes);

        it('computes the 50-bar SMA distance from the bars, not from indicators', () => {
            const sma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
            expect(stats(series).ma50DistanceRatio).toBe((159 - sma50) / sma50);
        });

        it('is null without 50 bars', () => {
            expect(stats(dailyBars([1, 2, 3])).ma50DistanceRatio).toBeNull();
        });

        it('reports each configured SMA / EMA period, null for an empty or non-positive series', () => {
            const s = stats(series, {
                atr: [],
                ma: { 20: [null, 150], 200: [] },
                ema: { 12: [140, 0] },
            });
            expect(s.maDistanceRatio).toEqual({
                '20': (159 - 150) / 150,
                '200': null,
            });
            expect(s.emaDistanceRatio).toEqual({ '12': null });
        });
    });
});

describe('computeEarningsReactions', () => {
    // Thu 07-30, Fri 07-31, Mon 08-03, Tue 08-04.
    const day = (date: string): number =>
        Date.parse(`${date}T00:00:00Z`) / 1000;
    const bars = [
        bar(day('2026-07-30'), 100),
        bar(day('2026-07-31'), 110),
        bar(day('2026-08-03'), 99),
        bar(day('2026-08-04'), 120),
    ];
    const reactions = (
        dates: readonly string[],
        excludeLastBar = false,
        limit = 8,
        series: readonly Bar[] = bars
    ) => computeEarningsReactions(series, dates, { excludeLastBar, limit });

    it('spans the session before the report date to the session after it', () => {
        // Report on Fri 07-31 (a session): 07-30 close to 08-03 close.
        expect(reactions(['2026-07-31'])).toEqual([
            { date: '2026-07-31', moveRatio: (99 - 100) / 100 },
        ]);
    });

    it('uses the sessions around a report dated on a non-session day', () => {
        // Sat 08-01: 07-31 close to 08-03 close.
        expect(reactions(['2026-08-01'])).toEqual([
            { date: '2026-08-01', moveRatio: (99 - 110) / 110 },
        ]);
    });

    it('skips a date with no session after it', () => {
        expect(reactions(['2026-08-04', '2026-09-01'])).toEqual([]);
    });

    it('skips a report dated on the first loaded bar (no session before it)', () => {
        expect(reactions(['2026-07-30'])).toEqual([]);
        expect(reactions(['2026-07-01'])).toEqual([]);
    });

    it('does not treat a forming last bar as a close', () => {
        expect(reactions(['2026-08-03'], true)).toEqual([]);
        expect(reactions(['2026-07-31'], true)).toEqual([
            { date: '2026-07-31', moveRatio: (99 - 100) / 100 },
        ]);
        expect(reactions(['2026-08-03'], false)).toEqual([
            { date: '2026-08-03', moveRatio: (120 - 110) / 110 },
        ]);
    });

    it('gives a null move when a close is unusable', () => {
        const bad = [bar(day('2026-07-30'), 0), bar(day('2026-08-03'), 99)];
        expect(reactions(['2026-07-31'], false, 8, bad)).toEqual([
            { date: '2026-07-31', moveRatio: null },
        ]);
    });

    it('ignores bars whose time is not a usable timestamp instead of throwing', () => {
        const withBadTime = [
            bars[0]!,
            bar(Number.NaN, 5),
            bar(Number.POSITIVE_INFINITY, 5),
            bar(8.64e15, 5),
            bars[1]!,
            bars[2]!,
        ];
        expect(reactions(['2026-07-31'], false, 8, withBadTime)).toEqual(
            reactions(['2026-07-31'])
        );
        expect(
            reactions(['2026-07-31'], false, 8, [bar(Number.NaN, 1)])
        ).toEqual([]);
    });

    it('orders newest first, drops duplicates and applies the limit', () => {
        const long = Array.from({ length: 40 }, (_, i) =>
            bar(day('2026-01-01') + i * DAY, 100 + i)
        );
        const isoOf = (offset: number): string =>
            new Date((day('2026-01-01') + offset * DAY) * 1000)
                .toISOString()
                .slice(0, 10);
        const dates = Array.from({ length: 12 }, (_, i) => isoOf(2 + i * 3));
        const result = reactions([...dates, dates[0]!], false, 5, long);
        expect(result.map(r => r.date)).toEqual(
            dates.slice().reverse().slice(0, 5)
        );
    });
});

describe('parity corpus', () => {
    // The siglens implementations these functions were moved from
    // (`src/app/api/ai/chat/tools/getBarsIndicators.ts` and `earningsHistory.ts`
    // at siglens master 652d1fd17) were compared against this same seeded
    // corpus (see `fixtures/barStatsCorpus.ts`) with 0 mismatches after
    // siglens's rounding. This digest pins the raw core output for those
    // inputs. Changing it means the output changed: re-run the parity script
    // (kept as programme evidence) and update the digest in the same PR.
    const BAR_STATS_CORPUS_DIGEST =
        '32d0fd870a3ddf3692ac709ceb50319c98698cf4f5eaff7bd1a6605165d82ba0';

    it('keeps the five functions byte-stable over the seeded corpus', () => {
        const corpus = makeBarStatsCorpus();
        expect(corpus).toHaveLength(BAR_STATS_CORPUS_SIZE);
        const outputs = corpus.map(c => [
            computeBarRangeStats(c.bars, c.bars.at(-1)?.close ?? null),
            computeCloseStreak(c.bars, { excludeLastBar: c.lastBarForming }),
            scanLongTermMaCrosses(c.bars),
            computeBarChangeStats(c.bars, c.indicators, {
                barsBack: { '1bar': 1, '20bars': 20, '252bars': 252 },
                partialPeriod: c.lastBarForming,
            }),
            computeEarningsReactions(c.bars, c.reportedDates, {
                excludeLastBar: c.lastBarForming,
                limit: 8,
            }),
        ]);
        const digest = createHash('sha256')
            .update(JSON.stringify(outputs))
            .digest('hex');
        expect(digest).toBe(BAR_STATS_CORPUS_DIGEST);
    });

    it('leaks no NaN, Infinity or -0 into any numeric output', () => {
        const leaves = (value: unknown, path = ''): string[] =>
            typeof value === 'number'
                ? [`${path}=${value}`]
                : value !== null && typeof value === 'object'
                  ? Object.entries(value).flatMap(([k, v]) =>
                        leaves(v, `${path}.${k}`)
                    )
                  : [];
        const bad = makeBarStatsCorpus().flatMap(c => {
            const out = [
                computeBarRangeStats(c.bars, c.bars.at(-1)?.close ?? null),
                computeCloseStreak(c.bars, {
                    excludeLastBar: c.lastBarForming,
                }),
                computeBarChangeStats(c.bars, c.indicators, {
                    barsBack: { '1bar': 1, '20bars': 20, '252bars': 252 },
                    partialPeriod: c.lastBarForming,
                }),
                computeEarningsReactions(c.bars, c.reportedDates, {
                    excludeLastBar: c.lastBarForming,
                    limit: 8,
                }),
            ];
            // `lastClose` is the input echoed back as given (a defective last
            // bar shows up as NaN/Infinity there, as it always did); every
            // computed number must be finite.
            return leaves(out).filter(
                leaf =>
                    !leaf.includes('.lastClose=') &&
                    /=(NaN|-?Infinity|-0)$/.test(leaf)
            );
        });
        expect(bad).toEqual([]);
    });

    it('exercises both branches of the interesting paths', () => {
        const corpus = makeBarStatsCorpus();
        const streaks = corpus.map(c =>
            computeCloseStreak(c.bars, { excludeLastBar: c.lastBarForming })
        );
        const scans = corpus.map(c => scanLongTermMaCrosses(c.bars));
        expect(streaks.some(s => s !== null && s.truncated)).toBe(true);
        expect(streaks.some(s => s !== null && !s.truncated)).toBe(true);
        expect(streaks.some(s => s === null)).toBe(true);
        expect(scans.some(s => s.complete && s.crosses.length > 0)).toBe(true);
        expect(scans.some(s => !s.complete)).toBe(true);
    });
});
