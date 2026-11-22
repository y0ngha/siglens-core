import { describe, expect, it } from 'vitest';
import {
    BOLLINGER_PCTB_BY_TF,
    HURST_DECISIVE_MARGIN,
    isStateNotable,
    readIndicatorState,
    readBollingerPctB,
    readKeltnerBand,
    readRegressionLevel,
    readVwapDistance,
    VR_DECISIVE_MARGIN,
} from '@/domain/analysis/skillGatingPredicates';
import { priceQuoting } from '@/domain/analysis/promptFormat';
import {
    CRSI_OVERBOUGHT,
    CRSI_OVERSOLD,
    EMPTY_INDICATOR_RESULT,
    HURST_RANDOM_WALK,
    MACDV_OVERBOUGHT,
    REGRESSION_R2_SIGNIFICANT,
    STOCHASTIC_OVERBOUGHT_LEVEL,
    STOCHASTIC_OVERSOLD_LEVEL,
    VR_RANDOM_WALK,
    WILLIAMS_R_OVERBOUGHT_LEVEL,
    WILLIAMS_R_OVERSOLD_LEVEL,
} from '@/domain/indicators/constants';
import type {
    IndicatorResult,
    SkillSelectionContext,
    SkillStateFeature,
    SkillStatePredicate,
} from '@/domain/types';

// The gate (`isStateNotable`) and the card reader (`readIndicatorState`) are one function:
// the gate is "the reader found a state". Each case below restates the rule of the gate as it
// was before the refactor, so the refactor cannot move a threshold.

const ctxOf = (
    over: Partial<IndicatorResult>,
    extra: Partial<SkillSelectionContext> = {}
): SkillSelectionContext => ({
    indicators: { ...EMPTY_INDICATOR_RESULT, ...over },
    signals: [],
    timeframe: '1Day',
    detectedCandles: [],
    patternCandidates: [],
    price: 100,
    atrPercent: 1,
    ...extra,
});

const predicate = (
    feature: SkillStateFeature,
    kind: SkillStatePredicate['predicate'] = 'level'
): SkillStatePredicate => ({ feature, predicate: kind });

/** `n + 1` points from `from` to `to`, rounded to dodge float drift. */
const grid = (from: number, to: number, n: number): number[] =>
    Array.from({ length: n + 1 }, (_, i) =>
        Number((from + ((to - from) * i) / n).toFixed(6))
    );

const expectEquivalent = (
    p: SkillStatePredicate,
    ctx: SkillSelectionContext,
    oracle: boolean
): void => {
    expect(isStateNotable(p, ctx)).toBe(oracle);
    expect(readIndicatorState(p, ctx) !== null).toBe(oracle);
};

describe('isStateNotable is the reader finding a state', () => {
    it.each(grid(-100, 0, 200))('williamsR %s', v => {
        expectEquivalent(
            predicate('williamsR'),
            ctxOf({ williamsR: [v] }),
            v >= WILLIAMS_R_OVERBOUGHT_LEVEL || v <= WILLIAMS_R_OVERSOLD_LEVEL
        );
    });

    it.each(grid(0, 100, 200))('stochastic %s', k => {
        expectEquivalent(
            predicate('stochastic'),
            ctxOf({ stochastic: [{ percentK: k, percentD: 50 }] }),
            k >= STOCHASTIC_OVERBOUGHT_LEVEL || k <= STOCHASTIC_OVERSOLD_LEVEL
        );
    });

    it.each(grid(0, 1, 100))('stochRsi %s', k => {
        expectEquivalent(
            predicate('stochRsi'),
            ctxOf({ stochRsi: [{ k, d: 0.5 }] }),
            k >= 0.8 || k <= 0.2
        );
    });

    it.each(grid(0, 100, 200))('connorsRsi %s', v => {
        expectEquivalent(
            predicate('connorsRsi'),
            ctxOf({ connorsRsi: [v] }),
            v <= CRSI_OVERSOLD || v >= CRSI_OVERBOUGHT
        );
    });

    it.each(grid(-300, 300, 120))('macdV %s', v => {
        expectEquivalent(
            predicate('macdV'),
            ctxOf({ macdV: [v] }),
            Math.abs(v) >= MACDV_OVERBOUGHT
        );
    });

    it.each(grid(0, 1, 100))('hurst %s', v => {
        expectEquivalent(
            predicate('hurst'),
            ctxOf({ hurst: [v] }),
            Math.abs(v - HURST_RANDOM_WALK) >= HURST_DECISIVE_MARGIN
        );
    });

    it.each(grid(0.2, 1.8, 160))('varianceRatio %s', v => {
        expectEquivalent(
            predicate('varianceRatio'),
            ctxOf({ varianceRatio: [v] }),
            Math.abs(v - VR_RANDOM_WALK) >= VR_DECISIVE_MARGIN
        );
    });

    it.each(grid(0, 1, 100))('regression r2 %s', r2 => {
        expectEquivalent(
            predicate('regression'),
            ctxOf({ regression: [{ slope: 1, r2 }] }),
            r2 >= REGRESSION_R2_SIGNIFICANT
        );
    });

    it.each(grid(0, 100, 100))('buySellVolume buy share %s', buy => {
        const ratio = buy / 100;
        expectEquivalent(
            predicate('buySellVolume', 'ratio'),
            ctxOf({
                buySellVolume: [{ buyVolume: buy, sellVolume: 100 - buy }],
            }),
            ratio >= 0.65 || ratio <= 0.35
        );
    });

    it.each(grid(80, 120, 160))(
        'bollinger price %s on bands 90..110',
        price => {
            const pctB = (price - 90) / 20;
            const { hi, lo } = BOLLINGER_PCTB_BY_TF['1Day'] ?? {
                hi: 0.98,
                lo: 0.02,
            };
            expectEquivalent(
                predicate('bollinger', 'pctB'),
                ctxOf(
                    { bollinger: [{ upper: 110, middle: 100, lower: 90 }] },
                    { price }
                ),
                pctB >= hi || pctB <= lo
            );
        }
    );

    it.each(grid(85, 115, 120))(
        'keltner price %s on bands 90..110, atr 4',
        price => {
            expectEquivalent(
                predicate('keltner', 'bandDistAtr'),
                ctxOf(
                    {
                        keltnerChannel: [
                            { upper: 110, middle: 100, lower: 90 },
                        ],
                        atr: [4],
                    },
                    { price }
                ),
                price >= 110 ||
                    price <= 90 ||
                    110 - price <= 2 ||
                    price - 90 <= 2
            );
        }
    );

    it.each(grid(85, 115, 120))('donchian price %s on bands 90..110', price => {
        expectEquivalent(
            predicate('donchian', 'channelProximity'),
            ctxOf(
                { donchianChannel: [{ upper: 110, middle: 100, lower: 90 }] },
                { price }
            ),
            price >= 110 || price <= 90 || 110 - price <= 1 || price - 90 <= 1
        );
    });

    it.each(grid(95, 105, 80))(
        'vwap price %s, vwap 100, atr 2 (intraday)',
        price => {
            expectEquivalent(
                predicate('vwap', 'bandDistAtr'),
                ctxOf({ vwap: [100], atr: [2] }, { price, timeframe: '1Hour' }),
                Math.abs(price - 100) >= 2
            );
        }
    );

    it('is false for a predicate pair the feature does not own, and for no data', () => {
        expect(
            readIndicatorState(
                predicate('hurst', 'pctB'),
                ctxOf({ hurst: [0.9] })
            )
        ).toBeNull();
        expect(
            readIndicatorState(predicate('williamsR'), ctxOf({}))
        ).toBeNull();
    });
});

describe('the band, VWAP and Bollinger gates decide on the figures the prompt prints', () => {
    // A KRX stock prints its band edge on the tick: the raw upper band sat 880 won above the
    // close (inside half an ATR of 1789), the printed one 900 above it (outside).
    const KRX = {
        quoting: priceQuoting(85_200, 'KRW', 'equity', 'share'),
        differenceDp: 0,
    };
    const keltner = (print?: SkillSelectionContext['print']) =>
        ctxOf(
            {
                keltnerChannel: [
                    { upper: 86_080, middle: 82_000, lower: 79_200 },
                ],
                atr: [1_789.4],
            },
            { price: 85_200, print }
        );

    it('keltner: raw values say near the band, the printed ones do not', () => {
        expect(readKeltnerBand(keltner())?.state).toBe('near_upper');
        expect(KRX.quoting.krxTick).not.toBeNull();
        expect(readKeltnerBand(keltner(KRX))).toBeNull();
    });

    it('keltner: the state read carries the printed band edges and ATR', () => {
        const ctx = ctxOf(
            {
                keltnerChannel: [
                    { upper: 86_080.4, middle: 82_000, lower: 79_199.7 },
                ],
                atr: [1_789.4],
            },
            { price: 87_000, print: KRX }
        );
        expect(readKeltnerBand(ctx)).toEqual({
            state: 'beyond_upper',
            raw: { upper: 86_100, lower: 79_200, atr: 1_789 },
        });
    });

    it('bollinger: the engine %B as printed decides, not a recomputation on the rounded band edges', () => {
        // A KRX band edge prints on its 100-won tick (86,040 -> 86,000), so the printed edges give
        // (85,900 - 80,000) / 6,000 = 0.983; the engine's %B is 0.9749 and prints 0.97.
        const ctx = (print?: SkillSelectionContext['print']) =>
            ctxOf(
                {
                    bollinger: [
                        { upper: 86_040, middle: 83_000, lower: 80_000 },
                    ],
                    bollingerDerived: [{ pctB: 0.9749, bandwidth: 0.07 }],
                },
                { price: 85_900, print }
            );
        const bollinger = predicate('bollinger', 'pctB');
        expect(readBollingerPctB(bollinger, ctx(KRX))).toBeNull();
        // The same band without the engine figure falls back to the price against the bands.
        expect(
            readBollingerPctB(
                bollinger,
                ctxOf(
                    {
                        bollinger: [
                            { upper: 86_040, middle: 83_000, lower: 80_000 },
                        ],
                    },
                    { price: 86_000 }
                )
            )?.state
        ).toBe('above_band_pctb');
    });

    it('bollinger: the printed %B reaches the bound at two decimals (0.9751 prints 0.98)', () => {
        const ctx = (pctB: number, print?: SkillSelectionContext['print']) =>
            ctxOf({ bollingerDerived: [{ pctB, bandwidth: 0.1 }] }, { print });
        const bollinger = predicate('bollinger', 'pctB');
        expect(readBollingerPctB(bollinger, ctx(0.9751, KRX))?.raw.pctB).toBe(
            0.98
        );
        expect(readBollingerPctB(bollinger, ctx(0.9751, KRX))?.state).toBe(
            'above_band_pctb'
        );
        expect(readBollingerPctB(bollinger, ctx(0.9751))).toBeNull();
        expect(readBollingerPctB(bollinger, ctx(0.0249, KRX))?.state).toBe(
            'below_band_pctb'
        );
    });

    it('regression: the R² and slope of the last bar that has a slope, the bar the regime line prints', () => {
        const series = [
            { slope: -1, r2: 0.6 },
            { slope: null, r2: 0.1 },
        ];
        expect(readRegressionLevel(ctxOf({ regression: series }))).toEqual({
            state: 'strong_fit_down',
            raw: { r2: 0.6 },
        });
        expect(
            readRegressionLevel(
                ctxOf(
                    { regression: [{ slope: 1, r2: 0.2951 }] },
                    { print: KRX }
                )
            )?.raw.r2
        ).toBe(0.3);
    });

    it('vwap: the price and the ATR are compared as printed', () => {
        const print = {
            quoting: priceQuoting(100, 'USD', 'equity', 'share'),
            differenceDp: 2,
        };
        const ctx = (withPrint: boolean) =>
            ctxOf(
                { vwap: [100], atr: [2.004] },
                {
                    price: 101.996,
                    timeframe: '1Hour',
                    print: withPrint ? print : undefined,
                }
            );
        // Raw: 1.996 from VWAP against an ATR of 2.004 — not a full ATR away. Printed: 102.00
        // against 100.00 and an ATR of 2.00 — exactly one.
        expect(readVwapDistance(ctx(false))).toBeNull();
        expect(readVwapDistance(ctx(true))).toEqual({
            state: 'above',
            raw: { vwap: 100, atr: 2 },
        });
    });

    it('without print settings every gate decides on the raw values, as before', () => {
        expect(
            isStateNotable(predicate('keltner', 'bandDistAtr'), keltner())
        ).toBe(true);
    });
});
