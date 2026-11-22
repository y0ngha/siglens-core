/**
 * The hand-made run of the backtest benchmark tests: two tickers, 30 daily bars each, three
 * trades. Prices are closed forms of the day index so every expected figure in the tests is
 * written out as arithmetic, not read back from the code under test.
 *
 * AAA closes `100 + d`. BBB climbs 2 a day to 118 on day 9, falls 3 a day to 88 on day 19 and
 * recovers 1 a day to 98 on day 29. Every bar opens at the previous close and trades one
 * point either side of its close.
 *
 * Trades (day indices of the 30-bar period):
 * - T1 AAA, limit fill on day 2 at 100: first half takes `tp1` 104 on day 3, second half
 *   `tp_final` 108 on day 7. Return 6.00, 5 days.
 * - T2 BBB, limit fill on day 10 at 115: first half stopped at `sl1` 112 on day 11, second
 *   half at `sl2` 108 on day 12. Return -4.35 (stored rounded from -4.3478), 2 days.
 * - T3 AAA, sell-off entry on day 20 at 120, both halves out at 122 on day 22. Return 1.67
 *   (stored rounded from 1.6667), 2 days.
 */
import type { Bar } from '@/domain/types';
import type {
    BenchmarkBaseline,
    BenchmarkInput,
    BenchmarkTrade,
} from '../../../../scripts/replay/backtestBenchmarksCompute';

export const DAYS = 30;

/** Weekdays from 2025-01-06 (a Monday), one per bar. */
export const FIXTURE_DATES: readonly string[] = Array.from(
    { length: DAYS },
    (_, d) => {
        const weekOffset = Math.floor(d / 5) * 7 + (d % 5);
        return new Date(Date.UTC(2025, 0, 6 + weekOffset))
            .toISOString()
            .slice(0, 10);
    }
);

export const aaaClose = (d: number): number => 100 + d;
export const bbbClose = (d: number): number =>
    d <= 9 ? 100 + 2 * d : d <= 19 ? 118 - 3 * (d - 9) : 88 + (d - 19);

export function fixtureBars(close: (d: number) => number): Bar[] {
    return FIXTURE_DATES.map((date, d) => ({
        time: Date.parse(`${date}T00:00:00Z`) / 1000,
        open: d === 0 ? close(0) : close(d - 1),
        high: close(d) + 1,
        low: close(d) - 1,
        close: close(d),
        volume: 1_000,
    }));
}

export const T1: BenchmarkTrade = {
    ticker: 'AAA',
    entryType: 'wait_limit',
    decisionDate: FIXTURE_DATES[1],
    entryDate: FIXTURE_DATES[2],
    entryPrice: 100,
    exitDate: FIXTURE_DATES[7],
    holdingDays: 5,
    returnPct: 6,
    legs: [
        {
            name: 'A',
            size: 0.5,
            exitDate: FIXTURE_DATES[3],
            exitPrice: 104,
            reason: 'tp1',
            returnPct: 4,
        },
        {
            name: 'B',
            size: 0.5,
            exitDate: FIXTURE_DATES[7],
            exitPrice: 108,
            reason: 'tp_final',
            returnPct: 8,
        },
    ],
    initialPlan: { tp1: 104, tpFinal: 108, sl1: 96, sl2: 92, source: 'ai' },
    holdingReviews: 0,
};

export const T2: BenchmarkTrade = {
    ticker: 'BBB',
    entryType: 'wait_limit',
    decisionDate: FIXTURE_DATES[9],
    entryDate: FIXTURE_DATES[10],
    entryPrice: 115,
    exitDate: FIXTURE_DATES[12],
    holdingDays: 2,
    returnPct: -4.35,
    legs: [
        {
            name: 'A',
            size: 0.5,
            exitDate: FIXTURE_DATES[11],
            exitPrice: 112,
            reason: 'sl1',
            returnPct: -2.61,
        },
        {
            name: 'B',
            size: 0.5,
            exitDate: FIXTURE_DATES[12],
            exitPrice: 108,
            reason: 'sl2',
            returnPct: -6.09,
        },
    ],
    initialPlan: { tp1: 121, tpFinal: 126, sl1: 112, sl2: 108, source: 'ai' },
    holdingReviews: 0,
};

export const T3: BenchmarkTrade = {
    ticker: 'AAA',
    entryType: 'enter_selloff',
    decisionDate: FIXTURE_DATES[20],
    entryDate: FIXTURE_DATES[20],
    entryPrice: 120,
    exitDate: FIXTURE_DATES[22],
    holdingDays: 2,
    returnPct: 1.67,
    legs: [
        {
            name: 'A',
            size: 0.5,
            exitDate: FIXTURE_DATES[22],
            exitPrice: 122,
            reason: 'selloff_ma5',
            returnPct: 1.67,
        },
        {
            name: 'B',
            size: 0.5,
            exitDate: FIXTURE_DATES[22],
            exitPrice: 122,
            reason: 'selloff_ma5',
            returnPct: 1.67,
        },
    ],
    initialPlan: { tp1: 123, tpFinal: 126, sl1: 117, sl2: 114, source: 'ai' },
    holdingReviews: 0,
};

/**
 * T0 BBB, a 0-day sell-off trade: entered and left on day 25 (close 94), both halves out at
 * 95. Return 1.06 (stored rounded from 1.0638). Length 0: no exposure day, drift 0.
 */
export const T0: BenchmarkTrade = {
    ticker: 'BBB',
    entryType: 'enter_selloff',
    decisionDate: FIXTURE_DATES[25],
    entryDate: FIXTURE_DATES[25],
    entryPrice: 94,
    exitDate: FIXTURE_DATES[25],
    holdingDays: 0,
    returnPct: 1.06,
    legs: [
        {
            name: 'A',
            size: 0.5,
            exitDate: FIXTURE_DATES[25],
            exitPrice: 95,
            reason: 'selloff_ma5',
            returnPct: 1.06,
        },
        {
            name: 'B',
            size: 0.5,
            exitDate: FIXTURE_DATES[25],
            exitPrice: 95,
            reason: 'selloff_ma5',
            returnPct: 1.06,
        },
    ],
    initialPlan: { tp1: 97, tpFinal: 99, sl1: 91, sl2: 89, source: 'ai' },
    holdingReviews: 0,
};

/**
 * T4 BBB, a market entry at the day-20 close (89): the bar after it (day 21) opens at 89 and
 * reaches the 91 target, so the first half ends at `tp1`. Return 2.81 (stored rounded).
 */
export function marketEntryTrade(entryPrice = 89): BenchmarkTrade {
    const leg = (
        name: 'A' | 'B',
        exitPrice: number,
        reason: 'tp1' | 'tp_final'
    ) => ({
        name,
        size: 0.5,
        exitDate: FIXTURE_DATES[name === 'A' ? 21 : 22],
        exitPrice,
        reason,
        returnPct: Number(((exitPrice / entryPrice - 1) * 100).toFixed(2)),
    });
    return {
        ticker: 'BBB',
        entryType: 'enter_close',
        decisionDate: FIXTURE_DATES[20],
        entryDate: FIXTURE_DATES[20],
        entryPrice,
        exitDate: FIXTURE_DATES[22],
        holdingDays: 2,
        returnPct: Number((((91 + 92) / 2 / entryPrice - 1) * 100).toFixed(2)),
        legs: [leg('A', 91, 'tp1'), leg('B', 92, 'tp_final')],
        initialPlan: { tp1: 91, tpFinal: 92, sl1: 85, sl2: 83, source: 'ai' },
        holdingReviews: 0,
    };
}

/**
 * The flat run: one ticker whose close is 100 every day (bars span 99..101). Its one trade
 * is flat in total (half out at 90, half at 110) but marks to market at -5% while the first
 * half is out and the second is still open. Every random-entry draw is exactly flat.
 */
export const FLAT_TRADE: BenchmarkTrade = {
    ticker: 'AAA',
    entryType: 'wait_limit',
    decisionDate: FIXTURE_DATES[1],
    entryDate: FIXTURE_DATES[2],
    entryPrice: 100,
    exitDate: FIXTURE_DATES[6],
    holdingDays: 4,
    returnPct: 0,
    legs: [
        {
            name: 'A',
            size: 0.5,
            exitDate: FIXTURE_DATES[3],
            exitPrice: 90,
            reason: 'tp1',
            returnPct: -10,
        },
        {
            name: 'B',
            size: 0.5,
            exitDate: FIXTURE_DATES[6],
            exitPrice: 110,
            reason: 'tp_final',
            returnPct: 10,
        },
    ],
    initialPlan: { tp1: 101, tpFinal: 110, sl1: 98, sl2: 95, source: 'ai' },
    holdingReviews: 0,
};

export function flatInput(): BenchmarkInput {
    return fixtureInput({
        run: {
            periodStart: FIXTURE_DATES[0],
            periodEnd: FIXTURE_DATES[DAYS - 1],
            tickers: ['AAA'],
        },
        baselines: [
            {
                ticker: 'AAA',
                buyHoldPct: 0,
                buyHoldMaxDrawdownPct: 0,
                tradingDays: DAYS,
            },
        ],
        trades: [FLAT_TRADE],
        bars: { AAA: fixtureBars(() => 100) },
    });
}

export const FIXTURE_BASELINES: readonly BenchmarkBaseline[] = [
    {
        ticker: 'AAA',
        buyHoldPct: 29,
        buyHoldMaxDrawdownPct: 0,
        tradingDays: DAYS,
    },
    {
        ticker: 'BBB',
        buyHoldPct: -2,
        buyHoldMaxDrawdownPct: -25.42,
        tradingDays: DAYS,
    },
];

export const IDENTITY = {
    tradesSha256: 'sha-of-trades',
    barsFingerprint: 'fingerprint',
    coreSha: 'abc123',
} as const;

export function fixtureInput(
    overrides: Partial<BenchmarkInput> = {}
): BenchmarkInput {
    return {
        run: {
            periodStart: FIXTURE_DATES[0],
            periodEnd: FIXTURE_DATES[DAYS - 1],
            tickers: ['AAA', 'BBB'],
        },
        baselines: FIXTURE_BASELINES,
        trades: [T1, T2, T3],
        bars: { AAA: fixtureBars(aaaClose), BBB: fixtureBars(bbbClose) },
        identity: IDENTITY,
        ...overrides,
    };
}
