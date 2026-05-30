import { describe, it, expect } from 'vitest';
import {
    computeLevelCandidates,
    MAX_LEVEL_CANDIDATES_PER_SIDE,
} from '@/domain/analysis/levelCandidates';
import { EMPTY_SMC_RESULT } from '@/domain/indicators/constants';
import type { IndicatorResult, SMCResult, SMCSwingPoint } from '@/domain/types';

const CURRENT_PRICE = 100;

const makeIndicators = (
    overrides?: Partial<IndicatorResult>
): IndicatorResult => ({
    rsi: [],
    cci: [],
    vwap: [],
    macd: [],
    bollinger: [],
    dmi: [],
    stochastic: [],
    stochRsi: [],
    ma: {},
    ema: {},
    volumeProfile: null,
    ichimoku: [],
    atr: [],
    obv: [],
    parabolicSar: [],
    williamsR: [],
    supertrend: [],
    mfi: [],
    keltnerChannel: [],
    cmf: [],
    donchianChannel: [],
    buySellVolume: [],
    squeezeMomentum: [],
    ...overrides,
    smc: overrides?.smc ?? EMPTY_SMC_RESULT,
});

const makeSwing = (
    price: number,
    type: SMCSwingPoint['type']
): SMCSwingPoint => ({ index: 0, price, type });

const makeSmc = (overrides: Partial<SMCResult>): SMCResult => ({
    ...EMPTY_SMC_RESULT,
    ...overrides,
});

describe('levelCandidates', () => {
    describe('computeLevelCandidates', () => {
        describe('when the current price is not usable', () => {
            it('returns empty sides for a zero price', () => {
                const result = computeLevelCandidates(0, makeIndicators());
                expect(result).toEqual({ support: [], resistance: [] });
            });

            it('returns empty sides for a non-finite price', () => {
                const result = computeLevelCandidates(
                    Number.NaN,
                    makeIndicators()
                );
                expect(result).toEqual({ support: [], resistance: [] });
            });
        });

        describe('side assignment relative to the current price', () => {
            it('places levels below the price into support and above into resistance', () => {
                const indicators = makeIndicators({
                    volumeProfile: {
                        poc: 95,
                        vah: 110,
                        val: 90,
                        profile: [],
                    },
                });

                const { support, resistance } = computeLevelCandidates(
                    CURRENT_PRICE,
                    indicators
                );

                expect(support.map(c => c.source)).toEqual(['POC', 'VAL']);
                expect(resistance.map(c => c.source)).toEqual(['VAH']);
                expect(support.every(c => c.price < CURRENT_PRICE)).toBe(true);
                expect(resistance.every(c => c.price > CURRENT_PRICE)).toBe(
                    true
                );
            });

            it('drops levels exactly equal to the current price', () => {
                const indicators = makeIndicators({
                    volumeProfile: {
                        poc: CURRENT_PRICE,
                        vah: 105,
                        val: 95,
                        profile: [],
                    },
                });

                const { support, resistance } = computeLevelCandidates(
                    CURRENT_PRICE,
                    indicators
                );

                const sources = [...support, ...resistance].map(c => c.source);
                expect(sources).not.toContain('POC');
            });
        });

        describe('source labels', () => {
            it('labels moving averages, Bollinger bounds, and swings', () => {
                const indicators = makeIndicators({
                    ma: { 20: [98], 50: [102] },
                    ema: { 9: [99] },
                    bollinger: [{ upper: 108, middle: 100, lower: 92 }],
                    smc: makeSmc({
                        swingHighs: [makeSwing(106, 'high')],
                        swingLows: [makeSwing(94, 'low')],
                    }),
                });

                const { support, resistance } = computeLevelCandidates(
                    CURRENT_PRICE,
                    indicators
                );

                const supportSources = support.map(c => c.source);
                const resistanceSources = resistance.map(c => c.source);

                expect(supportSources).toContain('MA20');
                expect(supportSources).toContain('EMA9');
                expect(supportSources).toContain('BB lower');
                expect(supportSources).toContain('swing low');
                expect(resistanceSources).toContain('MA50');
                expect(resistanceSources).toContain('BB upper');
                expect(resistanceSources).toContain('swing high');
            });

            it('uses the last non-null moving-average value', () => {
                const indicators = makeIndicators({
                    ma: { 20: [80, null, 96] },
                });

                const { support } = computeLevelCandidates(
                    CURRENT_PRICE,
                    indicators
                );

                expect(support).toEqual([
                    { price: 96, source: 'MA20', distancePercent: 4 },
                ]);
            });

            it('skips a moving average that is entirely null', () => {
                const indicators = makeIndicators({
                    ma: { 20: [null, null] },
                });

                const { support, resistance } = computeLevelCandidates(
                    CURRENT_PRICE,
                    indicators
                );

                expect(support).toEqual([]);
                expect(resistance).toEqual([]);
            });

            it('omits a Bollinger bound that is null', () => {
                const indicators = makeIndicators({
                    bollinger: [{ upper: null, middle: 100, lower: 90 }],
                });

                const { support, resistance } = computeLevelCandidates(
                    CURRENT_PRICE,
                    indicators
                );

                expect(resistance).toEqual([]);
                expect(support.map(c => c.source)).toEqual(['BB lower']);
            });
        });

        describe('filtering of unusable level prices', () => {
            it('discards non-positive and non-finite candidate prices', () => {
                const indicators = makeIndicators({
                    ma: { 20: [0], 50: [Number.POSITIVE_INFINITY], 60: [95] },
                });

                const { support } = computeLevelCandidates(
                    CURRENT_PRICE,
                    indicators
                );

                expect(support.map(c => c.source)).toEqual(['MA60']);
            });
        });

        describe('ordering and capping', () => {
            it('sorts each side nearest-to-price first', () => {
                const indicators = makeIndicators({
                    ma: { 20: [90], 50: [80], 60: [99] },
                });

                const { support } = computeLevelCandidates(
                    CURRENT_PRICE,
                    indicators
                );

                expect(support.map(c => c.price)).toEqual([99, 90, 80]);
            });

            it('caps each side to the maximum candidate count', () => {
                const ma: Record<number, (number | null)[]> = {};
                for (let i = 1; i <= MAX_LEVEL_CANDIDATES_PER_SIDE + 3; i++) {
                    ma[i] = [CURRENT_PRICE - i];
                }
                const indicators = makeIndicators({ ma });

                const { support } = computeLevelCandidates(
                    CURRENT_PRICE,
                    indicators
                );

                expect(support).toHaveLength(MAX_LEVEL_CANDIDATES_PER_SIDE);
                expect(support[0].price).toBe(CURRENT_PRICE - 1);
            });
        });

        describe('distance percentage', () => {
            it('reports the absolute distance from the current price in percent', () => {
                const indicators = makeIndicators({
                    volumeProfile: { poc: 110, vah: 110, val: 90, profile: [] },
                });

                const { support, resistance } = computeLevelCandidates(
                    CURRENT_PRICE,
                    indicators
                );

                expect(resistance[0].distancePercent).toBe(10);
                expect(support[0].distancePercent).toBe(10);
            });
        });
    });
});
