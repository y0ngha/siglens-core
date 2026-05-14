import { describe, it, expect } from 'vitest';
import { sanitizeOptionsChain } from '@/domain/options/sanitizeOptionsChain';
import type { OptionsChain, OptionsContract } from '@/domain/options/types';

const makeContract = (
    strike: number,
    oi: number,
    volume = 0
): OptionsContract => ({
    contractSymbol: `X${strike}`,
    strike,
    lastPrice: null,
    bid: null,
    ask: null,
    volume,
    openInterest: oi,
    impliedVolatility: null,
    inTheMoney: false,
});

describe('sanitizeOptionsChain', () => {
    it('drops contracts with negative OI', () => {
        const chain: OptionsChain = {
            expirationDate: '2026-05-22',
            daysToExpiration: 8,
            calls: [makeContract(195, 100), makeContract(200, -50)],
            puts: [],
        };
        const result = sanitizeOptionsChain(chain);
        expect(result?.calls).toHaveLength(1);
        expect(result?.calls[0].strike).toBe(195);
    });

    it('drops duplicate strikes (keeps first)', () => {
        const chain: OptionsChain = {
            expirationDate: '2026-05-22',
            daysToExpiration: 8,
            calls: [makeContract(195, 100), makeContract(195, 200)],
            puts: [],
        };
        const result = sanitizeOptionsChain(chain);
        expect(result?.calls).toHaveLength(1);
        expect(result?.calls[0].openInterest).toBe(100);
    });

    it('rejects entire chain when >5% of contracts are invalid', () => {
        const chain: OptionsChain = {
            expirationDate: '2026-05-22',
            daysToExpiration: 8,
            calls: [
                makeContract(190, 100),
                makeContract(195, -1), // invalid
                makeContract(200, -2), // invalid (2/3 > 5%)
            ],
            puts: [],
        };
        expect(sanitizeOptionsChain(chain)).toBeNull();
    });
});
