import { describe, it, expect } from 'vitest';
import {
    CANDLE_MIN_SETUP_BODY_ATR,
    CANDLE_PRIOR_TREND_BARS,
    CANDLE_PRIOR_TREND_MIN_ATR,
    candlePriorMove,
} from '@/domain/analysis/candle-context';
import { makeBar } from '@/__tests__/fixtures/candle';
import type { Bar } from '@/domain/types';

const START_CLOSE = 100;
const ATR_VALUE = 2;
/** First index whose move is measurable: CANDLE_PRIOR_TREND_BARS + 1 bars precede it. */
const FIRST_MEASURABLE = CANDLE_PRIOR_TREND_BARS + 1;

/**
 * `count` bars whose closes are `START_CLOSE` except the bar before `first`,
 * which closes `moveAtr` ATR (of `ATR_VALUE`) away: the whole move sits between
 * that bar and the one `CANDLE_PRIOR_TREND_BARS` before it.
 */
const barsWithMove = (count: number, first: number, moveAtr: number): Bar[] =>
    Array.from({ length: count }, (_, i) =>
        makeBar(i, {
            close:
                i === first - 1
                    ? START_CLOSE + moveAtr * ATR_VALUE
                    : START_CLOSE,
        })
    );

const flatAtr = (bars: readonly Bar[]): number[] => bars.map(() => ATR_VALUE);

describe('candle-context constants', () => {
    it('are the pre-registered values (10 bars, 1 ATR, 0.25 ATR body)', () => {
        expect(CANDLE_PRIOR_TREND_BARS).toBe(10);
        expect(CANDLE_PRIOR_TREND_MIN_ATR).toBe(1.0);
        expect(CANDLE_MIN_SETUP_BODY_ATR).toBe(0.25);
    });
});

describe('candlePriorMove', () => {
    const first = FIRST_MEASURABLE;
    const moveOf = (moveAtr: number): ReturnType<typeof candlePriorMove> => {
        const bars = barsWithMove(first + 2, first, moveAtr);
        return candlePriorMove(bars, first, flatAtr(bars));
    };

    describe('threshold', () => {
        it('a decline of exactly the minimum is a decline (inclusive)', () => {
            expect(moveOf(-CANDLE_PRIOR_TREND_MIN_ATR)).toEqual({
                trend: 'decline',
                moveAtr: -CANDLE_PRIOR_TREND_MIN_ATR,
            });
        });

        it('an advance of exactly the minimum is an advance (inclusive)', () => {
            expect(moveOf(CANDLE_PRIOR_TREND_MIN_ATR)).toEqual({
                trend: 'advance',
                moveAtr: CANDLE_PRIOR_TREND_MIN_ATR,
            });
        });

        it('a decline just inside the minimum is none, with the move reported', () => {
            const move = moveOf(-0.99);
            expect(move.trend).toBe('none');
            expect(move.moveAtr).toBeCloseTo(-0.99, 10);
        });

        it('an advance just inside the minimum is none, with the move reported', () => {
            const move = moveOf(0.99);
            expect(move.trend).toBe('none');
            expect(move.moveAtr).toBeCloseTo(0.99, 10);
        });

        it('a larger move reports its size in ATR', () => {
            const move = moveOf(-2.4);
            expect(move.trend).toBe('decline');
            expect(move.moveAtr).toBeCloseTo(-2.4, 10);
        });
    });

    describe('what the move is measured over', () => {
        it('reads the close before the first bar against the close 10 bars earlier', () => {
            const bars = barsWithMove(first + 2, first, -3).map((bar, i) =>
                i === first - 1 - CANDLE_PRIOR_TREND_BARS
                    ? { ...bar, close: START_CLOSE + 5 * ATR_VALUE }
                    : bar
            );
            // end close 94, start close 110: -16 / 2
            expect(candlePriorMove(bars, first, flatAtr(bars))).toEqual({
                trend: 'decline',
                moveAtr: -8,
            });
        });

        it("never reads the pattern's own bars", () => {
            const bars = barsWithMove(first + 3, first, 0).map((bar, i) =>
                i >= first ? { ...bar, close: START_CLOSE + 1000 } : bar
            );
            expect(candlePriorMove(bars, first, flatAtr(bars))).toEqual({
                trend: 'none',
                moveAtr: 0,
            });
        });

        it("reads the ATR at the bar before the pattern's first bar", () => {
            const bars = barsWithMove(first + 2, first, -3);
            const atr = bars.map((_, i) => (i === first - 1 ? 6 : ATR_VALUE));
            // -3 * 2 / 6
            expect(candlePriorMove(bars, first, atr)).toEqual({
                trend: 'decline',
                moveAtr: -1,
            });
        });
    });

    describe('not measurable (trend none, moveAtr null)', () => {
        it('measures the first index with CANDLE_PRIOR_TREND_BARS + 1 bars before it', () => {
            const bars = barsWithMove(first + 2, first, -3);
            expect(
                candlePriorMove(bars, first, flatAtr(bars)).moveAtr
            ).not.toBeNull();
        });

        it('has too few bars one index earlier', () => {
            const bars = barsWithMove(first + 2, first - 1, -3);
            expect(candlePriorMove(bars, first - 1, flatAtr(bars))).toEqual({
                trend: 'none',
                moveAtr: null,
            });
        });

        it('has no bar before a first bar at index 0', () => {
            const bars = barsWithMove(first + 2, first, -3);
            expect(candlePriorMove(bars, 0, flatAtr(bars))).toEqual({
                trend: 'none',
                moveAtr: null,
            });
        });

        it('has no bar before it when the first bar is past the series', () => {
            const bars = barsWithMove(first, first, -3);
            expect(
                candlePriorMove(bars, bars.length + 2, flatAtr(bars))
            ).toEqual({ trend: 'none', moveAtr: null });
        });

        it.each([
            ['null', null],
            ['zero', 0],
            ['negative', -1],
            ['NaN', Number.NaN],
            ['Infinity', Number.POSITIVE_INFINITY],
        ])('has an ATR that is %s', (_label, value) => {
            const bars = barsWithMove(first + 2, first, -3);
            const atr = bars.map((_, i) => (i === first - 1 ? value : 2));
            expect(candlePriorMove(bars, first, atr)).toEqual({
                trend: 'none',
                moveAtr: null,
            });
        });

        it('has an ATR series shorter than the bars', () => {
            const bars = barsWithMove(first + 2, first, -3);
            expect(candlePriorMove(bars, first, [])).toEqual({
                trend: 'none',
                moveAtr: null,
            });
        });

        it('has a non-finite close', () => {
            const bars = barsWithMove(first + 2, first, -3).map((bar, i) =>
                i === first - 1 ? { ...bar, close: Number.NaN } : bar
            );
            expect(candlePriorMove(bars, first, flatAtr(bars))).toEqual({
                trend: 'none',
                moveAtr: null,
            });
        });
    });
});
