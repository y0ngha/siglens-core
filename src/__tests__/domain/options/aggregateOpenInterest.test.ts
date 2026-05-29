import { describe, it, expect } from 'vitest';
import { aggregateOpenInterest } from '@/domain/options/aggregateOpenInterest';
import type { OptionsChain, OptionsContract } from '@/domain/options/types';

const makeContract = (strike: number, oi: number): OptionsContract => ({
    contractSymbol: `X${strike}`,
    strike,
    lastPrice: null,
    bid: null,
    ask: null,
    volume: 0,
    openInterest: oi,
    impliedVolatility: null,
    inTheMoney: false,
});

describe('aggregateOpenInterest', () => {
    it('groups by strike, sums call/put OI separately, sorts ascending', () => {
        const chain: OptionsChain = {
            expirationDate: '2026-05-22',
            daysToExpiration: 8,
            calls: [makeContract(200, 100), makeContract(195, 200)],
            puts: [makeContract(195, 50), makeContract(200, 150)],
        };
        const result = aggregateOpenInterest(chain);
        expect(result).toEqual([
            { strike: 195, callOpenInterest: 200, putOpenInterest: 50 },
            { strike: 200, callOpenInterest: 100, putOpenInterest: 150 },
        ]);
    });

    it('fills 0 for missing puts side', () => {
        const chain: OptionsChain = {
            expirationDate: '2026-05-22',
            daysToExpiration: 8,
            calls: [makeContract(200, 100)],
            puts: [],
        };
        const result = aggregateOpenInterest(chain);
        expect(result).toEqual([
            { strike: 200, callOpenInterest: 100, putOpenInterest: 0 },
        ]);
    });

    it('fills 0 for missing calls side (puts-only strike)', () => {
        // Covers the puts loop branch where `prev` is undefined for a strike
        // that has no calls — `prev?.callOpenInterest ?? 0` evaluates to 0.
        const chain: OptionsChain = {
            expirationDate: '2026-05-22',
            daysToExpiration: 8,
            calls: [],
            puts: [makeContract(200, 150)],
        };
        const result = aggregateOpenInterest(chain);
        expect(result).toEqual([
            { strike: 200, callOpenInterest: 0, putOpenInterest: 150 },
        ]);
    });

    it('returns empty array for empty chain', () => {
        const result = aggregateOpenInterest({
            expirationDate: '2026-05-22',
            daysToExpiration: 8,
            calls: [],
            puts: [],
        });
        expect(result).toEqual([]);
    });

    it('aggregates multiple contracts at the same strike (sums each side)', () => {
        // Two calls and two puts at strike 200: the second contract on each
        // side finds `prev` already in the map, exercising the
        // `prev?.callOpenInterest ?? 0` / `prev?.putOpenInterest ?? 0`
        // prev-defined branches (line 23-24).
        const chain: OptionsChain = {
            expirationDate: '2026-05-22',
            daysToExpiration: 8,
            calls: [makeContract(200, 100), makeContract(200, 50)],
            puts: [makeContract(200, 20), makeContract(200, 10)],
        };
        const result = aggregateOpenInterest(chain);
        expect(result).toEqual([
            { strike: 200, callOpenInterest: 150, putOpenInterest: 30 },
        ]);
    });
});
