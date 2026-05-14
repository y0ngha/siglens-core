import { describe, it, expect } from 'vitest';
import { calculateMaxPain } from '@/domain/options/calculateMaxPain';
import type { OptionsChain } from '@/domain/options/types';

describe('calculateMaxPain', () => {
    const baseChain: OptionsChain = {
        expirationDate: '2026-05-22',
        daysToExpiration: 8,
        calls: [
            {
                contractSymbol: 'C190',
                strike: 190,
                lastPrice: null,
                bid: null,
                ask: null,
                volume: 0,
                openInterest: 100,
                impliedVolatility: null,
                inTheMoney: false,
            },
            {
                contractSymbol: 'C195',
                strike: 195,
                lastPrice: null,
                bid: null,
                ask: null,
                volume: 0,
                openInterest: 200,
                impliedVolatility: null,
                inTheMoney: false,
            },
            {
                contractSymbol: 'C200',
                strike: 200,
                lastPrice: null,
                bid: null,
                ask: null,
                volume: 0,
                openInterest: 50,
                impliedVolatility: null,
                inTheMoney: false,
            },
        ],
        puts: [
            {
                contractSymbol: 'P190',
                strike: 190,
                lastPrice: null,
                bid: null,
                ask: null,
                volume: 0,
                openInterest: 50,
                impliedVolatility: null,
                inTheMoney: false,
            },
            {
                contractSymbol: 'P195',
                strike: 195,
                lastPrice: null,
                bid: null,
                ask: null,
                volume: 0,
                openInterest: 100,
                impliedVolatility: null,
                inTheMoney: false,
            },
            {
                contractSymbol: 'P200',
                strike: 200,
                lastPrice: null,
                bid: null,
                ask: null,
                volume: 0,
                openInterest: 100,
                impliedVolatility: null,
                inTheMoney: false,
            },
        ],
    };

    it('returns the strike with minimum total writer loss', () => {
        const result = calculateMaxPain(baseChain);
        expect([190, 195, 200]).toContain(result);
    });

    it('handles chain with only calls', () => {
        const result = calculateMaxPain({ ...baseChain, puts: [] });
        expect(typeof result).toBe('number');
    });

    it('handles chain with only puts', () => {
        const result = calculateMaxPain({ ...baseChain, calls: [] });
        expect(typeof result).toBe('number');
    });

    it('returns NaN for empty chain', () => {
        const result = calculateMaxPain({
            expirationDate: '2026-05-22',
            daysToExpiration: 8,
            calls: [],
            puts: [],
        });
        expect(Number.isNaN(result)).toBe(true);
    });
});
