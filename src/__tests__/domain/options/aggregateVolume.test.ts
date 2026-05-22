import { describe, it, expect } from 'vitest';
import { aggregateVolume } from '@/domain/options/aggregateVolume';
import type { OptionsChain, OptionsContract } from '@/domain/options/types';

const makeContract = (strike: number, volume: number): OptionsContract => ({
    contractSymbol: `X${strike}`,
    strike,
    lastPrice: null,
    bid: null,
    ask: null,
    volume,
    openInterest: 0,
    impliedVolatility: null,
    inTheMoney: false,
});

describe('aggregateVolume', () => {
    it('groups by strike, sums call/put volume separately, sorts ascending', () => {
        const chain: OptionsChain = {
            expirationDate: '2026-05-22',
            daysToExpiration: 8,
            calls: [makeContract(200, 100), makeContract(195, 200)],
            puts: [makeContract(195, 50), makeContract(200, 150)],
        };
        const result = aggregateVolume(chain);
        expect(result).toEqual([
            { strike: 195, callVolume: 200, putVolume: 50 },
            { strike: 200, callVolume: 100, putVolume: 150 },
        ]);
    });

    it('fills 0 for missing puts side', () => {
        const chain: OptionsChain = {
            expirationDate: '2026-05-22',
            daysToExpiration: 8,
            calls: [makeContract(200, 100)],
            puts: [],
        };
        const result = aggregateVolume(chain);
        expect(result).toEqual([
            { strike: 200, callVolume: 100, putVolume: 0 },
        ]);
    });

    it('fills 0 for missing calls side (puts-only strike)', () => {
        // Covers the puts loop branch where `prev` is undefined for a strike
        // that has no calls — `prev?.callVolume ?? 0` evaluates to 0.
        const chain: OptionsChain = {
            expirationDate: '2026-05-22',
            daysToExpiration: 8,
            calls: [],
            puts: [makeContract(200, 150)],
        };
        const result = aggregateVolume(chain);
        expect(result).toEqual([
            { strike: 200, callVolume: 0, putVolume: 150 },
        ]);
    });

    it('calls에 동일 strike가 두 번 등장하면 callVolume을 합산한다', () => {
        const chain: OptionsChain = {
            expirationDate: '2026-05-22',
            daysToExpiration: 8,
            calls: [makeContract(200, 100), makeContract(200, 50)],
            puts: [],
        };
        const result = aggregateVolume(chain);
        expect(result).toEqual([
            { strike: 200, callVolume: 150, putVolume: 0 },
        ]);
    });

    it('returns empty array for empty chain', () => {
        const result = aggregateVolume({
            expirationDate: '2026-05-22',
            daysToExpiration: 8,
            calls: [],
            puts: [],
        });
        expect(result).toEqual([]);
    });
});
