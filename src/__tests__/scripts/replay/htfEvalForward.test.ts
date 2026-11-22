import { describe, expect, it } from 'vitest';
import type { TrendLabel } from '../../../../scripts/replay/analysisFieldsEvalTypes';
import {
    FORWARD_CONSTANTS,
    caseRow,
    m1Gate,
    observationsOf,
    summarizeCases,
    summarizeForward,
    type ForwardCell,
    type ForwardLabelers,
    type ForwardObservation,
} from '../../../../scripts/replay/htfEvalForward';
import type { ReplayCase } from '../../../../scripts/replay/types';
import { tradingBars } from './replayFixtures';

const bars = tradingBars({
    symbol: 'NVDA',
    startIso: '2019-01-02',
    count: 700,
    close: i => 100 + 0.3 * i + 10 * Math.sin(i / 13),
});

/** Labels from the window alone: bullish when it ended above its first close. */
const labelers: ForwardLabelers = {
    daily: w =>
        w.length < 40
            ? null
            : w[w.length - 1].close > w[0].close
              ? 'bullish'
              : 'bearish',
    weekly: w => (w.length < 40 ? null : 'neutral'),
};

describe('observationsOf', () => {
    it('measures from the registered first bar to ten sessions before the end, with the forward return', () => {
        const obs = observationsOf(bars, labelers);
        expect(obs).toHaveLength(bars.length - 10 - FORWARD_CONSTANTS.fromBar);
        const first = bars[FORWARD_CONSTANTS.fromBar];
        expect(obs[0].forward).toBeCloseTo(
            (bars[FORWARD_CONSTANTS.fromBar + 10].close / first.close - 1) *
                100,
            9
        );
        expect(obs[0].week).toMatch(/^\d{4}-W\d{2}$/);
    });

    it('feeds each labeler the calendar windows (730 and 1,830 days) ending at the day', () => {
        const seen: { daily: number; weekly: number }[] = [];
        observationsOf(bars, {
            daily: w => {
                seen.push({
                    daily: w[w.length - 1].time - w[0].time,
                    weekly: 0,
                });
                return 'neutral';
            },
            weekly: w => {
                seen[seen.length - 1].weekly = w[w.length - 1].time - w[0].time;
                return 'neutral';
            },
        });
        const last = seen[seen.length - 1];
        expect(last.daily).toBeLessThanOrEqual(730 * 86_400);
        expect(last.daily).toBeGreaterThan(700 * 86_400);
        expect(last.weekly).toBeGreaterThan(last.daily);
        expect(last.weekly).toBeLessThanOrEqual(1_830 * 86_400);
    });

    it('skips a day either label is not measurable and honours the stride', () => {
        const none = observationsOf(bars, {
            daily: () => null,
            weekly: () => 'neutral',
        });
        expect(none).toEqual([]);
        const all = observationsOf(bars, labelers).length;
        expect(observationsOf(bars, labelers, 5).length).toBe(
            Math.ceil(all / 5)
        );
    });
});

const cell = (
    daily: TrendLabel,
    weekly: TrendLabel,
    n: number,
    base: number
): ForwardObservation[] =>
    Array.from({ length: n }, (_, i) => ({
        week: `2020-W${String((i % 20) + 1).padStart(2, '0')}`,
        daily,
        weekly,
        forward: base + (i % 2 === 0 ? 0.5 : -0.5),
    }));

describe('summarizeForward', () => {
    it("reports each cell's excess over the all-day mean with a clustered interval", () => {
        const obs = [
            ...cell('bullish', 'bullish', 200, 5),
            ...cell('bearish', 'bearish', 200, -5),
            ...cell('neutral', 'neutral', 200, 0),
        ];
        const summary = summarizeForward(obs);
        expect(summary.days).toBe(600);
        expect(summary.weeks).toBe(20);
        expect(summary.allMeanPct).toBeCloseTo(0, 9);
        const bull = summary.cells.find(
            c => c.daily === 'bullish' && c.weekly === 'bullish'
        );
        expect(bull?.n).toBe(200);
        expect(bull?.excessPp).toBeCloseTo(5, 9);
        expect(bull?.low).toBeGreaterThan(4);
        expect(bull?.high).toBeLessThan(6);
        const empty = summary.cells.find(
            c => c.daily === 'bullish' && c.weekly === 'bearish'
        );
        expect(empty).toMatchObject({
            n: 0,
            meanForwardPct: null,
            excessPp: null,
            low: null,
            high: null,
        });
        expect(summarizeForward(obs)).toEqual(summary);
    });
});

describe('the aligned-minus-opposed contrasts', () => {
    it('reports, for each daily trend, how the aligned weekly cell differs from the opposed one', () => {
        const obs = [
            ...cell('bullish', 'bullish', 200, 3),
            ...cell('bullish', 'bearish', 200, 1),
            ...cell('bearish', 'bearish', 200, -2),
            ...cell('bearish', 'bullish', 200, 0),
        ];
        const [bull, bear] = summarizeForward(obs).contrasts;
        expect(bull.name).toMatch(/daily bullish/);
        expect(bull.differencePp).toBeCloseTo(2, 9);
        expect(bull.low).toBeGreaterThan(1);
        expect(bear.differencePp).toBeCloseTo(-2, 9);
        expect(bear.high).toBeLessThan(-1);
        const missing = summarizeForward(
            cell('bullish', 'bullish', 50, 1)
        ).contrasts;
        expect(missing[0]).toMatchObject({
            differencePp: null,
            low: null,
            high: null,
        });
    });
});

describe('M1', () => {
    const summaryOf = (
        bull: Partial<ForwardCell>,
        bear: Partial<ForwardCell>
    ) => ({
        days: 100,
        weeks: 10,
        allMeanPct: 0,
        replicates: 1,
        contrasts: [],
        cells: [
            {
                daily: 'bullish',
                weekly: 'bullish',
                n: 10,
                meanForwardPct: 0,
                excessPp: 0,
                low: -1,
                high: 1,
                ...bull,
            },
            {
                daily: 'bearish',
                weekly: 'bearish',
                n: 10,
                meanForwardPct: 0,
                excessPp: 0,
                low: -1,
                high: 1,
                ...bear,
            },
        ] satisfies ForwardCell[],
    });

    it('passes when neither aligned cell clears the margin in the textbook direction', () => {
        expect(m1Gate(summaryOf({}, {})).pass).toBe(true);
        // aligned bullish clearly below zero, aligned bearish clearly above: the opposite of the textbook
        expect(
            m1Gate(summaryOf({ low: -4, high: -2 }, { low: 2, high: 4 })).pass
        ).toBe(true);
        // an interval that excludes zero but not by the margin
        expect(m1Gate(summaryOf({ low: 0.4, high: 0.9 }, {})).pass).toBe(true);
    });

    it('treats a bound of exactly the margin as inside it, and one beyond as outside', () => {
        expect(m1Gate(summaryOf({ low: 1, high: 3 }, {})).pass).toBe(true);
        expect(m1Gate(summaryOf({ low: 1.0001, high: 3 }, {})).pass).toBe(
            false
        );
        expect(m1Gate(summaryOf({}, { low: -3, high: -1 })).pass).toBe(true);
        expect(m1Gate(summaryOf({}, { low: -3, high: -1.0001 })).pass).toBe(
            false
        );
    });

    it('says in its description that it gates two cells only', () => {
        expect(m1Gate(summaryOf({}, {})).description).toMatch(
            /neither aligned cell/
        );
        expect(m1Gate(summaryOf({}, {})).description).toMatch(
            /reported, not gated/
        );
    });

    it('fails when aligned bullish is above the margin or aligned bearish below it', () => {
        expect(m1Gate(summaryOf({ low: 1.2, high: 2 }, {})).pass).toBe(false);
        expect(m1Gate(summaryOf({}, { low: -3, high: -1.1 })).pass).toBe(false);
    });

    it('is not computable without observations, an empty aligned cell or an interval', () => {
        expect(m1Gate({ ...summaryOf({}, {}), days: 0 }).pass).toBeNull();
        expect(m1Gate(summaryOf({ n: 0 }, {})).pass).toBeNull();
        expect(m1Gate(summaryOf({ low: null }, {})).pass).toBeNull();
        expect(m1Gate(summaryOf({}, { high: null })).pass).toBeNull();
        expect(m1Gate({ ...summaryOf({}, {}), cells: [] }).pass).toBeNull();
    });
});

describe('the case table', () => {
    const asOfAt = (i: number): string =>
        new Date(bars[i].time * 1000).toISOString().slice(0, 10);
    const caseAt = (i: number): ReplayCase => ({
        caseId: `NVDA|${asOfAt(i)}`,
        symbol: 'NVDA',
        timeframe: '1Day',
        asOf: asOfAt(i),
        regime: 'range',
        variance: false,
    });

    it('reads the pair of trends, the weekly bar count and the unfinished week', () => {
        const row = caseRow(caseAt(520), bars);
        expect(row.caseId).toBe(`NVDA|${asOfAt(520)}`);
        expect(row.weeks).toBeGreaterThan(40);
        expect(['bullish', 'bearish', 'neutral']).toContain(row.daily);
        expect(row.weeklyMa200).toBe(row.weeks >= 200);
        expect(typeof row.lastWeekInProgress).toBe('boolean');
        expect(
            caseRow(caseAt(bars.length - 1), bars).lastWeekInProgress
        ).toBeNull();
        expect(caseRow(caseAt(250), bars).weeks).toBeLessThan(260);
    });

    it('counts the agreement, opposite and one-neutral pairs and the weekly bar quantiles', () => {
        const row = (
            daily: TrendLabel | null,
            weekly: TrendLabel | null,
            weeks: number,
            inProgress: boolean | null
        ) => ({
            caseId: `${daily}/${weekly}/${weeks}`,
            daily,
            weekly,
            weeks,
            weeklyMa200: weeks >= 200,
            lastWeekInProgress: inProgress,
        });
        const table = summarizeCases([
            row('bullish', 'bullish', 250, true),
            row('bullish', 'bearish', 210, false),
            row('bearish', 'neutral', 63, true),
            row('neutral', 'bullish', 30, null),
            row('neutral', 'neutral', 100, true),
            row(null, 'bullish', 20, true),
        ]);
        expect(table).toMatchObject({
            cases: 6,
            same: 2,
            opposite: 1,
            oneNeutral: 2,
            different: 4,
            inProgress: 4,
            finished: 1,
            undetermined: 1,
            weeklyMa200Computable: 2,
        });
        expect(table.weeks).toEqual({
            min: 20,
            median: 100,
            max: 250,
            below40: 2,
        });
        expect(table.pairs['bullish/bullish']).toBe(1);
        expect(summarizeCases([]).weeks).toEqual({
            min: 0,
            median: 0,
            max: 0,
            below40: 0,
        });
    });
});
