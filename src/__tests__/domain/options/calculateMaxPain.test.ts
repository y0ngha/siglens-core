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
        // Pain table for baseChain (calls 190:100, 195:200, 200:50;
        // puts 190:50, 195:100, 200:100):
        //  candidate=190: call 0 + put (195-190)*100+(200-190)*100=1500 → 1500
        //  candidate=195: call (195-190)*100=500 + put (200-195)*100=500 → 1000
        //  candidate=200: call (200-190)*100+(200-195)*200=2000 + put 0 → 2000
        // Minimum is 195.
        const result = calculateMaxPain(baseChain);
        expect(result).toBe(195);
    });

    it('only-calls chain — min total writer loss at the lowest strike', () => {
        // No puts → pain at strike X = sum(max(X-K, 0) * OI) for all call rows.
        // calls (190:100, 195:200, 200:50):
        //  X=190 → 0
        //  X=195 → (195-190)*100 = 500
        //  X=200 → (200-190)*100 + (200-195)*200 = 2000
        // Minimum at 190.
        const result = calculateMaxPain({ ...baseChain, puts: [] });
        expect(result).toBe(190);
    });

    it('only-puts chain — min total writer loss at the highest strike', () => {
        // No calls → pain at strike X = sum(max(K-X, 0) * OI) for all put rows.
        // puts (190:50, 195:100, 200:100):
        //  X=190 → (195-190)*100 + (200-190)*100 = 1500
        //  X=195 → (200-195)*100 = 500
        //  X=200 → 0
        // Minimum at 200.
        const result = calculateMaxPain({ ...baseChain, calls: [] });
        expect(result).toBe(200);
    });

    it('returns null for empty chain', () => {
        const result = calculateMaxPain({
            expirationDate: '2026-05-22',
            daysToExpiration: 8,
            calls: [],
            puts: [],
        });
        expect(result).toBeNull();
    });

    it('JSON.stringify of null result yields "null" literal (not number)', () => {
        // Regression guard: NaN also stringifies to "null", but explicit
        // null keeps semantics honest. Tests that consumers can safely
        // round-trip the metric through JSON.
        const result = calculateMaxPain({
            expirationDate: '2026-05-22',
            daysToExpiration: 8,
            calls: [],
            puts: [],
        });
        expect(JSON.stringify(result)).toBe('null');
    });
});
