import { describe, expect, it } from 'vitest';

import {
    MARKET_FEAR_GREED_SERIES_KEYS,
    type MarketFearGreedInput,
} from '@/domain/indicators/marketFearGreed/types';
import {
    computeMarketFearGreedHistory,
    computeMarketFearGreedIndex,
} from '@/domain/indicators/marketFearGreed/walkForward';

import expected from './fixtures/regression.json';

/**
 * Deterministic 300-session input. An LCG random walk (never `Math.random`)
 * with an independent seed per series so every factor moves.
 */
function regressionInput(): MarketFearGreedInput {
    const input = {} as MarketFearGreedInput;
    MARKET_FEAR_GREED_SERIES_KEYS.forEach((key, k) => {
        let state = 11 + k * 17;
        let close = 100;
        input[key] = Array.from({ length: 300 }, (_, i) => {
            state = (state * 1103515245 + 12345) % 2147483648;
            close *= 1 + (state / 2147483648 - 0.5) * 0.05;
            const ms = Date.UTC(2021, 0, 1) + i * 86_400_000;
            return { date: new Date(ms).toISOString().slice(0, 10), close };
        });
    });
    return input;
}

/**
 * Regression lock for the US/KR market index. `fixtures/regression.json` was
 * captured from the implementation *before* the composition / walk-forward
 * machinery was generalised for the crypto index; any drift here means the
 * shared refactor changed market-index behaviour.
 */
describe('market Fear & Greed regression lock', () => {
    it('reproduces the captured snapshot exactly', () => {
        expect(
            JSON.stringify(computeMarketFearGreedIndex(regressionInput()))
        ).toBe(JSON.stringify(expected.snapshot));
    });

    it('reproduces the captured history exactly', () => {
        expect(
            JSON.stringify(computeMarketFearGreedHistory(regressionInput()))
        ).toBe(JSON.stringify(expected.history));
    });
});
