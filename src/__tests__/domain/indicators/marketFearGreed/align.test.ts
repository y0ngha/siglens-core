import { describe, expect, it } from 'vitest';

import { alignSeries } from '@/domain/indicators/marketFearGreed/align';
import {
    MARKET_FEAR_GREED_SERIES_KEYS,
    type MarketDailyClose,
    type MarketFearGreedInput,
} from '@/domain/indicators/marketFearGreed/types';

function input(
    overrides: Partial<MarketFearGreedInput> = {},
    fallback: MarketDailyClose[] = []
): MarketFearGreedInput {
    const base = {} as MarketFearGreedInput;
    for (const key of MARKET_FEAR_GREED_SERIES_KEYS) {
        base[key] = overrides[key] ?? fallback;
    }
    return base;
}

const THREE_DAYS: MarketDailyClose[] = [
    { date: '2026-01-02', close: 10 },
    { date: '2026-01-03', close: 11 },
    { date: '2026-01-05', close: 12 },
];

describe('alignSeries', () => {
    it('returns empty dates when every series is empty', () => {
        expect(alignSeries(input())).toEqual({
            dates: [],
            closes: {
                sp500: [],
                vix: [],
                longTreasury: [],
                highYield: [],
                investmentGrade: [],
                equalWeight: [],
            },
        });
    });

    it('keeps only dates present in every series', () => {
        const result = alignSeries(
            input(
                {
                    vix: [
                        { date: '2026-01-02', close: 20 },
                        { date: '2026-01-05', close: 22 },
                    ],
                },
                THREE_DAYS
            )
        );

        expect(result.dates).toEqual(['2026-01-02', '2026-01-05']);
        expect(result.closes.sp500).toEqual([10, 12]);
        expect(result.closes.vix).toEqual([20, 22]);
    });

    it('sorts the joined dates ascending regardless of input order', () => {
        const descending = [...THREE_DAYS].reverse();
        expect(alignSeries(input({}, descending)).dates).toEqual([
            '2026-01-02',
            '2026-01-03',
            '2026-01-05',
        ]);
    });

    it('drops non-finite and non-positive closes, which then drop the whole date', () => {
        const withHoles: MarketDailyClose[] = [
            { date: '2026-01-02', close: 10 },
            { date: '2026-01-03', close: 0 },
            { date: '2026-01-05', close: Number.NaN },
            { date: '2026-01-06', close: -5 },
            { date: '2026-01-07', close: 13 },
        ];

        const result = alignSeries(input({ vix: withHoles }, THREE_DAYS));

        expect(result.dates).toEqual(['2026-01-02']);
    });

    it('resolves duplicate dates with the last occurrence', () => {
        const duplicated: MarketDailyClose[] = [
            { date: '2026-01-02', close: 10 },
            { date: '2026-01-02', close: 99 },
        ];

        const result = alignSeries(input({}, duplicated));

        expect(result.dates).toEqual(['2026-01-02']);
        expect(result.closes.sp500).toEqual([99]);
    });

    it('treats a series missing at the JS boundary as empty rather than throwing', () => {
        const partial = input({}, THREE_DAYS);
        // A consumer without TypeScript can hand us an object with a hole.
        delete (partial as Partial<MarketFearGreedInput>).vix;

        expect(alignSeries(partial).dates).toEqual([]);
    });

    it('returns index-aligned arrays of equal length for every key', () => {
        const result = alignSeries(input({}, THREE_DAYS));

        for (const key of MARKET_FEAR_GREED_SERIES_KEYS) {
            expect(result.closes[key]).toHaveLength(result.dates.length);
        }
    });
});
