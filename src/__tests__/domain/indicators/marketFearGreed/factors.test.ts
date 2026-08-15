import { describe, expect, it } from 'vitest';

import {
    computeMarketFactorsAtT,
    MARKET_FEAR_GREED_WARMUP,
    MARKET_FEAR_GREED_WINDOWS,
} from '@/domain/indicators/marketFearGreed/factors';
import {
    MARKET_FEAR_GREED_SERIES_KEYS,
    type AlignedMarketSeries,
    type MarketFearGreedSeriesKey,
} from '@/domain/indicators/marketFearGreed/types';

const LENGTH = MARKET_FEAR_GREED_WINDOWS.MOMENTUM_MA;
const LAST = LENGTH - 1;

function constant(value: number): number[] {
    return new Array(LENGTH).fill(value);
}

/** Aligned series where every key is flat at 100 unless overridden. */
function series(
    overrides: Partial<Record<MarketFearGreedSeriesKey, number[]>> = {}
): AlignedMarketSeries {
    const closes = {} as Record<MarketFearGreedSeriesKey, number[]>;
    for (const key of MARKET_FEAR_GREED_SERIES_KEYS) {
        closes[key] = overrides[key] ?? constant(100);
    }
    return {
        dates: Array.from({ length: LENGTH }, (_, i) => `d${i}`),
        closes,
    };
}

/** Flat at `base`, then `end` at the final index. */
function endingAt(base: number, end: number): number[] {
    const values = constant(base);
    values[LAST] = end;
    return values;
}

describe('MARKET_FEAR_GREED_WARMUP', () => {
    it('is the first index at which the longest window is fully populated', () => {
        expect(MARKET_FEAR_GREED_WARMUP).toBe(
            MARKET_FEAR_GREED_WINDOWS.MOMENTUM_MA - 1
        );
    });
});

describe('computeMarketFactorsAtT', () => {
    it('returns null before the momentum window is populated', () => {
        expect(
            computeMarketFactorsAtT(series(), MARKET_FEAR_GREED_WARMUP - 1)
        ).toBeNull();
    });

    it('returns a bundle at the first fully populated index', () => {
        expect(
            computeMarketFactorsAtT(series(), MARKET_FEAR_GREED_WARMUP)
        ).not.toBeNull();
    });

    it('returns all-zero factors for perfectly flat series', () => {
        const factors = computeMarketFactorsAtT(series(), LAST);

        expect(factors).not.toBeNull();
        expect(factors?.momentum).toBeCloseTo(0, 12);
        expect(factors?.volatility).toBeCloseTo(0, 12);
        expect(factors?.safeHaven).toBeCloseTo(0, 12);
        expect(factors?.junkBond).toBeCloseTo(0, 12);
        expect(factors?.breadth).toBeCloseTo(0, 12);
    });

    it('scores an index above its 125-day average as positive momentum', () => {
        const factors = computeMarketFactorsAtT(
            series({ sp500: endingAt(100, 200) }),
            LAST
        );

        // MA125 = (124*100 + 200)/125 = 100.8 → (200 - 100.8)/100.8
        expect(factors?.momentum).toBeCloseTo((200 - 100.8) / 100.8, 10);
    });

    it('scores an index below its 125-day average as negative momentum', () => {
        const factors = computeMarketFactorsAtT(
            series({ sp500: endingAt(100, 50) }),
            LAST
        );

        expect(factors?.momentum).toBeLessThan(0);
    });

    it('inverts the VIX distance so a calm VIX reads as greed', () => {
        const spike = computeMarketFactorsAtT(
            series({ vix: endingAt(20, 40) }),
            LAST
        );
        const calm = computeMarketFactorsAtT(
            series({ vix: endingAt(20, 10) }),
            LAST
        );

        expect(spike?.volatility).toBeLessThan(0);
        expect(calm?.volatility).toBeGreaterThan(0);
    });

    it('computes safe-haven demand as the equity minus treasury 20-session return', () => {
        const factors = computeMarketFactorsAtT(
            series({
                sp500: endingAt(100, 110),
                longTreasury: endingAt(100, 105),
            }),
            LAST
        );

        expect(factors?.safeHaven).toBeCloseTo(0.1 - 0.05, 12);
    });

    it('computes junk-bond demand as the high-yield minus investment-grade 20-session return', () => {
        const factors = computeMarketFactorsAtT(
            series({
                highYield: endingAt(100, 102),
                investmentGrade: endingAt(100, 101),
            }),
            LAST
        );

        expect(factors?.junkBond).toBeCloseTo(0.02 - 0.01, 12);
    });

    it('computes breadth as the equal-weight minus cap-weight 20-session return', () => {
        const factors = computeMarketFactorsAtT(
            series({
                equalWeight: endingAt(100, 103),
                sp500: endingAt(100, 101),
            }),
            LAST
        );

        expect(factors?.breadth).toBeCloseTo(0.03 - 0.01, 12);
    });

    it('returns null before the return window is populated', () => {
        // `t` here is inside the 20-session return window, so `returnOver`
        // reaches its `from < 0` guard rather than the moving-average guards.
        expect(
            computeMarketFactorsAtT(
                series(),
                MARKET_FEAR_GREED_WINDOWS.RETURN - 1
            )
        ).toBeNull();
    });

    it.each(['sp500', 'vix'] as const)(
        'returns null when the %s moving-average base is non-positive',
        key => {
            expect(
                computeMarketFactorsAtT(series({ [key]: constant(0) }), LAST)
            ).toBeNull();
        }
    );

    it.each([
        'sp500',
        'longTreasury',
        'highYield',
        'investmentGrade',
        'equalWeight',
    ] as const)('returns null when the %s return base is non-positive', key => {
        const closes = constant(100);
        closes[LAST - MARKET_FEAR_GREED_WINDOWS.RETURN] = 0;

        expect(
            computeMarketFactorsAtT(series({ [key]: closes }), LAST)
        ).toBeNull();
    });
});
