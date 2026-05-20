import { describe, it, expect } from 'vitest';
import { calculatePutCallRatio } from '@/domain/options/calculatePutCallRatio';
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

    it('returns null when call OI is 0 but put OI > 0 (ratio undefined)', () => {
        const chain: OptionsChain = {
            expirationDate: '2026-05-22',
            daysToExpiration: 8,
            calls: [makeContract(195, 0)],
            puts: [makeContract(195, 100)],
        };
        expect(calculatePutCallRatio(chain)).toBeNull();
    });

    it('returns null when both call OI and put OI are 0', () => {
        const chain: OptionsChain = {
            expirationDate: '2026-05-22',
            daysToExpiration: 8,
            calls: [makeContract(195, 0)],
            puts: [makeContract(195, 0)],
        };
        expect(calculatePutCallRatio(chain)).toBeNull();
    });

    it('returns 0 when put OI is 0 but call OI > 0', () => {
        const chain: OptionsChain = {
            expirationDate: '2026-05-22',
            daysToExpiration: 8,
            calls: [makeContract(195, 100)],
            puts: [makeContract(195, 0)],
        };
        expect(calculatePutCallRatio(chain)).toBe(0);
    });

    it('JSON.stringify of null result yields "null" literal (not number)', () => {
        // Regression guard: NaN/Infinity also stringify to "null", but
        // explicit null keeps semantics honest. Tests that consumers can
        // safely round-trip the metric through JSON.
        const chain: OptionsChain = {
            expirationDate: '2026-05-22',
            daysToExpiration: 8,
            calls: [makeContract(195, 0)],
            puts: [makeContract(195, 100)],
        };
        expect(JSON.stringify(calculatePutCallRatio(chain))).toBe('null');
    });
});
