import { describe, expect, it } from 'vitest';

import { FEAR_GREED_CONFIDENCE_THRESHOLDS } from '@/domain/indicators/fearGreed/composition';
import { MARKET_FEAR_GREED_WARMUP } from '@/domain/indicators/marketFearGreed/factors';
import {
    MARKET_FEAR_GREED_FACTOR_KEYS,
    MARKET_FEAR_GREED_SERIES_KEYS,
    type MarketDailyClose,
    type MarketFearGreedInput,
} from '@/domain/indicators/marketFearGreed/types';
import {
    computeMarketFearGreedHistory,
    computeMarketFearGreedIndex,
} from '@/domain/indicators/marketFearGreed/walkForward';

/** Deterministic LCG — tests must not depend on Math.random. */
function lcg(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state * 1103515245 + 12345) % 2147483648;
        return state / 2147483648;
    };
}

function isoDate(index: number): string {
    // 2020-01-01 + index days, stepping in UTC to stay DST-proof.
    const ms = Date.UTC(2020, 0, 1) + index * 86_400_000;
    return new Date(ms).toISOString().slice(0, 10);
}

/** A random-walk close series of `length` sessions starting at `start`. */
function walk(length: number, start: number, seed: number): MarketDailyClose[] {
    const next = lcg(seed);
    let close = start;
    return Array.from({ length }, (_, i) => {
        close *= 1 + (next() - 0.5) * 0.04;
        return { date: isoDate(i), close };
    });
}

function marketInput(length: number): MarketFearGreedInput {
    const input = {} as MarketFearGreedInput;
    MARKET_FEAR_GREED_SERIES_KEYS.forEach((key, i) => {
        input[key] = walk(length, 100, 7 + i * 13);
    });
    return input;
}

function emptyInput(): MarketFearGreedInput {
    const input = {} as MarketFearGreedInput;
    for (const key of MARKET_FEAR_GREED_SERIES_KEYS) input[key] = [];
    return input;
}

function truncate(
    input: MarketFearGreedInput,
    length: number
): MarketFearGreedInput {
    const out = {} as MarketFearGreedInput;
    for (const key of MARKET_FEAR_GREED_SERIES_KEYS) {
        out[key] = input[key].slice(0, length);
    }
    return out;
}

/** Warm-up + LIMITED sample — the first index that can produce a score. */
const FIRST_SCORED_INDEX =
    MARKET_FEAR_GREED_WARMUP + FEAR_GREED_CONFIDENCE_THRESHOLDS.LIMITED;

describe('computeMarketFearGreedIndex', () => {
    it('returns null when the series share no session', () => {
        expect(computeMarketFearGreedIndex(emptyInput())).toBeNull();
    });

    it('returns null while the latest session is still inside the warm-up window', () => {
        expect(
            computeMarketFearGreedIndex(marketInput(MARKET_FEAR_GREED_WARMUP))
        ).toBeNull();
    });

    it('returns null until the walk-forward sample reaches the LIMITED threshold', () => {
        expect(
            computeMarketFearGreedIndex(marketInput(FIRST_SCORED_INDEX))
        ).toBeNull();
        expect(
            computeMarketFearGreedIndex(marketInput(FIRST_SCORED_INDEX + 1))
        ).not.toBeNull();
    });

    it('produces a bounded score, five factors, and the latest session date', () => {
        const input = marketInput(400);
        const snapshot = computeMarketFearGreedIndex(input);

        expect(snapshot).not.toBeNull();
        expect(snapshot?.score).toBeGreaterThanOrEqual(0);
        expect(snapshot?.score).toBeLessThanOrEqual(100);
        expect(snapshot?.factors.map(f => f.key)).toEqual([
            ...MARKET_FEAR_GREED_FACTOR_KEYS,
        ]);
        expect(snapshot?.confidence).toBe('normal');
        expect(snapshot?.asOf).toBe(isoDate(399));
    });

    it('scores the latest session shared by all six series, not the latest overall', () => {
        const input = marketInput(400);
        input.vix = input.vix.slice(0, 399);

        expect(computeMarketFearGreedIndex(input)?.asOf).toBe(isoDate(398));
    });

    it('agrees with the final point of the history series', () => {
        const input = marketInput(400);
        const snapshot = computeMarketFearGreedIndex(input);
        const history = computeMarketFearGreedHistory(input);
        const last = history[history.length - 1];

        expect(last.date).toBe(snapshot?.asOf);
        expect(last.score).toBeCloseTo(snapshot?.score as number, 12);
        expect(last.label).toBe(snapshot?.label);
    });
});

describe('computeMarketFearGreedHistory', () => {
    it('returns an empty series when the series share no session', () => {
        expect(computeMarketFearGreedHistory(emptyInput())).toEqual([]);
    });

    it('emits one point per common session, ascending by date', () => {
        const history = computeMarketFearGreedHistory(marketInput(300));

        expect(history).toHaveLength(300);
        expect(history.map(p => p.date)).toEqual(
            [...history.map(p => p.date)].sort()
        );
    });

    it('leaves warm-up sessions unscored and scores every session after them', () => {
        const history = computeMarketFearGreedHistory(marketInput(300));

        expect(
            history.slice(0, FIRST_SCORED_INDEX).every(p => p.score === null)
        ).toBe(true);
        expect(
            history.slice(FIRST_SCORED_INDEX).every(p => p.score !== null)
        ).toBe(true);
    });

    it('pairs a null score with a null label and a scored point with a label', () => {
        const history = computeMarketFearGreedHistory(marketInput(300));

        expect(
            history.every(p => (p.score === null) === (p.label === null))
        ).toBe(true);
    });

    it('does not look ahead — appending sessions never rewrites earlier points', () => {
        const full = marketInput(400);
        const short = computeMarketFearGreedHistory(truncate(full, 250));
        const long = computeMarketFearGreedHistory(full);

        expect(long.slice(0, 250)).toEqual(short);
    });
});
