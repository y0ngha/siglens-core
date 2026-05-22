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

    it('exposes topVolumeStrikes as the top-3 strikes by combined call+put volume', () => {
        const callV = (strike: number, volume: number): OptionsContract => ({
            contractSymbol: `${strike}C`,
            strike,
            lastPrice: null,
            bid: null,
            ask: null,
            volume,
            openInterest: 0,
            impliedVolatility: 0.3,
            inTheMoney: false,
        });
        const putV = (strike: number, volume: number): OptionsContract => ({
            contractSymbol: `${strike}P`,
            strike,
            lastPrice: null,
            bid: null,
            ask: null,
            volume,
            openInterest: 0,
            impliedVolatility: 0.3,
            inTheMoney: false,
        });
        const c: OptionsChain = {
            expirationDate: '2026-06-20',
            daysToExpiration: 30,
            calls: [
                callV(100, 5),
                callV(110, 400),
                callV(120, 80),
                callV(130, 250),
            ],
            puts: [putV(100, 10), putV(110, 50)],
        };
        const summary = summarizeChainForLlm(c, 115);
        expect(summary.topVolumeStrikes).toHaveLength(3);
        // Combined volume: 110 (450), 130 (250), 120 (80). 100 (15) is dropped.
        expect(summary.topVolumeStrikes.map(s => s.strike)).toEqual([
            110, 130, 120,
        ]);
        expect(summary.topVolumeStrikes[0]).toEqual({
            strike: 110,
            callVolume: 400,
            putVolume: 50,
        });
    });

    it('builds topOiBidAskSummary for the same strikes as topOpenInterestStrikes with correct mid/spread', () => {
        const call = (
            strike: number,
            bid: number | null,
            ask: number | null,
            oi: number
        ): OptionsContract => ({
            contractSymbol: `${strike}C`,
            strike,
            lastPrice: null,
            bid,
            ask,
            volume: 0,
            openInterest: oi,
            impliedVolatility: 0.3,
            inTheMoney: false,
        });
        const put = (
            strike: number,
            bid: number | null,
            ask: number | null,
            oi: number
        ): OptionsContract => ({
            contractSymbol: `${strike}P`,
            strike,
            lastPrice: null,
            bid,
            ask,
            volume: 0,
            openInterest: oi,
            impliedVolatility: 0.3,
            inTheMoney: false,
        });
        const c: OptionsChain = {
            expirationDate: '2026-06-20',
            daysToExpiration: 30,
            calls: [
                call(100, 1.0, 1.2, 500),
                call(110, 0.5, 0.6, 300),
                call(120, 0.1, 0.2, 100),
            ],
            puts: [
                put(100, 0.8, 1.0, 200),
                put(110, 1.5, 1.7, 400),
                put(120, 3.0, 3.2, 50),
            ],
        };
        const summary = summarizeChainForLlm(c, 105);
        const oiStrikes = summary.topOpenInterestStrikes.map(s => s.strike);
        const quoteStrikes = summary.topOiBidAskSummary.map(q => q.strike);
        expect(quoteStrikes).toEqual(oiStrikes);

        const quote100 = summary.topOiBidAskSummary.find(q => q.strike === 100);
        expect(quote100).toBeDefined();
        expect(quote100!.callMidPrice).toBeCloseTo(1.1, 5);
        expect(quote100!.callSpread).toBeCloseTo(0.2, 5);
        expect(quote100!.putMidPrice).toBeCloseTo(0.9, 5);
        expect(quote100!.putSpread).toBeCloseTo(0.2, 5);
    });

    it('returns null mid/spread when a side has a missing bid or ask', () => {
        const c: OptionsChain = {
            expirationDate: '2026-06-20',
            daysToExpiration: 30,
            calls: [
                {
                    contractSymbol: '100C',
                    strike: 100,
                    lastPrice: null,
                    bid: null,
                    ask: 1.2,
                    volume: 0,
                    openInterest: 100,
                    impliedVolatility: 0.3,
                    inTheMoney: false,
                },
            ],
            puts: [
                {
                    contractSymbol: '100P',
                    strike: 100,
                    lastPrice: null,
                    bid: 0.8,
                    ask: null,
                    volume: 0,
                    openInterest: 100,
                    impliedVolatility: 0.3,
                    inTheMoney: false,
                },
            ],
        };
        const summary = summarizeChainForLlm(c, 100);
        const quote = summary.topOiBidAskSummary.find(q => q.strike === 100);
        expect(quote).toBeDefined();
        expect(quote!.callMidPrice).toBeNull();
        expect(quote!.callSpread).toBeNull();
        expect(quote!.putMidPrice).toBeNull();
        expect(quote!.putSpread).toBeNull();
    });

    it('top OI strike에 한쪽 side contract가 없으면 해당 side의 mid/spread는 null로 반환된다', () => {
        // 같은 strike(100)에 call만 있고 put이 없는 chain.
        // top OI 계산은 call OI만으로도 top에 올라가므로 strike 100이
        // topOpenInterestStrikes에 포함되고, topOiBidAskSummary에선
        // putMidPrice/putSpread = null 이어야 한다 — 이게 곧
        // `computeMidAndSpread(undefined)` 분기 커버리지.
        const callOnlyChain: OptionsChain = {
            expirationDate: '2026-06-20',
            daysToExpiration: 30,
            calls: [
                {
                    contractSymbol: 'CALL_ONLY',
                    strike: 100,
                    lastPrice: 5,
                    bid: 4.9,
                    ask: 5.1,
                    volume: 10,
                    openInterest: 9999,
                    impliedVolatility: 0.3,
                    inTheMoney: false,
                },
            ],
            puts: [],
        };
        const callOnlySummary = summarizeChainForLlm(callOnlyChain, 100);
        const callOnlyQuote = callOnlySummary.topOiBidAskSummary.find(
            q => q.strike === 100
        );
        expect(callOnlyQuote).toBeDefined();
        expect(callOnlyQuote!.callMidPrice).toBeCloseTo(5, 5);
        expect(callOnlyQuote!.callSpread).toBeCloseTo(0.2, 5);
        expect(callOnlyQuote!.putMidPrice).toBeNull();
        expect(callOnlyQuote!.putSpread).toBeNull();

        // 역방향 — put-only 케이스도 동일하게 callMid/callSpread가 null.
        const putOnlyChain: OptionsChain = {
            expirationDate: '2026-06-20',
            daysToExpiration: 30,
            calls: [],
            puts: [
                {
                    contractSymbol: 'PUT_ONLY',
                    strike: 100,
                    lastPrice: 3,
                    bid: 2.9,
                    ask: 3.1,
                    volume: 10,
                    openInterest: 9999,
                    impliedVolatility: 0.3,
                    inTheMoney: false,
                },
            ],
        };
        const putOnlySummary = summarizeChainForLlm(putOnlyChain, 100);
        const putOnlyQuote = putOnlySummary.topOiBidAskSummary.find(
            q => q.strike === 100
        );
        expect(putOnlyQuote).toBeDefined();
        expect(putOnlyQuote!.callMidPrice).toBeNull();
        expect(putOnlyQuote!.callSpread).toBeNull();
        expect(putOnlyQuote!.putMidPrice).toBeCloseTo(3, 5);
        expect(putOnlyQuote!.putSpread).toBeCloseTo(0.2, 5);
    });

    it('returns null mid/spread when the quote is crossed (spread < 0)', () => {
        const c: OptionsChain = {
            expirationDate: '2026-06-20',
            daysToExpiration: 30,
            calls: [
                {
                    contractSymbol: '100C',
                    strike: 100,
                    lastPrice: null,
                    bid: 1.5,
                    ask: 1.0, // ask < bid → bad data
                    volume: 0,
                    openInterest: 100,
                    impliedVolatility: 0.3,
                    inTheMoney: false,
                },
            ],
            puts: [
                {
                    contractSymbol: '100P',
                    strike: 100,
                    lastPrice: null,
                    bid: 0.8,
                    ask: 1.0,
                    volume: 0,
                    openInterest: 100,
                    impliedVolatility: 0.3,
                    inTheMoney: false,
                },
            ],
        };
        const summary = summarizeChainForLlm(c, 100);
        const quote = summary.topOiBidAskSummary.find(q => q.strike === 100);
        expect(quote).toBeDefined();
        expect(quote!.callMidPrice).toBeNull();
        expect(quote!.callSpread).toBeNull();
        // The put side has a valid (non-crossed) quote and stays populated.
        expect(quote!.putMidPrice).toBeCloseTo(0.9, 5);
        expect(quote!.putSpread).toBeCloseTo(0.2, 5);
    });
});
