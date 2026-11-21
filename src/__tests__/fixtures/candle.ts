import type { Bar } from '@/domain/types';

export const TEST_BAR_BASE_TIME = 1700000000;
export const TEST_BAR_INTERVAL = 60;
export const TEST_BAR_BASE_PRICE = 100;
const TEST_BAR_VOLUME = 1000;
export const HAMMER_BODY_OFFSET = 3;
export const HAMMER_HIGH_OFFSET = 5;
export const HAMMER_LOW_OFFSET = -15;

export const makeBar = (i: number, overrides?: Partial<Bar>): Bar => ({
    time: TEST_BAR_BASE_TIME + i * TEST_BAR_INTERVAL,
    open: TEST_BAR_BASE_PRICE,
    high: TEST_BAR_BASE_PRICE + 1,
    low: TEST_BAR_BASE_PRICE - 1,
    close: TEST_BAR_BASE_PRICE + 0.5,
    volume: TEST_BAR_VOLUME,
    ...overrides,
});

export const makeHammerBar = (i: number): Bar =>
    makeBar(i, {
        open: TEST_BAR_BASE_PRICE,
        high: TEST_BAR_BASE_PRICE + HAMMER_HIGH_OFFSET,
        low: TEST_BAR_BASE_PRICE + HAMMER_LOW_OFFSET,
        close: TEST_BAR_BASE_PRICE + HAMMER_BODY_OFFSET,
    });

/** Creates a bearish bar followed by a bullish engulfing bar (bullish body fully engulfs the bearish body). */
export const makeEngulfingPair = (startIndex: number): [Bar, Bar] => [
    makeBar(startIndex, {
        open: 110,
        high: 115,
        low: 105,
        close: 106,
    }),
    makeBar(startIndex + 1, {
        open: 104,
        high: 120,
        low: 103,
        close: 118,
    }),
];

/** Direction of a {@link makeTrendLead} run; `none` is flat. */
export type TrendLeadDirection = 'decline' | 'advance' | 'none';

export const TREND_LEAD_BARS = 20;
const TREND_LEAD_STEP = 2;

/**
 * Bars that lead into a pattern: `count` bars whose closes fall (rise) by
 * `step` per bar and end at `endClose`, each with a 1-point body (colours
 * alternate, the last bar follows the trend) and half-point wicks. The ATR of the run is about `step + 0.5`, so the 10-bar move is about
 * `10 * step / (step + 0.5)` ATR (8 ATR at the default step); `none` keeps the
 * closes flat (move 0). At least 15 bars are needed so the ATR(14) of the
 * series is warm before the pattern starts.
 */
export const makeTrendLead = (
    direction: TrendLeadDirection,
    endClose: number,
    count = TREND_LEAD_BARS,
    step = TREND_LEAD_STEP
): Bar[] => {
    const sign = direction === 'decline' ? 1 : direction === 'advance' ? -1 : 0;
    return Array.from({ length: count }, (_, k) => {
        const close = endClose + sign * step * (count - 1 - k);
        // Alternate colours (the last bar follows the trend) so the lead itself never
        // forms a same-colour run or a long-body pattern with the bars after it.
        const withTrend = (count - 1 - k) % 2 === 0;
        const bearish = sign >= 0 ? withTrend : !withTrend;
        const open = close + (bearish ? 1 : -1);
        return makeBar(k - count, {
            open,
            high: Math.max(open, close) + 0.5,
            low: Math.min(open, close) - 0.5,
            close,
        });
    });
};
