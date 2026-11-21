import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateATR } from '@/domain/indicators/atr';
import type {
    Bar,
    CandlePattern,
    CandlePatternEntry,
    MultiCandlePattern,
} from '@/domain/types';
import {
    MULTI_BAR_COUNT,
    MULTI_RULE,
    candleEventsForSymbol,
    candleViolations,
    caseCandleLines,
    eligiblePlaceboDates,
    entriesEndingAt,
    measurable,
    outcomesAt,
    placeboSummary,
    priorBucket,
    windowEndingAt,
} from '../../../../scripts/replay/engineEvalCandles';
import { EVAL_CONSTANTS } from '../../../../scripts/replay/engineEvalTypes';

const detect = vi.hoisted(() => vi.fn());
const windows = vi.hoisted(() => ({ lengths: [] as number[] }));

vi.mock('@/domain/analysis/candle-detection', async importOriginal => ({
    ...(await importOriginal<
        typeof import('@/domain/analysis/candle-detection')
    >()),
    detectCandlePatternEntries: detect,
}));

const BASE = 1_500_000_000;
const DAY = 86_400;

/** Flat bars at 100 with a +-1 range (ATR 2); `patch` overrides single bars. */
function series(
    count: number,
    patch: Record<number, Partial<Bar>> = {}
): Bar[] {
    return Array.from({ length: count }, (_, i) => ({
        time: BASE + i * DAY,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1000,
        ...patch[i],
    }));
}

const atrOf = (
    bars: readonly Bar[],
    value: number | null = 2
): (number | null)[] => bars.map(() => value);

const single = (
    pattern: 'hammer' | 'doji' | 'shooting_star',
    barIndex = 14
): CandlePatternEntry => ({
    barIndex,
    patternType: 'single',
    singlePattern: pattern,
    multiPattern: null,
});

const multi = (
    pattern: 'bullish_engulfing' | 'bearish_engulfing',
    barIndex = 14
): CandlePatternEntry => ({
    barIndex,
    patternType: 'multi',
    singlePattern: null,
    multiPattern: pattern,
});

describe('priorBucket', () => {
    const at = (closeEnd: number) =>
        series(30, { 9: { close: 100 }, 19: { close: closeEnd } });

    it('reads the move over 10 bars that end before the first bar, in ATR of that bar', () => {
        const bars = at(98);
        expect(priorBucket(bars, atrOf(bars), 20)).toBe('decline');
        const up = at(102);
        expect(priorBucket(up, atrOf(up), 20)).toBe('advance');
    });

    it('needs the full 1.0 ATR, inclusive, on both sides', () => {
        const barely = at(98.02);
        expect(priorBucket(barely, atrOf(barely), 20)).toBe('none');
        const barelyUp = at(101.98);
        expect(priorBucket(barelyUp, atrOf(barelyUp), 20)).toBe('none');
        expect(EVAL_CONSTANTS.candlePriorTrendMinAtr).toBe(1);
        expect(EVAL_CONSTANTS.candlePriorTrendBars).toBe(10);
    });

    it('is none when the lookback does not fit before the bar', () => {
        const bars = series(30, { 0: { close: 100 }, 10: { close: 90 } });
        expect(priorBucket(bars, atrOf(bars), 10)).toBe('none');
        expect(priorBucket(bars, atrOf(bars), 11)).toBe('decline');
    });

    it('is none when the ATR is null, zero, not finite or missing', () => {
        const bars = at(90);
        expect(priorBucket(bars, atrOf(bars, null), 20)).toBe('none');
        expect(priorBucket(bars, atrOf(bars, 0), 20)).toBe('none');
        expect(priorBucket(bars, atrOf(bars, Number.NaN), 20)).toBe('none');
        expect(priorBucket(bars, [], 20)).toBe('none');
    });
});

describe('definition tables', () => {
    it('has a bar count and a prior-move rule for each of the 40 multi patterns', () => {
        expect(Object.keys(MULTI_BAR_COUNT).toSorted()).toEqual(
            Object.keys(MULTI_RULE).toSorted()
        );
        expect(Object.keys(MULTI_RULE)).toHaveLength(40);
        const rules = Object.values(MULTI_RULE);
        expect(rules.filter(r => r === 'decline')).toHaveLength(21);
        expect(rules.filter(r => r === 'advance')).toHaveLength(19);
        expect(
            Object.values(MULTI_BAR_COUNT).every(n => n >= 2 && n <= 5)
        ).toBe(true);
    });
});

describe('candleViolations', () => {
    /** A decline into bar `s - 1` (97 against 100 ten bars earlier) and an advance (103). */
    const declineInto = (s: number, extra: Record<number, Partial<Bar>> = {}) =>
        series(40, { [s - 1]: { close: 97 }, ...extra });
    const advanceInto = (s: number, extra: Record<number, Partial<Bar>> = {}) =>
        series(40, { [s - 1]: { close: 103 }, ...extra });
    const fullBody: Partial<Bar> = {
        open: 100,
        close: 99,
        high: 100.5,
        low: 98.5,
    };

    const singleViolations = (
        bars: Bar[],
        pattern: CandlePattern,
        t: number,
        atr = atrOf(bars)
    ) => candleViolations(bars, atr, { patternType: 'single', pattern }, t);
    const multiViolations = (
        bars: Bar[],
        pattern: MultiCandlePattern,
        t: number,
        atr = atrOf(bars)
    ) => candleViolations(bars, atr, { patternType: 'multi', pattern }, t);

    describe('single shapes', () => {
        it('accepts a hammer after a decline and flags one on a flat tape', () => {
            expect(singleViolations(declineInto(30), 'hammer', 30)).toEqual([]);
            expect(singleViolations(series(40), 'hammer', 30)).toEqual([
                'context',
            ]);
        });

        it('flags a hammer after an advance, accepts a hanging man there', () => {
            expect(singleViolations(advanceInto(30), 'hammer', 30)).toEqual([
                'context',
            ]);
            expect(
                singleViolations(advanceInto(30), 'hanging_man', 30)
            ).toEqual([]);
            expect(
                singleViolations(declineInto(30), 'hanging_man', 30)
            ).toEqual(['context']);
        });

        it('applies the rule to inverted hammer, shooting star, dojis and belt holds', () => {
            const down = declineInto(30);
            const up = advanceInto(30);
            const needDecline: CandlePattern[] = [
                'inverted_hammer',
                'dragonfly_doji',
                'bullish_belt_hold',
            ];
            const needAdvance: CandlePattern[] = [
                'shooting_star',
                'gravestone_doji',
                'bearish_belt_hold',
            ];
            needDecline.forEach(p => {
                expect(singleViolations(down, p, 30)).toEqual([]);
                expect(singleViolations(up, p, 30)).toEqual(['context']);
            });
            needAdvance.forEach(p => {
                expect(singleViolations(up, p, 30)).toEqual([]);
                expect(singleViolations(down, p, 30)).toEqual(['context']);
            });
        });

        it('leaves shape-only singles alone', () => {
            expect(
                singleViolations(series(40), 'bullish_marubozu', 30)
            ).toEqual([]);
            expect(singleViolations(series(40), 'doji', 30)).toEqual([]);
        });
    });

    describe('multi patterns', () => {
        it('accepts an engulfing with a real first bar after a decline', () => {
            const bars = declineInto(29, { 29: fullBody });
            expect(multiViolations(bars, 'bullish_engulfing', 30)).toEqual([]);
        });

        it('flags the missing prior move of a decline rule and an advance rule', () => {
            const flat = series(40, { 29: fullBody });
            expect(multiViolations(flat, 'bullish_engulfing', 30)).toEqual([
                'context',
            ]);
            expect(multiViolations(flat, 'bearish_engulfing', 30)).toEqual([
                'context',
            ]);
            const up = advanceInto(29, { 29: fullBody });
            expect(multiViolations(up, 'bullish_engulfing', 30)).toEqual([
                'context',
            ]);
            expect(multiViolations(up, 'bearish_engulfing', 30)).toEqual([]);
        });

        it('applies the body floor at exactly 0.25 ATR, inclusive', () => {
            const passes = declineInto(29, {
                29: { open: 100, close: 100.5, high: 101, low: 99.5 },
            });
            expect(multiViolations(passes, 'bullish_engulfing', 30)).toEqual(
                []
            );
            const below = declineInto(29, {
                29: { open: 100, close: 100.49, high: 101, low: 99.5 },
            });
            expect(multiViolations(below, 'bullish_engulfing', 30)).toEqual([
                'setupBody',
            ]);
            expect(EVAL_CONSTANTS.candleSetupBodyAtr).toBe(0.25);
        });

        it('rejects a doji-sized first bar twice for engulfing (floor and doji) and once for harami (floor only)', () => {
            const doji = declineInto(29, {
                29: { open: 100, close: 100.1, high: 101, low: 99 },
            });
            expect(multiViolations(doji, 'bullish_engulfing', 30)).toEqual([
                'setupBody',
                'dojiSetup',
            ]);
            expect(multiViolations(doji, 'bullish_harami', 30)).toEqual([
                'setupBody',
            ]);
        });

        it('treats a zero-range first bar as doji-sized', () => {
            const point = declineInto(29, {
                29: { open: 100, close: 100, high: 100, low: 100 },
            });
            expect(multiViolations(point, 'three_outside_up', 31)).toContain(
                'dojiSetup'
            );
        });

        it('counts an unreadable ATR before the first bar as below the floor', () => {
            const bars = declineInto(29, { 29: fullBody });
            const atr = atrOf(bars).map((v, i) => (i === 28 ? null : v));
            // The same ATR reads the prior move, so the context fails with it.
            expect(multiViolations(bars, 'bullish_engulfing', 30, atr)).toEqual(
                ['context', 'setupBody']
            );
            const zero = atrOf(bars).map((v, i) => (i === 28 ? 0 : v));
            expect(
                multiViolations(bars, 'bullish_engulfing', 30, zero)
            ).toContain('setupBody');
        });

        it('has no ATR before a pattern that starts on the first bar', () => {
            const bars = series(10, { 0: fullBody });
            expect(multiViolations(bars, 'bullish_engulfing', 1)).toEqual([
                'context',
                'setupBody',
            ]);
        });

        it('requires the confirming close of tweezers, strictly', () => {
            const bottom = (close: number) =>
                declineInto(29, { 29: fullBody, 30: { close } });
            expect(multiViolations(bottom(99), 'tweezers_bottom', 30)).toEqual([
                'tweezersClose',
            ]);
            expect(
                multiViolations(bottom(98.5), 'tweezers_bottom', 30)
            ).toEqual(['tweezersClose']);
            expect(
                multiViolations(bottom(99.5), 'tweezers_bottom', 30)
            ).toEqual([]);
            const topBars = (close: number) =>
                advanceInto(29, {
                    29: { open: 100, close: 101, high: 101.5, low: 99.5 },
                    30: { close },
                });
            expect(multiViolations(topBars(101), 'tweezers_top', 30)).toEqual([
                'tweezersClose',
            ]);
            expect(multiViolations(topBars(101.5), 'tweezers_top', 30)).toEqual(
                ['tweezersClose']
            );
            expect(multiViolations(topBars(100.5), 'tweezers_top', 30)).toEqual(
                []
            );
        });

        it('reads the first bar of a three-bar and a five-bar pattern from its own length', () => {
            const star = declineInto(28, { 28: fullBody });
            expect(multiViolations(star, 'morning_star', 30)).toEqual([]);
            const methods = advanceInto(26);
            expect(
                multiViolations(methods, 'rising_three_methods', 30)
            ).toEqual([]);
            expect(
                multiViolations(declineInto(26), 'rising_three_methods', 30)
            ).toEqual(['context']);
        });

        it('does not floor the first bar of patterns outside the setup list', () => {
            const soldiers = declineInto(28, {
                28: { open: 100, close: 100.1, high: 101, low: 99 },
            });
            expect(
                multiViolations(soldiers, 'three_white_soldiers', 30)
            ).toEqual([]);
        });
    });
});

describe('windows, outcomes and placebo dates', () => {
    it('slices the production window ending at the bar', () => {
        const bars = series(700);
        expect(windowEndingAt(bars, 600)).toHaveLength(500);
        expect(windowEndingAt(bars, 600).at(-1)).toBe(bars[600]);
        expect(windowEndingAt(bars, 600)[0]).toBe(bars[101]);
        expect(windowEndingAt(bars, 100)).toHaveLength(101);
    });

    it('signs the outcomes by the direction and scales by ATR and price', () => {
        const bars = series(20).map((b, i) => ({ ...b, close: 100 + 2 * i }));
        const up = outcomesAt(bars, atrOf(bars), 0, 1);
        expect(up.y).toEqual({ h1: 1, h5: 5, h10: 10 });
        expect(up.pct.h1).toBeCloseTo(2, 12);
        const down = outcomesAt(bars, atrOf(bars), 0, -1);
        expect(down.y.h5).toBe(-5);
        expect(down.pct.h10).toBeCloseTo(-20, 12);
    });

    it('has no placebo summary without dates and averages otherwise', () => {
        const bars = series(40).map((b, i) => ({
            ...b,
            close: 100 + 2 * (i % 2) * (i < 20 ? 1 : 0),
        }));
        expect(placeboSummary(bars, atrOf(bars), 1, [])).toBeNull();
        const summary = placeboSummary(bars, atrOf(bars), 1, [0, 1]);
        // t=0: closes 100 -> h1 102 (+1), t=1: 102 -> h1 100 (-1)
        expect(summary?.n).toBe(2);
        expect(summary?.y.h1).toBe(0);
        expect(summary?.hit.h1).toBe(0.5);
    });

    it('lists the measurable dates around an event, leaving out those within the forward horizon', () => {
        const atr = atrOf(series(600));
        const dates = eligiblePlaceboDates(atr, 600, 300, 10, () => true);
        expect(dates[0]).toBe(260);
        expect(dates.at(-1)).toBe(550);
        // 290..310 share the event's forward window: the boundary is inclusive.
        expect(dates).toContain(289);
        expect(dates).not.toContain(290);
        expect(dates).not.toContain(300);
        expect(dates).not.toContain(310);
        expect(dates).toContain(311);
        expect(dates).toHaveLength(550 - 260 + 1 - 21);
        const nearEnd = eligiblePlaceboDates(atr, 600, 580, 10, () => true);
        expect(nearEnd[0]).toBe(330);
        expect(nearEnd.at(-1)).toBe(569);
        const longer = eligiblePlaceboDates(atr, 600, 300, 60, () => true);
        expect(longer[0]).toBe(361);
        expect(longer.at(-1)).toBe(539);
    });

    it('applies the filter and skips dates without a usable ATR', () => {
        const atr = atrOf(series(600)).map((v, i) =>
            i === 270 ? null : i === 271 ? 0 : v
        );
        const even = eligiblePlaceboDates(atr, 600, 300, 10, d => d % 2 === 0);
        expect(even.every(d => d % 2 === 0)).toBe(true);
        expect(even).not.toContain(270);
        expect(
            eligiblePlaceboDates(atr, 600, 300, 10, () => true)
        ).not.toContain(271);
        expect(eligiblePlaceboDates(atr, 600, 300, 10, () => false)).toEqual(
            []
        );
    });

    it('measures a bar only with enough history, enough future and a positive ATR', () => {
        const atr = atrOf(series(400));
        expect(measurable(atr, 400, 259, 10)).toBe(false);
        expect(measurable(atr, 400, 260, 10)).toBe(true);
        expect(measurable(atr, 400, 389, 10)).toBe(true);
        expect(measurable(atr, 400, 390, 10)).toBe(false);
        expect(measurable(atrOf(series(400), null), 400, 300, 10)).toBe(false);
        expect(measurable(atrOf(series(400), 0), 400, 300, 10)).toBe(false);
        expect(measurable([], 400, 300, 10)).toBe(false);
    });
});

describe('detection pass', () => {
    const marks = new Map<number, CandlePatternEntry[]>();

    beforeEach(() => {
        marks.clear();
        detect.mockReset();
        detect.mockImplementation((window: Bar[]) => {
            windows.lengths = [...windows.lengths, window.length];
            return marks.get(window[window.length - 1].volume) ?? [];
        });
    });

    /** A bar that tells the mocked detector which entries to return. */
    const marked = (
        volume: number,
        entries: CandlePatternEntry[]
    ): Partial<Bar> => {
        marks.set(volume, entries);
        return { volume };
    };

    it('turns entries that end on a bar into tested, neutral and dropped events', () => {
        const patch: Record<number, Partial<Bar>> = {
            300: marked(7001, [single('hammer')]),
            305: { close: 104, high: 105 },
            310: marked(7002, [single('doji')]),
            330: marked(7003, [single('shooting_star')]),
            340: marked(7004, [single('hammer', 13)]),
            // Multi pattern after a one-bar dip: no other date shares its decline bucket.
            318: { close: 97, low: 96 },
            320: marked(7005, [multi('bullish_engulfing')]),
            250: marked(7006, [single('hammer')]),
            415: marked(7007, [single('hammer')]),
        };
        const bars = series(420, patch);
        const events = candleEventsForSymbol('AAA', 'us', bars);
        expect(events.map(e => [e.index, e.pattern, e.status])).toEqual([
            [300, 'hammer', 'tested'],
            [310, 'doji', 'neutral'],
            [320, 'bullish_engulfing', 'dropped'],
            [330, 'shooting_star', 'tested'],
        ]);
        const [hammer, doji, engulfing, star] = events;
        expect(hammer).toMatchObject({
            kind: 'candle',
            symbol: 'AAA',
            market: 'us',
            direction: 1,
            patternType: 'single',
            barCount: 1,
            bucket: 'none',
            half: 'early',
        });
        expect(hammer.y?.h5).toBe(2);
        expect(hammer.pct?.h5).toBeCloseTo(4, 12);
        expect(hammer.matched?.n).toBe(EVAL_CONSTANTS.placeboCount);
        expect(hammer.unmatched?.n).toBe(EVAL_CONSTANTS.placeboCount);
        expect(hammer.robust.matched.a05?.n).toBe(EVAL_CONSTANTS.placeboCount);
        expect(hammer.robust.matched.a15?.n).toBe(EVAL_CONSTANTS.placeboCount);
        expect(doji.robust.matched).toEqual({ a05: null, a15: null });
        expect(hammer.date).toBe(
            new Date((BASE + 300 * DAY) * 1000).toISOString().slice(0, 10)
        );
        expect(hammer.week).toMatch(/^\d{4}-W\d{2}$/);
        expect(doji).toMatchObject({
            direction: 0,
            y: null,
            matched: null,
            unmatched: null,
        });
        expect(engulfing).toMatchObject({
            direction: 1,
            barCount: 2,
            bucket: 'decline',
            y: null,
            matched: null,
        });
        expect(star.direction).toBe(-1);
        expect(star.y?.h5).toBeCloseTo(0, 12);
    });

    it('records the robustness variants of each event', () => {
        // A decline of 2.6 over 10 bars into the bar before the hammer: 1.3 ATR, so the
        // 0.5 and 1.0 ATR rules see a decline and the 1.5 ATR rule does not.
        const bars = series(420, {
            299: { close: 97.4 },
            300: marked(7001, [single('hammer')]),
        });
        const [event] = candleEventsForSymbol('AAA', 'us', bars);
        expect(event.bucket).toBe('decline');
        expect(event.violations).toEqual([]);
        expect(event.robust.contextViolation).toEqual({
            a05: false,
            a15: true,
        });
        expect(event.robust.setupBodyViolation).toEqual({
            f01: false,
            f05: false,
        });
        // Only the event's own date sits in the decline bucket (default and 0.5 ATR): no
        // placebo to draw. Under 1.5 ATR the event reads `none`, like every other date.
        expect(event.status).toBe('dropped');
        expect(event.robust.matched.a05).toBeNull();
        expect(event.robust.matched.a15?.n).toBe(20);
    });

    it('reads the G1 violations on the window the detector sees', () => {
        const wavy = series(700).map((b, i) => ({
            ...b,
            high: 101 + (i % 7),
            low: 99 - (i % 5),
            close: 100 + (i % 3),
        }));
        const bars = wavy.map((b, i) =>
            i === 600
                ? { ...b, ...marked(7001, [multi('bullish_engulfing')]) }
                : b
        );
        const [event] = candleEventsForSymbol('AAA', 'us', bars);
        const window = windowEndingAt(bars, 600);
        expect(event.violations).toEqual(
            candleViolations(
                window,
                calculateATR(window),
                { patternType: 'multi', pattern: 'bullish_engulfing' },
                window.length - 1
            )
        );
        expect(event.violations).toContain('context');
    });

    it('feeds the detector the production window ending at each measurable bar', () => {
        windows.lengths = [];
        candleEventsForSymbol('AAA', 'us', series(420));
        // t runs from 260 to 409, every window is the last 500 bars up to it.
        expect(windows.lengths).toHaveLength(150);
        expect(windows.lengths.toSorted((a, b) => a - b)[0]).toBe(261);
        expect(windows.lengths.every(n => n <= 500)).toBe(true);
    });

    it('draws the same placebo dates for the same event in any run', () => {
        const patch = { 300: marked(7001, [single('hammer')]) };
        const first = candleEventsForSymbol('AAA', 'us', series(420, patch));
        marks.set(7099, [single('hammer')]);
        const second = candleEventsForSymbol(
            'AAA',
            'us',
            series(420, { ...patch, 350: { volume: 7099 } })
        );
        expect(second[0]).toEqual(first[0]);
        expect(second).toHaveLength(2);
        const otherSymbol = candleEventsForSymbol(
            'BBB',
            'kr',
            series(420, { 300: { volume: 7001, high: 101.5 } })
        );
        expect(otherSymbol[0].market).toBe('kr');
    });

    it('finds nothing to measure on a series with no range (ATR 0)', () => {
        const dead = series(420, {}).map(b => ({ ...b, high: 100, low: 100 }));
        const bars = dead.map((b, i) =>
            i === 300 ? { ...b, volume: 7001 } : b
        );
        marks.set(7001, [single('hammer')]);
        expect(candleEventsForSymbol('AAA', 'us', bars)).toEqual([]);
    });

    it('marks bars dated 2022 or later as the late half', () => {
        const late = series(420).map((b, i) => ({
            ...b,
            time: Date.UTC(2023, 0, 2) / 1000 + i * DAY,
            volume: i === 300 ? 7001 : b.volume,
        }));
        marks.set(7001, [single('hammer')]);
        expect(candleEventsForSymbol('AAA', 'us', late)[0].half).toBe('late');
    });

    it('describes the lines a case would print', () => {
        const bars = series(600);
        detect.mockImplementation(() => [
            multi('bullish_engulfing', 10),
            single('shooting_star', 12),
        ]);
        expect(caseCandleLines(bars, 500)).toEqual({
            lines: 2,
            bullish: true,
            bearish: true,
        });
        detect.mockImplementation(() => []);
        expect(caseCandleLines(bars, 500)).toEqual({
            lines: 0,
            bullish: false,
            bearish: false,
        });
        detect.mockImplementation(() => [single('doji', 3)]);
        expect(caseCandleLines(bars, 500)).toEqual({
            lines: 1,
            bullish: false,
            bearish: false,
        });
        detect.mockImplementation(() => [multi('bearish_engulfing', 4)]);
        expect(caseCandleLines(bars, 500)).toEqual({
            lines: 1,
            bullish: false,
            bearish: true,
        });
    });

    it('keeps only entries whose pattern ends on the bar', () => {
        const bars = series(600);
        detect.mockImplementation(() => [
            single('hammer', 12),
            single('doji', 14),
        ]);
        expect(entriesEndingAt(bars, 500).map(e => e.singlePattern)).toEqual([
            'doji',
        ]);
        // A window shorter than the detection window ends at its own last bar.
        detect.mockImplementation(() => [
            single('hammer', 4),
            single('doji', 5),
        ]);
        expect(entriesEndingAt(bars, 5).map(e => e.singlePattern)).toEqual([
            'doji',
        ]);
    });
});
