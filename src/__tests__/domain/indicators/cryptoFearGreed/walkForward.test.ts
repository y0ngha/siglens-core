import { describe, expect, it } from 'vitest';

import { CRYPTO_FEAR_GREED_WARMUP } from '@/domain/indicators/cryptoFearGreed/factors';
import {
    CRYPTO_FEAR_GREED_FACTOR_KEYS,
    type CryptoDailyBar,
    type CryptoFearGreedInput,
} from '@/domain/indicators/cryptoFearGreed/types';
import {
    computeCryptoFearGreedHistory,
    computeCryptoFearGreedIndex,
} from '@/domain/indicators/cryptoFearGreed/walkForward';
import { FEAR_GREED_CONFIDENCE_THRESHOLDS } from '@/domain/indicators/fearGreed/composition';

import fixture from './fixtures/crypto-200.json';

/** Deterministic LCG — tests must not depend on Math.random. */
function lcg(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state * 1103515245 + 12345) % 2147483648;
        return state / 2147483648;
    };
}

function isoDate(index: number): string {
    const ms = Date.UTC(2024, 0, 1) + index * 86_400_000;
    return new Date(ms).toISOString().slice(0, 10);
}

function walk(length: number, seed: number): CryptoDailyBar[] {
    const next = lcg(seed);
    let close = 100;
    return Array.from({ length }, (_, i) => {
        close *= 1 + (next() - 0.5) * 0.08;
        return { date: isoDate(i), close, volume: 1000 * (0.5 + next()) };
    });
}

function syntheticInput(length: number, coins = 5): CryptoFearGreedInput {
    return {
        benchmark: walk(length, 3),
        // Gold every session is fine here; weekend forward-fill is covered in align.test.
        safeHaven: walk(length, 5).map(({ date, close }) => ({ date, close })),
        universe: Object.fromEntries(
            Array.from({ length: coins }, (_, i) => [
                `c${i}`,
                walk(length, 11 + i * 7),
            ])
        ),
    };
}

function truncate(
    input: CryptoFearGreedInput,
    length: number
): CryptoFearGreedInput {
    return {
        benchmark: input.benchmark.slice(0, length),
        safeHaven: input.safeHaven.slice(0, length),
        universe: Object.fromEntries(
            Object.entries(input.universe).map(([k, v]) => [
                k,
                v.slice(0, length),
            ])
        ),
    };
}

type Columns = { close: number[]; volume: number[] };

/** Rebuild `CryptoFearGreedInput` from the columnar real-data fixture. */
function fixtureInput(): CryptoFearGreedInput {
    const toBars = ({ close, volume }: Columns): CryptoDailyBar[] =>
        fixture.dates.map((date, i) => ({
            date,
            close: close[i],
            volume: volume[i],
        }));
    return {
        benchmark: toBars(fixture.benchmark),
        safeHaven: fixture.safeHaven.map(([date, close]) => ({
            date: date as string,
            close: close as number,
        })),
        universe: Object.fromEntries(
            Object.entries(fixture.universe).map(([k, v]) => [k, toBars(v)])
        ),
    };
}

/** Warm-up + LIMITED sample — the first index that can produce a score. */
const FIRST_SCORED_INDEX =
    CRYPTO_FEAR_GREED_WARMUP + FEAR_GREED_CONFIDENCE_THRESHOLDS.LIMITED;

describe('computeCryptoFearGreedIndex', () => {
    describe('null paths', () => {
        it('returns null when the universe has fewer than 5 coins', () => {
            expect(
                computeCryptoFearGreedIndex(syntheticInput(300, 4))
            ).toBeNull();
        });

        it('returns null when the series share no session', () => {
            expect(
                computeCryptoFearGreedIndex({
                    benchmark: [],
                    safeHaven: [],
                    universe: {},
                })
            ).toBeNull();
        });

        it('returns null while the latest session is inside the warm-up window', () => {
            expect(
                computeCryptoFearGreedIndex(
                    syntheticInput(CRYPTO_FEAR_GREED_WARMUP)
                )
            ).toBeNull();
        });

        it('returns null until the walk-forward sample reaches LIMITED', () => {
            expect(
                computeCryptoFearGreedIndex(syntheticInput(FIRST_SCORED_INDEX))
            ).toBeNull();
            expect(
                computeCryptoFearGreedIndex(
                    syntheticInput(FIRST_SCORED_INDEX + 1)
                )
            ).not.toBeNull();
        });
    });

    it('produces a bounded score, six factors in order, and the latest date', () => {
        const snapshot = computeCryptoFearGreedIndex(syntheticInput(300));

        expect(snapshot?.score).toBeGreaterThanOrEqual(0);
        expect(snapshot?.score).toBeLessThanOrEqual(100);
        expect(snapshot?.factors.map(f => f.key)).toEqual([
            ...CRYPTO_FEAR_GREED_FACTOR_KEYS,
        ]);
        expect(snapshot?.confidence).toBe('normal');
        expect(snapshot?.asOf).toBe(isoDate(299));
    });

    it('matches the validated Python prototype on real FMP data', () => {
        // Reference: scratch prototype (proto.py + variants.py, final factor set)
        // run on exactly this 200-session BTC + 5-coin + gold slice.
        const snapshot = computeCryptoFearGreedIndex(fixtureInput());

        expect(snapshot?.asOf).toBe('2026-09-24');
        expect(snapshot?.score).toBeCloseTo(60.111111111111114, 9);
        expect(snapshot?.sampleSize).toBe(75);
    });
});

describe('computeCryptoFearGreedHistory', () => {
    it('emits one point per common session with null warm-up points', () => {
        const history = computeCryptoFearGreedHistory(syntheticInput(300));

        expect(history).toHaveLength(300);
        expect(
            history.slice(0, FIRST_SCORED_INDEX).every(p => p.score === null)
        ).toBe(true);
        expect(
            history.slice(FIRST_SCORED_INDEX).every(p => p.score !== null)
        ).toBe(true);
    });

    it('scores every session null when the universe has fewer than 5 coins', () => {
        const history = computeCryptoFearGreedHistory(syntheticInput(300, 4));

        expect(history).toHaveLength(300);
        expect(history.every(p => p.score === null && p.label === null)).toBe(
            true
        );
    });

    it('agrees with the snapshot at the final point', () => {
        const input = fixtureInput();
        const snapshot = computeCryptoFearGreedIndex(input);
        const last = computeCryptoFearGreedHistory(input).at(-1);

        expect(last?.date).toBe(snapshot?.asOf);
        expect(last?.score).toBe(snapshot?.score);
        expect(last?.label).toBe(snapshot?.label);
    });

    it('does not look ahead — appending sessions never rewrites earlier points', () => {
        const full = syntheticInput(320);
        const short = computeCryptoFearGreedHistory(truncate(full, 220));
        const long = computeCryptoFearGreedHistory(full);

        expect(long.slice(0, 220)).toEqual(short);
    });
});
