import { describe, it, expect } from 'vitest';
import { calculatePutCallRatio } from '@/domain/options/calculatePutCallRatio';
import type { OptionsChain, OptionsContract } from '@/domain/options/types';

const makeContract = (strike: number, oi: number): OptionsContract => ({
    contractSymbol: `X${strike}`,
    strike, lastPrice: null, bid: null, ask: null,
    volume: 0, openInterest: oi, impliedVolatility: null, inTheMoney: false,
});

describe('calculatePutCallRatio', () => {
    it('returns sum(putOI) / sum(callOI)', () => {
        const chain: OptionsChain = {
            expirationDate: '2026-05-22',
            daysToExpiration: 8,
            calls: [makeContract(195, 100), makeContract(200, 200)],
            puts: [makeContract(195, 150), makeContract(200, 150)],
        };
        expect(calculatePutCallRatio(chain)).toBeCloseTo(1.0, 5);
    });

    it('returns +Infinity when call OI is 0 but put OI > 0', () => {
        const chain: OptionsChain = {
            expirationDate: '2026-05-22',
            daysToExpiration: 8,
            calls: [makeContract(195, 0)],
            puts: [makeContract(195, 100)],
        };
        expect(calculatePutCallRatio(chain)).toBe(Number.POSITIVE_INFINITY);
    });

    it('returns 0 when both call OI and put OI are 0', () => {
        const chain: OptionsChain = {
            expirationDate: '2026-05-22',
            daysToExpiration: 8,
            calls: [makeContract(195, 0)],
            puts: [makeContract(195, 0)],
        };
        expect(calculatePutCallRatio(chain)).toBe(0);
    });
});
