import { describe, it, expect } from 'vitest';
import { summarizeChainForLlm } from '@/domain/options/summarizeChainForLlm';
import type { OptionsChain, OptionsContract } from '@/domain/options/types';

function contract(
    strike: number,
    iv: number | null,
    callOI: number,
    putOI: number,
    side: 'call' | 'put'
): OptionsContract {
    return {
        contractSymbol: `${strike}${side === 'call' ? 'C' : 'P'}`,
        strike,
        lastPrice: null,
        bid: null,
        ask: null,
        volume: 0,
        openInterest: side === 'call' ? callOI : putOI,
        impliedVolatility: iv,
        inTheMoney: false,
    };
}

function chain(strikes: ReadonlyArray<number>): OptionsChain {
    return {
        expirationDate: '2026-06-20',
        daysToExpiration: 30,
        calls: strikes.map(s => contract(s, 0.25, 100, 0, 'call')),
        puts: strikes.map(s => contract(s, 0.3, 0, 80, 'put')),
    };
}

describe('summarizeChainForLlm', () => {
    it('anchors ATM IV on the real spot when underlyingPrice is provided', () => {
        const c: OptionsChain = {
            expirationDate: '2026-06-20',
            daysToExpiration: 30,
            calls: [
                contract(100, 0.5, 50, 0, 'call'),
                contract(150, 0.3, 50, 0, 'call'),
                contract(200, 0.5, 50, 0, 'call'),
            ],
            puts: [],
        };
        // Spot near 150 → the 150-strike (IV 0.3) wins over far-OTM 100/200.
        expect(summarizeChainForLlm(c, 150).atmImpliedVolatility).toBeCloseTo(
            0.3,
            5
        );
    });

    it('falls back to median strike when underlyingPrice is omitted', () => {
        const c: OptionsChain = {
            expirationDate: '2026-06-20',
            daysToExpiration: 30,
            calls: [
                contract(100, 0.5, 50, 0, 'call'),
                contract(150, 0.3, 50, 0, 'call'),
                contract(200, 0.5, 50, 0, 'call'),
            ],
            puts: [],
        };
        // Median strike across calls = 150 → same answer when spot omitted.
        expect(summarizeChainForLlm(c).atmImpliedVolatility).toBeCloseTo(
            0.3,
            5
        );
    });

    it('falls back to median strike when underlyingPrice is NaN', () => {
        // Covers the `Number.isFinite(underlyingPrice)` guard: NaN passes the
        // typeof check but fails isFinite, so pickAtmIv must fall back to the
        // median strike rather than anchoring on NaN.
        const c: OptionsChain = {
            expirationDate: '2026-06-20',
            daysToExpiration: 30,
            calls: [
                contract(100, 0.5, 50, 0, 'call'),
                contract(150, 0.3, 50, 0, 'call'),
                contract(200, 0.5, 50, 0, 'call'),
            ],
            puts: [],
        };
        expect(summarizeChainForLlm(c, NaN).atmImpliedVolatility).toBeCloseTo(
            0.3,
            5
        );
    });

    it('returns null ATM IV for an empty chain', () => {
        const c: OptionsChain = {
            expirationDate: '2026-06-20',
            daysToExpiration: 30,
            calls: [],
            puts: [],
        };
        expect(summarizeChainForLlm(c).atmImpliedVolatility).toBeNull();
    });

    it('returns null ATM IV when every contract has null impliedVolatility', () => {
        const c: OptionsChain = {
            expirationDate: '2026-06-20',
            daysToExpiration: 30,
            calls: [contract(150, null, 50, 0, 'call')],
            puts: [contract(150, null, 0, 50, 'put')],
        };
        expect(summarizeChainForLlm(c, 150).atmImpliedVolatility).toBeNull();
    });

    it('exposes top-3 OI strikes sorted descending by combined OI', () => {
        const c: OptionsChain = {
            expirationDate: '2026-06-20',
            daysToExpiration: 30,
            calls: [
                contract(100, 0.3, 10, 0, 'call'),
                contract(110, 0.3, 500, 0, 'call'),
                contract(120, 0.3, 100, 0, 'call'),
                contract(130, 0.3, 300, 0, 'call'),
            ],
            puts: [
                contract(100, 0.3, 0, 20, 'put'),
                contract(110, 0.3, 0, 50, 'put'),
            ],
        };
        const summary = summarizeChainForLlm(c, 115);
        expect(summary.topOpenInterestStrikes).toHaveLength(3);
        // Strikes by combined OI: 110 (550), 130 (300), 120 (100). 100 is dropped.
        expect(summary.topOpenInterestStrikes.map(s => s.strike)).toEqual([
            110, 130, 120,
        ]);
    });

    it('propagates underlyingPrice through to implied move (via ATM IV)', () => {
        const c = chain([90, 100, 110]);
        const summary = summarizeChainForLlm(c, 100);
        expect(summary.atmImpliedVolatility).not.toBeNull();
        expect(summary.impliedMovePercent).not.toBeNull();
        expect(summary.impliedMovePercent).toBeGreaterThan(0);
    });
});
