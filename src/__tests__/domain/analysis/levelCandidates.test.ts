import { describe, it, expect } from 'vitest';
import {
    computeLevelCandidates,
    MAX_LEVEL_CANDIDATES_PER_SIDE,
} from '@/domain/analysis/levelCandidates';
import { EMPTY_SMC_RESULT } from '@/domain/indicators/constants';
import { makeSwing } from '@/__tests__/domain/analysis/levelCandidatesTestHelpers';
import type { Bar, IndicatorResult, SMCResult } from '@/domain/types';

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

const makeSmc = (overrides: Partial<SMCResult>): SMCResult => ({
    ...EMPTY_SMC_RESULT,
    ...overrides,
});

/** A bar that spans `[low, high]`; other OHLCV fields are filler. */
const makeBar = (low: number, high: number, time = 0): Bar => ({
    time,
    open: low,
    high,
    low,
    close: high,
    volume: 1,
});

describe('levelCandidates', () => {
    describe('computeLevelCandidates', () => {
        describe('when the current price is not usable', () => {
            it('returns empty sides for a zero price', () => {
                const result = computeLevelCandidates(0, makeIndicators(), []);
                expect(result).toEqual({ support: [], resistance: [] });
            });

            it('returns empty sides for a non-finite price', () => {
                const result = computeLevelCandidates(
                    Number.NaN,
                    makeIndicators(),
                    []
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
                    indicators,
                    []
                );

                // 95 and 90 are >0.5% apart, so they stay as separate clusters.
                expect(support.flatMap(c => c.sources).sort()).toEqual([
                    'POC',
                    'VAL',
                ]);
                expect(resistance.flatMap(c => c.sources)).toEqual(['VAH']);
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
                    indicators,
                    []
                );

                const sources = [...support, ...resistance].flatMap(
                    c => c.sources
                );
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
                    indicators,
                    []
                );

                const supportSources = support.flatMap(c => c.sources);
                const resistanceSources = resistance.flatMap(c => c.sources);

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
                    indicators,
                    []
                );

                expect(support).toEqual([
                    {
                        price: 96,
                        source: 'MA20',
                        sources: ['MA20'],
                        touchCount: 0,
                        distancePercent: 4,
                    },
                ]);
            });

            it('skips a moving average that is entirely null', () => {
                const indicators = makeIndicators({
                    ma: { 20: [null, null] },
                });

                const { support, resistance } = computeLevelCandidates(
                    CURRENT_PRICE,
                    indicators,
                    []
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
                    indicators,
                    []
                );

                expect(resistance).toEqual([]);
                expect(support.flatMap(c => c.sources)).toEqual(['BB lower']);
            });
        });

        describe('filtering of unusable level prices', () => {
            it('discards non-positive and non-finite candidate prices', () => {
                const indicators = makeIndicators({
                    ma: { 20: [0], 50: [Number.POSITIVE_INFINITY], 60: [95] },
                });

                const { support } = computeLevelCandidates(
                    CURRENT_PRICE,
                    indicators,
                    []
                );

                expect(support.flatMap(c => c.sources)).toEqual(['MA60']);
            });
        });

        describe('confluence clustering', () => {
            it('merges two sources within tolerance into one candidate', () => {
                // 95.0 and 95.3 are 0.32% apart (< 0.5% tolerance) → one cluster.
                const indicators = makeIndicators({
                    ma: { 20: [95.0] },
                    ema: { 9: [95.3] },
                });

                const { support } = computeLevelCandidates(
                    CURRENT_PRICE,
                    indicators,
                    []
                );

                expect(support).toHaveLength(1);
                expect(support[0].sources.sort()).toEqual(['EMA9', 'MA20']);
                expect(support[0].sources).toHaveLength(2);
                // Mean of the two member prices.
                expect(support[0].price).toBeCloseTo(95.15, 10);
            });

            it('keeps sources outside tolerance as separate candidates', () => {
                // 95.0 and 96.0 are ~1.05% apart (> 0.5% tolerance) → two clusters.
                const indicators = makeIndicators({
                    ma: { 20: [95.0] },
                    ema: { 9: [96.0] },
                });

                const { support } = computeLevelCandidates(
                    CURRENT_PRICE,
                    indicators,
                    []
                );

                expect(support).toHaveLength(2);
                expect(support.every(c => c.sources.length === 1)).toBe(true);
            });

            it('de-duplicates identical source labels in a cluster', () => {
                // Two swing lows at the same price collapse to one 'swing low'.
                const indicators = makeIndicators({
                    smc: makeSmc({
                        swingLows: [makeSwing(95, 'low'), makeSwing(95, 'low')],
                    }),
                });

                const { support } = computeLevelCandidates(
                    CURRENT_PRICE,
                    indicators,
                    []
                );

                expect(support).toHaveLength(1);
                expect(support[0].sources).toEqual(['swing low']);
            });
        });

        describe('tested-history touch count', () => {
            it('counts each bar that trades through the level band', () => {
                // Level at 95; band is 95 ± 0.25% = [94.7625, 95.2375].
                const indicators = makeIndicators({ ma: { 20: [95] } });
                const bars: Bar[] = [
                    makeBar(94, 96, 0), // spans 95 → touch
                    makeBar(95, 95, 1), // sits on 95 → touch
                    makeBar(90, 92, 2), // entirely below band → miss
                    makeBar(98, 99, 3), // entirely above band → miss
                    makeBar(94.8, 95.1, 4), // inside band → touch
                ];

                const { support } = computeLevelCandidates(
                    CURRENT_PRICE,
                    indicators,
                    bars
                );

                expect(support[0].touchCount).toBe(3);
            });

            it('reports zero touches for a level price never traded', () => {
                const indicators = makeIndicators({ ma: { 20: [95] } });
                const bars: Bar[] = [makeBar(80, 85, 0), makeBar(70, 75, 1)];

                const { support } = computeLevelCandidates(
                    CURRENT_PRICE,
                    indicators,
                    bars
                );

                expect(support[0].touchCount).toBe(0);
            });

            it('ignores bars with non-finite low/high', () => {
                const indicators = makeIndicators({ ma: { 20: [95] } });
                const bars: Bar[] = [
                    makeBar(94, 96, 0), // valid touch
                    { ...makeBar(94, 96, 1), low: Number.NaN },
                    { ...makeBar(94, 96, 2), high: Number.POSITIVE_INFINITY },
                ];

                const { support } = computeLevelCandidates(
                    CURRENT_PRICE,
                    indicators,
                    bars
                );

                expect(support[0].touchCount).toBe(1);
            });

            it('reports zero touches when there are no bars', () => {
                const indicators = makeIndicators({ ma: { 20: [95] } });

                const { support } = computeLevelCandidates(
                    CURRENT_PRICE,
                    indicators,
                    []
                );

                expect(support[0].touchCount).toBe(0);
            });
        });

        describe('deprecated `source` alias', () => {
            it('populates `source` with the primary (first) cluster source', () => {
                const indicators = makeIndicators({
                    volumeProfile: {
                        poc: 95,
                        vah: 110,
                        val: 90,
                        profile: [],
                    },
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
                    indicators,
                    []
                );

                for (const candidate of [...support, ...resistance]) {
                    expect(candidate.source).toBe(candidate.sources[0]);
                }
            });
        });

        describe('optional bars argument', () => {
            it('compiles and works when called without bars', () => {
                const indicators = makeIndicators({
                    volumeProfile: { poc: 95, vah: 110, val: 90, profile: [] },
                    ma: { 20: [98] },
                });

                // Two-arg call (no `bars`) must compile and behave like an
                // empty-bars call: every touchCount is 0.
                const { support, resistance } = computeLevelCandidates(
                    CURRENT_PRICE,
                    indicators
                );

                const all = [...support, ...resistance];
                expect(all.length).toBeGreaterThan(0);
                expect(all.every(c => c.touchCount === 0)).toBe(true);
            });
        });

        describe('strength ranking', () => {
            it('ranks a far-but-strong level above a near-but-weak one', () => {
                // Near, weak: single source at 99, never tested.
                // Far, strong: 90/90.2 confluence (2 sources) tested repeatedly.
                const indicators = makeIndicators({
                    ma: { 20: [99], 50: [90.0] },
                    ema: { 9: [90.2] },
                });
                const bars: Bar[] = [
                    makeBar(89.9, 90.3, 0),
                    makeBar(89.9, 90.3, 1),
                    makeBar(89.9, 90.3, 2),
                ];

                const { support } = computeLevelCandidates(
                    CURRENT_PRICE,
                    indicators,
                    bars
                );

                expect(support[0].sources).toHaveLength(2);
                expect(support[0].price).toBeCloseTo(90.1, 10);
                expect(support[1].sources).toEqual(['MA20']);
                expect(support[1].price).toBe(99);
            });

            it('breaks equal-strength ties by nearest-to-price', () => {
                // Two lone, untested levels (equal strength) → nearest wins.
                const indicators = makeIndicators({
                    ma: { 20: [98], 50: [80] },
                });

                const { support } = computeLevelCandidates(
                    CURRENT_PRICE,
                    indicators,
                    []
                );

                expect(support.map(c => c.price)).toEqual([98, 80]);
            });
        });

        describe('capping', () => {
            it('caps each side to the maximum candidate count', () => {
                const ma: Record<number, (number | null)[]> = {};
                // Spread levels >0.5% apart so none cluster together.
                for (let i = 1; i <= MAX_LEVEL_CANDIDATES_PER_SIDE + 3; i++) {
                    ma[i] = [CURRENT_PRICE - i];
                }
                const indicators = makeIndicators({ ma });

                const { support } = computeLevelCandidates(
                    CURRENT_PRICE,
                    indicators,
                    []
                );

                expect(support).toHaveLength(MAX_LEVEL_CANDIDATES_PER_SIDE);
                // All equal strength (lone, untested) → nearest five survive.
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
                    indicators,
                    []
                );

                expect(resistance[0].distancePercent).toBe(10);
                expect(support[0].distancePercent).toBe(10);
            });
        });

        describe('empty inputs', () => {
            it('returns empty sides when no indicators produce levels', () => {
                const result = computeLevelCandidates(
                    CURRENT_PRICE,
                    makeIndicators(),
                    []
                );

                expect(result).toEqual({ support: [], resistance: [] });
            });
        });
    });
});
