import { describe, expect, it } from 'vitest';

import {
    computeCryptoFactorsAtT,
    CRYPTO_FEAR_GREED_WARMUP,
    CRYPTO_FEAR_GREED_WINDOWS,
} from '@/domain/indicators/cryptoFearGreed/factors';
import type { AlignedCryptoSeries } from '@/domain/indicators/cryptoFearGreed/types';

const W = CRYPTO_FEAR_GREED_WINDOWS;
const LENGTH = W.MOMENTUM_MA;
const LAST = LENGTH - 1;

function constant(value: number): number[] {
    return new Array(LENGTH).fill(value);
}

/** Flat at `base`, then `end` at the final index. */
function endingAt(base: number, end: number): number[] {
    const values = constant(base);
    values[LAST] = end;
    return values;
}

/** Strictly rising series — every session is an up-day. */
function rising(): number[] {
    return Array.from({ length: LENGTH }, (_, i) => 100 * 1.001 ** i);
}

/** Flat series at 100, five flat universe coins, unit volume, unless overridden. */
function series(
    overrides: Partial<AlignedCryptoSeries> = {}
): AlignedCryptoSeries {
    return {
        dates: Array.from({ length: LENGTH }, (_, i) => `d${i}`),
        benchmark: constant(100),
        safeHaven: constant(100),
        universe: Array.from({ length: 5 }, () => constant(100)),
        totalVolume: constant(1),
        ...overrides,
    };
}

describe('CRYPTO_FEAR_GREED_WARMUP', () => {
    it('is max(125 - 1, 90, 30) = 124', () => {
        expect(CRYPTO_FEAR_GREED_WARMUP).toBe(124);
    });
});

describe('computeCryptoFactorsAtT', () => {
    describe('warm-up', () => {
        it('returns null one session before the warm-up index', () => {
            expect(
                computeCryptoFactorsAtT(series(), CRYPTO_FEAR_GREED_WARMUP - 1)
            ).toBeNull();
        });

        it('returns a bundle at the warm-up index', () => {
            expect(
                computeCryptoFactorsAtT(series(), CRYPTO_FEAR_GREED_WARMUP)
            ).not.toBeNull();
        });
    });

    describe('momentum', () => {
        it('is the benchmark distance from its 125-session MA', () => {
            const f = computeCryptoFactorsAtT(
                series({ benchmark: endingAt(100, 200) }),
                LAST
            );

            // MA125 = (124*100 + 200)/125 = 100.8
            expect(f?.momentum).toBeCloseTo((200 - 100.8) / 100.8, 12);
        });
    });

    describe('downside_volatility', () => {
        it('is 0 (not -0) on an all-up series', () => {
            const f = computeCryptoFactorsAtT(
                series({ benchmark: rising() }),
                LAST
            );

            expect(f?.downside_volatility).toBe(0);
        });

        it('is the negated root-mean-square of the negative log returns', () => {
            const f = computeCryptoFactorsAtT(
                series({ benchmark: endingAt(100, 50) }),
                LAST
            );

            // One −ln 2 return inside a 30-session window of zeros.
            expect(f?.downside_volatility).toBeCloseTo(
                -Math.sqrt(Math.log(0.5) ** 2 / W.DOWNSIDE_VOLATILITY),
                12
            );
        });
    });

    describe('safe_haven', () => {
        it('is the benchmark minus safe-haven 20-session return', () => {
            const f = computeCryptoFactorsAtT(
                series({
                    benchmark: endingAt(100, 110),
                    safeHaven: endingAt(100, 105),
                }),
                LAST
            );

            expect(f?.safe_haven).toBeCloseTo(0.1 - 0.05, 12);
        });
    });

    describe('breadth', () => {
        it('is the share of benchmark + universe coins above their 50-session MA', () => {
            const f = computeCryptoFactorsAtT(
                series({
                    benchmark: endingAt(100, 101),
                    universe: [
                        endingAt(100, 101),
                        endingAt(100, 101),
                        endingAt(100, 99),
                        constant(100),
                        constant(100),
                    ],
                }),
                LAST
            );

            // Benchmark + 2 coins above; a flat coin equals its MA (not above).
            expect(f?.breadth).toBeCloseTo(3 / 6, 12);
        });
    });

    describe('alt_season', () => {
        it('is the share of universe coins beating the benchmark over 90 sessions', () => {
            const f = computeCryptoFactorsAtT(
                series({
                    benchmark: endingAt(100, 110),
                    universe: [
                        endingAt(100, 120),
                        endingAt(100, 111),
                        endingAt(100, 110),
                        endingAt(100, 105),
                        constant(100),
                    ],
                }),
                LAST
            );

            // Ties with the benchmark do not count as beating it.
            expect(f?.alt_season).toBeCloseTo(2 / 5, 12);
        });
    });

    describe('volume_flow', () => {
        it('is 1 when every session is an up-day', () => {
            const f = computeCryptoFactorsAtT(
                series({ benchmark: rising() }),
                LAST
            );

            expect(f?.volume_flow).toBe(1);
        });

        it('is the up-day share of total volume over 30 sessions', () => {
            // Only the final session is a down-day, and it carries 10× volume.
            const volume = constant(1);
            volume[LAST] = 10;
            const f = computeCryptoFactorsAtT(
                series({ benchmark: endingAt(100, 90), totalVolume: volume }),
                LAST
            );

            // A flat close counts as up (close ≥ previous close).
            expect(f?.volume_flow).toBeCloseTo(29 / 39, 12);
        });

        it('makes the bundle null when the window carries no volume', () => {
            expect(
                computeCryptoFactorsAtT(
                    series({ totalVolume: constant(0) }),
                    LAST
                )
            ).toBeNull();
        });
    });

    describe('uncomputable inputs', () => {
        it('returns null when a universe coin has a non-positive MA', () => {
            const universe = Array.from({ length: 5 }, () => constant(100));
            universe[0] = constant(0);

            expect(
                computeCryptoFactorsAtT(series({ universe }), LAST)
            ).toBeNull();
        });

        it('returns null when a universe coin has a non-positive 90-session base', () => {
            const coin = constant(100);
            coin[LAST - W.ALT_SEASON] = 0;
            const universe = Array.from({ length: 5 }, () => constant(100));
            universe[0] = coin;

            expect(
                computeCryptoFactorsAtT(series({ universe }), LAST)
            ).toBeNull();
        });
    });
});
