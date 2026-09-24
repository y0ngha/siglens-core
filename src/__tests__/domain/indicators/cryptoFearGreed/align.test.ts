import { describe, expect, it } from 'vitest';

import { alignCryptoSeries } from '@/domain/indicators/cryptoFearGreed/align';
import type {
    CryptoDailyBar,
    CryptoFearGreedInput,
} from '@/domain/indicators/cryptoFearGreed/types';

/** 2026-01-02 is a Friday, so index 1–2 fall on the weekend. */
const DAYS = ['2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05'] as const;

function bars(closes: number[], volume = 1): CryptoDailyBar[] {
    return closes.map((close, i) => ({ date: DAYS[i], close, volume }));
}

function input(overrides: Partial<CryptoFearGreedInput> = {}) {
    return {
        benchmark: bars([10, 11, 12, 13]),
        safeHaven: [
            { date: '2026-01-02', close: 100 },
            { date: '2026-01-05', close: 103 },
        ],
        universe: { a: bars([1, 2, 3, 4]), b: bars([5, 6, 7, 8]) },
        ...overrides,
    } satisfies CryptoFearGreedInput;
}

describe('alignCryptoSeries', () => {
    it('forward-fills the safe-haven close across the weekend', () => {
        const result = alignCryptoSeries(input());

        expect(result.dates).toEqual([...DAYS]);
        expect(result.safeHaven).toEqual([100, 100, 100, 103]);
        expect(result.benchmark).toEqual([10, 11, 12, 13]);
        expect(result.universe).toEqual([
            [1, 2, 3, 4],
            [5, 6, 7, 8],
        ]);
    });

    it('drops leading sessions before the first safe-haven close', () => {
        const result = alignCryptoSeries(
            input({ safeHaven: [{ date: '2026-01-04', close: 50 }] })
        );

        expect(result.dates).toEqual(['2026-01-04', '2026-01-05']);
        expect(result.safeHaven).toEqual([50, 50]);
        expect(result.benchmark).toEqual([12, 13]);
    });

    it('removes a day from every series when one coin is missing it', () => {
        const gappy = bars([1, 2, 3, 4]).filter(b => b.date !== '2026-01-03');
        const result = alignCryptoSeries(
            input({ universe: { a: gappy, b: bars([5, 6, 7, 8]) } })
        );

        expect(result.dates).toEqual([
            '2026-01-02',
            '2026-01-04',
            '2026-01-05',
        ]);
        expect(result.benchmark).toEqual([10, 12, 13]);
        expect(result.universe[1]).toEqual([5, 7, 8]);
    });

    it('sums benchmark and universe volume per session', () => {
        const result = alignCryptoSeries(
            input({
                benchmark: bars([10, 11, 12, 13], 100),
                universe: {
                    a: bars([1, 2, 3, 4], 10),
                    b: bars([5, 6, 7, 8], 1),
                },
            })
        );

        expect(result.totalVolume).toEqual([111, 111, 111, 111]);
    });

    it('accepts unsorted, duplicated input (last write wins)', () => {
        const benchmark = [...bars([10, 11, 12, 13])].reverse();
        benchmark.push({ date: '2026-01-02', close: 99, volume: 1 });
        const result = alignCryptoSeries(input({ benchmark }));

        expect(result.dates).toEqual([...DAYS]);
        expect(result.benchmark).toEqual([99, 11, 12, 13]);
    });

    it('drops bars with a non-positive close or an invalid volume', () => {
        const benchmark = bars([10, 11, 12, 13]);
        benchmark[1] = { ...benchmark[1], close: 0 };
        benchmark[2] = { ...benchmark[2], volume: Number.NaN };
        const result = alignCryptoSeries(input({ benchmark }));

        expect(result.dates).toEqual(['2026-01-02', '2026-01-05']);
    });

    it('returns no sessions when a series is missing at the JS boundary', () => {
        const partial = {
            universe: { a: bars([1]) },
        } as unknown as CryptoFearGreedInput;

        expect(alignCryptoSeries(partial).dates).toEqual([]);
    });
});
