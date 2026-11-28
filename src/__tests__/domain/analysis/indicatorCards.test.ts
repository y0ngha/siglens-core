import { describe, expect, it } from 'vitest';
import {
    buildIndicatorCards,
    CARD_STRENGTH_BANDS,
    describeIndicatorReading,
    INDICATOR_CARD_TREND_RULE,
    strengthOfReading,
    trendOfReading,
} from '@/domain/analysis/indicatorCards';
import { INDICATOR_CARD_KINDS } from '@/domain/analysis/computedCardKinds';
import { ADX_WEAK_THRESHOLD } from '@/domain/analysis/indicatorState';
import {
    HURST_DECISIVE_MARGIN,
    VR_DECISIVE_MARGIN,
} from '@/domain/analysis/skillGatingPredicates';
import { ADX_TRENDING_THRESHOLD } from '@/domain/analysis/marketReferenceConstants';
import {
    formatNullableNumber,
    priceQuoting,
} from '@/domain/analysis/promptFormat';
import {
    CRSI_OVERBOUGHT,
    CRSI_OVERSOLD,
    EMPTY_INDICATOR_RESULT,
    HURST_RANDOM_WALK,
    MACDV_OVERBOUGHT,
    REGRESSION_R2_SIGNIFICANT,
    VR_RANDOM_WALK,
} from '@/domain/indicators/constants';
import type {
    ComputedCardKind,
    ImpulseColor,
    IndicatorCardKind,
    IndicatorReading,
    IndicatorResult,
    Signal,
    SignalType,
    Skill,
    SkillGating,
    SkillSelectionContext,
    Trend,
} from '@/domain/types';

// ── Fixtures ────────────────────────────────────────────────────────────────

const BAR_COUNT = 100;
const PRICE = 100;
const PRINT = {
    quoting: priceQuoting(PRICE, 'USD', 'equity', 'share'),
    differenceDp: 2,
    trendSampleCount: 7,
    barCount: BAR_COUNT,
} as const;

const ind = (over: Partial<IndicatorResult>): IndicatorResult => ({
    ...EMPTY_INDICATOR_RESULT,
    ...over,
});

const selection = (
    indicators: IndicatorResult,
    over: Partial<SkillSelectionContext> = {}
): SkillSelectionContext => ({
    indicators,
    signals: [],
    timeframe: '1Day',
    detectedCandles: [],
    patternCandidates: [],
    price: PRICE,
    atrPercent: 1,
    ...over,
});

const skill = (
    name: string,
    kind: ComputedCardKind,
    gating: SkillGating,
    type: Skill['type'] = 'indicator_guide'
): Skill => ({
    name,
    description: 'desc',
    type,
    indicators: [],
    confidenceWeight: 0.8,
    content: 'content',
    gating,
    computedCard: kind,
});

const ALWAYS_ON: SkillGating = { tier: 'always_on' };
const stateGate = (feature: string, predicate = 'level'): SkillGating =>
    ({
        tier: 'gated',
        signalKind: 'state',
        state: { feature, predicate },
    }) as SkillGating;
const eventGate = (...triggers: string[]): SkillGating => ({
    tier: 'gated',
    signalKind: 'event',
    triggers,
});

const signal = (
    type: SignalType,
    direction: Signal['direction'],
    detectedAt = BAR_COUNT - 1,
    phase: Signal['phase'] = 'confirmed'
): Signal => ({ type, direction, phase, detectedAt });

/** A series of `BAR_COUNT` values ending in `last`, so only the last entries matter to a reader. */
const flat = (
    last: number | null,
    before: number | null = last
): (number | null)[] => [
    ...Array<number | null>(BAR_COUNT - 1).fill(before),
    last,
];

/** The card a skill gets, read from its first (only) signal. */
const cardOf = (
    guide: Skill,
    indicators: IndicatorResult,
    over: Partial<SkillSelectionContext> = {}
) => {
    const cards = buildIndicatorCards([guide], {
        selection: selection(indicators, over),
        print: PRINT,
    });
    const signalOf = cards[0]?.signals[0];
    return { count: cards.length, card: cards[0], signal: signalOf };
};

const reading = (
    guide: Skill,
    indicators: IndicatorResult,
    over: Partial<SkillSelectionContext> = {}
): IndicatorReading | undefined =>
    cardOf(guide, indicators, over).signal?.reading;

// ── Always-on kinds ─────────────────────────────────────────────────────────

const maSeries = (values: Record<number, number>) =>
    Object.fromEntries(
        Object.entries(values).map(([period, v]) => [Number(period), flat(v)])
    );

describe('always-on cards', () => {
    const ma = skill('MA Signal Guide', 'ma', ALWAYS_ON);

    it.each([
        [
            'bullish_stack',
            { 5: 110, 20: 108, 60: 105, 120: 103, 200: 101 },
            'bullish',
        ],
        [
            'bearish_stack',
            { 5: 101, 20: 103, 60: 105, 120: 108, 200: 110 },
            'bearish',
        ],
        [
            'mixed',
            { 5: 105, 20: 108, 60: 105.5, 120: 103, 200: 101 },
            'neutral',
        ],
    ] as const)('ma %s', (state, values, trend) => {
        const out = cardOf(ma, ind({ ma: maSeries(values) }));
        expect(out.signal?.reading).toMatchObject({
            kind: 'ma',
            basis: 'always_on',
            state,
            values: {
                close: PRICE,
                ma5: values[5],
                ma20: values[20],
                ma60: values[60],
                ma120: values[120],
                ma200: values[200],
            },
            signals: [],
        });
        expect(out.signal?.trend).toBe(trend);
        expect(out.signal?.strength).toBeUndefined();
    });

    it('ma has no card when fewer than two averages have a value (the stack line reads N/A)', () => {
        expect(cardOf(ma, ind({ ma: maSeries({ 5: 100 }) })).count).toBe(0);
        expect(cardOf(ma, ind({})).count).toBe(0);
    });

    it('ma reads each average at its latest non-null value, as the stack and the value lines do', () => {
        const series = { ...maSeries({ 5: 110, 20: 108 }), 60: flat(null, 90) };
        expect(reading(ma, ind({ ma: series }))).toMatchObject({
            state: 'bullish_stack',
            values: { ma5: 110, ma20: 108, ma60: 90, ma120: null },
        });
    });

    it.each([
        ['bullish_stack', { 9: 110, 20: 108, 21: 107, 60: 104 }],
        ['bearish_stack', { 9: 101, 20: 103, 21: 104, 60: 107 }],
        ['mixed', { 9: 101, 20: 108, 21: 104, 60: 107 }],
    ] as const)('ema %s', (state, values) => {
        const ema = skill('EMA Signal Guide', 'ema', ALWAYS_ON);
        expect(reading(ema, ind({ ema: maSeries(values) }))).toMatchObject({
            kind: 'ema',
            state,
            values: {
                ema9: values[9],
                ema20: values[20],
                ema21: values[21],
                ema60: values[60],
            },
        });
    });

    const adx = skill('ADX Signal Guide', 'adx', ALWAYS_ON);
    const dmi = (value: number | null, plus = 30, minus = 20) =>
        ind({ dmi: [{ diPlus: plus, diMinus: minus, adx: value }] });

    it('adx reads the regime on the printed value, at both thresholds', () => {
        const state = (value: number) => reading(adx, dmi(value))?.state;
        expect(state(ADX_TRENDING_THRESHOLD)).toBe('trending');
        expect(state(ADX_TRENDING_THRESHOLD - 0.01)).toBe('between');
        expect(state(ADX_WEAK_THRESHOLD)).toBe('between');
        expect(state(ADX_WEAK_THRESHOLD - 0.01)).toBe('weak');
    });

    it('adx decides on the rounded value: 24.996 prints 25.00 and is trending', () => {
        expect(reading(adx, dmi(24.996))).toMatchObject({
            state: 'trending',
            values: { adx: 25 },
        });
    });

    it('adx has no card when ADX prints N/A, and takes the DI side unless the regime is weak', () => {
        expect(cardOf(adx, dmi(null)).count).toBe(0);
        expect(cardOf(adx, dmi(30, 30, 20)).signal?.trend).toBe('bullish');
        expect(cardOf(adx, dmi(30, 20, 30)).signal?.trend).toBe('bearish');
        expect(cardOf(adx, dmi(30, 25, 25)).signal?.trend).toBe('neutral');
        expect(cardOf(adx, dmi(10, 30, 20)).signal?.trend).toBe('neutral');
    });

    it('atr and obv take the tag the indicator line prints and have no card without one', () => {
        const atr = skill('ATR Signal Guide', 'atr', ALWAYS_ON);
        const rising = [1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6];
        const falling = [...rising].reverse();
        expect(
            reading(atr, ind({ atr: rising }), { price: 100 })
        ).toMatchObject({
            kind: 'atr',
            state: 'rising',
            values: { atr: 1.6, atrPercent: 1.6 },
        });
        expect(reading(atr, ind({ atr: falling }))?.state).toBe('falling');
        expect(reading(atr, ind({ atr: Array(7).fill(1.5) }))?.state).toBe(
            'flat'
        );
        expect(cardOf(atr, ind({ atr: [1.5] })).count).toBe(0);
        expect(cardOf(atr, ind({})).count).toBe(0);

        const obv = skill('OBV Signal Guide', 'obv', ALWAYS_ON);
        const up = [100, 200, 300, 400, 500, 600, 700.4];
        expect(reading(obv, ind({ obv: up }))).toMatchObject({
            kind: 'obv',
            state: 'rising',
            values: { obv: 700 },
        });
        expect(cardOf(obv, ind({ obv: up })).signal?.trend).toBe('bullish');
        expect(cardOf(obv, ind({ obv: [...up].reverse() })).signal?.trend).toBe(
            'bearish'
        );
        expect(cardOf(obv, ind({ obv: Array(7).fill(5) })).signal?.trend).toBe(
            'neutral'
        );
    });

    const profile = (vah: number, val: number) =>
        ind({
            volumeProfile: { poc: 100, vah, val, profile: [] },
        });

    it('volume_profile places the printed close against the printed value area, at both bounds', () => {
        const vp = skill(
            'Volume Profile Signal Guide',
            'volume_profile',
            ALWAYS_ON
        );
        const at = (vah: number, val: number, price: number) =>
            reading(vp, profile(vah, val), { price })?.state;
        expect(at(105, 95, 106)).toBe('above_value_area');
        expect(at(105, 95, 105)).toBe('inside_value_area');
        expect(at(105, 95, 95)).toBe('inside_value_area');
        expect(at(105, 95, 94)).toBe('below_value_area');
        expect(reading(vp, profile(105, 95), { price: 100 })).toMatchObject({
            values: {
                close: 100,
                poc: 100,
                vah: 105,
                val: 95,
                bars: BAR_COUNT,
            },
        });
        expect(cardOf(vp, ind({})).count).toBe(0);
    });
});

// ── Event kinds ─────────────────────────────────────────────────────────────

describe('event cards', () => {
    const rsi = skill(
        'RSI Signal Guide',
        'rsi',
        eventGate('rsi_oversold', 'rsi_overbought', 'rsi_bullish_divergence')
    );

    it('builds a card from the signals the skill listens to, with their phase and age', () => {
        const out = cardOf(rsi, ind({ rsi: flat(24.564) }), {
            signals: [
                signal('golden_cross', 'bullish'),
                signal('rsi_oversold', 'bullish', BAR_COUNT - 3),
                signal(
                    'rsi_bullish_divergence',
                    'bullish',
                    BAR_COUNT - 1,
                    'expected'
                ),
            ],
            newSignalTypes: ['rsi_bullish_divergence'],
        });
        expect(out.signal?.reading).toEqual({
            kind: 'rsi',
            basis: 'event',
            // The event of the current bar leads, then the older one.
            state: 'rsi_bullish_divergence',
            values: { rsi: 24.56 },
            signals: [
                {
                    type: 'rsi_bullish_divergence',
                    phase: 'expected',
                    barsAgo: 0,
                },
                { type: 'rsi_oversold', phase: 'confirmed', barsAgo: 2 },
            ],
        });
        expect(out.signal?.trend).toBe('bullish');
    });

    describe('an older cross never leads an event that fired on the current bar', () => {
        // The shape of a stored case (names anonymized): the detector still reports the last
        // bullish cross from three bars ago while a bearish cross is newly lit on this bar, and
        // the bullish detector comes first in detection order.
        const macd = skill(
            'MACD Signal Guide',
            'macd',
            eventGate('macd_bullish_cross', 'macd_bearish_cross')
        );
        const indicators = ind({
            macd: [{ macd: -0.5, signal: -0.2, histogram: -0.3 }],
        });
        const read = (signals: Signal[], newSignalTypes: SignalType[] = []) =>
            cardOf(macd, indicators, { signals, newSignalTypes });

        it('takes the newly fired event as the state, and lists it first', () => {
            const out = read(
                [
                    signal('macd_bullish_cross', 'bullish', BAR_COUNT - 4),
                    signal('macd_bearish_cross', 'bearish'),
                ],
                ['macd_bearish_cross']
            );
            expect(out.signal?.reading).toMatchObject({
                state: 'macd_bearish_cross',
                signals: [
                    { type: 'macd_bearish_cross', barsAgo: 0 },
                    { type: 'macd_bullish_cross', barsAgo: 3 },
                ],
            });
        });

        it('reads the trend from the current-bar event alone, not neutral from the older opposite one', () => {
            expect(
                read(
                    [
                        signal('macd_bullish_cross', 'bullish', BAR_COUNT - 4),
                        signal('macd_bearish_cross', 'bearish'),
                    ],
                    ['macd_bearish_cross']
                ).signal?.trend
            ).toBe('bearish');
        });

        it('reads neutral when both directions fired on the current bar', () => {
            const out = read(
                [
                    signal('macd_bullish_cross', 'bullish'),
                    signal('macd_bearish_cross', 'bearish'),
                ],
                ['macd_bullish_cross', 'macd_bearish_cross']
            );
            expect(out.signal?.trend).toBe('neutral');
        });

        it('keeps detection order and every side when nothing is newly lit (a state-like flip held from an older bar)', () => {
            const out = read([
                signal('macd_bullish_cross', 'bullish', BAR_COUNT - 4),
                signal('macd_bearish_cross', 'bearish', BAR_COUNT - 2),
            ]);
            expect(out.signal?.reading).toMatchObject({
                state: 'macd_bullish_cross',
            });
            expect(out.signal?.trend).toBe('neutral');
        });
    });

    describe('MACD histogram convergence names no side', () => {
        const macd = skill(
            'MACD Signal Guide',
            'macd',
            eventGate(
                'macd_bullish_cross',
                'macd_bearish_cross',
                'macd_histogram_bullish_convergence',
                'macd_histogram_bearish_convergence'
            )
        );
        // MACD still above its signal line and zero while the histogram shrinks (AMAT 2019-02-07).
        const indicators = ind({
            macd: [{ macd: 1.62, signal: 1.36, histogram: 0.26 }],
        });
        const read = (signals: Signal[], newSignalTypes: SignalType[] = []) =>
            cardOf(macd, indicators, { signals, newSignalTypes }).signal;

        it('is neutral when the only signal is bearish convergence, still listed in the reading', () => {
            const out = read(
                [
                    signal(
                        'macd_histogram_bearish_convergence',
                        'bearish',
                        BAR_COUNT - 1,
                        'expected'
                    ),
                ],
                ['macd_histogram_bearish_convergence']
            );
            expect(out?.trend).toBe('neutral');
            expect(out?.reading).toMatchObject({
                state: 'macd_histogram_bearish_convergence',
            });
        });

        it('is neutral for bullish convergence alone', () => {
            expect(
                read([
                    signal(
                        'macd_histogram_bullish_convergence',
                        'bullish',
                        BAR_COUNT - 1,
                        'expected'
                    ),
                ])?.trend
            ).toBe('neutral');
        });

        it('is neutral when the only newly lit signal is convergence, even with an older cross listed', () => {
            expect(
                read(
                    [
                        signal('macd_bullish_cross', 'bullish', BAR_COUNT - 3),
                        signal(
                            'macd_histogram_bearish_convergence',
                            'bearish',
                            BAR_COUNT - 1,
                            'expected'
                        ),
                    ],
                    ['macd_histogram_bearish_convergence']
                )?.trend
            ).toBe('neutral');
        });

        it('keeps a fresh cross: the side of the cross, with convergence beside it', () => {
            expect(
                read(
                    [
                        signal('macd_bearish_cross', 'bearish'),
                        signal(
                            'macd_histogram_bullish_convergence',
                            'bullish',
                            BAR_COUNT - 1,
                            'expected'
                        ),
                    ],
                    ['macd_bearish_cross']
                )?.trend
            ).toBe('bearish');
        });

        it('keeps an older cross that nothing newer replaces', () => {
            expect(
                read([signal('macd_bullish_cross', 'bullish', BAR_COUNT - 3)])
                    ?.trend
            ).toBe('bullish');
        });
    });

    describe('a CCI cross counts only while it holds on the last bar', () => {
        const cci = skill(
            'CCI Signal Guide',
            'cci',
            eventGate('cci_bullish_cross', 'cci_bearish_cross')
        );
        /** A series of `BAR_COUNT` values whose last values are `tail`. */
        const series = (tail: number[]): number[] => [
            ...Array<number>(BAR_COUNT - tail.length).fill(0),
            ...tail,
        ];
        const read = (
            tail: number[],
            signals: Signal[],
            newSignalTypes: SignalType[] = []
        ) =>
            cardOf(cci, ind({ cci: series(tail) }), {
                signals,
                newSignalTypes,
            }).signal;

        it('AAPL 2020-03-12: a bullish cross through -100 undone inside the lookback is neutral', () => {
            // -136 -> -83 (cross up through -100 two bars ago) -> -92 -> -164.
            const out = read(
                [-136, -83, -92, -164],
                [signal('cci_bullish_cross', 'bullish', BAR_COUNT - 3)]
            );
            expect(out?.trend).toBe('neutral');
            expect(out?.reading).toMatchObject({ state: 'cci_bullish_cross' });
        });

        it('a bullish cross through -100 that still holds stays bullish (MRVL 2018-08-03)', () => {
            expect(
                read(
                    [-101, -88, -78],
                    [signal('cci_bullish_cross', 'bullish', BAR_COUNT - 2)]
                )?.trend
            ).toBe('bullish');
        });

        it('a fresh bullish cross through -100 on the last bar stays bullish', () => {
            expect(
                read(
                    [-126, -94],
                    [signal('cci_bullish_cross', 'bullish')],
                    ['cci_bullish_cross']
                )?.trend
            ).toBe('bullish');
        });

        it('a bullish cross through +100 that fell back below it is neutral', () => {
            expect(
                read(
                    [90, 113, 95],
                    [signal('cci_bullish_cross', 'bullish', BAR_COUNT - 2)]
                )?.trend
            ).toBe('neutral');
        });

        it('a bearish cross through 0 that went back above it is neutral (000660.KS 2022-05-16)', () => {
            expect(
                read(
                    [20, -10, 72],
                    [signal('cci_bearish_cross', 'bearish', BAR_COUNT - 2)]
                )?.trend
            ).toBe('neutral');
        });

        it('a bearish cross through +100 that still holds stays bearish', () => {
            expect(
                read(
                    [145, 82],
                    [signal('cci_bearish_cross', 'bearish')],
                    ['cci_bearish_cross']
                )?.trend
            ).toBe('bearish');
        });

        it('a reversed cross does not cancel a held one the other way', () => {
            // Bearish through 0 three bars ago still holds; the bullish cross through -100 two
            // bars ago is undone by the last bar. Neither is newly lit.
            expect(
                read(
                    [20, -120, -90, -130],
                    [
                        signal('cci_bullish_cross', 'bullish', BAR_COUNT - 2),
                        signal('cci_bearish_cross', 'bearish', BAR_COUNT - 3),
                    ]
                )?.trend
            ).toBe('bearish');
        });

        it('the reading leads with the held cross, the undone one trails it', () => {
            const out = read(
                [20, -120, -90, -130],
                [
                    signal('cci_bullish_cross', 'bullish', BAR_COUNT - 2),
                    signal('cci_bearish_cross', 'bearish', BAR_COUNT - 3),
                ]
            );
            expect(out?.trend).toBe('bearish');
            expect(out?.reading).toMatchObject({
                state: 'cci_bearish_cross',
                signals: [
                    { type: 'cci_bearish_cross', barsAgo: 2 },
                    { type: 'cci_bullish_cross', barsAgo: 1 },
                ],
            });
        });
    });

    it('has no card when none of its signals fired', () => {
        expect(
            cardOf(rsi, ind({ rsi: flat(50) }), {
                signals: [signal('golden_cross', 'bullish')],
            }).count
        ).toBe(0);
    });

    it('two opposite signals in one card read neutral', () => {
        const out = cardOf(rsi, ind({ rsi: flat(50) }), {
            signals: [
                signal('rsi_oversold', 'bullish'),
                signal('rsi_overbought', 'bearish'),
            ],
        });
        expect(out.signal?.trend).toBe('neutral');
    });

    it('has no card when its skill is not an event guide', () => {
        const wrong = skill('RSI Signal Guide', 'rsi', ALWAYS_ON);
        expect(
            cardOf(wrong, ind({ rsi: flat(50) }), {
                signals: [signal('rsi_oversold', 'bullish')],
            }).count
        ).toBe(0);
    });

    const values = (
        kind: IndicatorCardKind,
        indicators: IndicatorResult,
        type: SignalType
    ) =>
        reading(skill('Guide', kind, eventGate(type)), indicators, {
            signals: [signal(type, 'bullish')],
        });

    it("prints each event kind's own values at the precision of its line", () => {
        expect(
            values(
                'macd',
                ind({ macd: [{ macd: 1.234, signal: 0.5, histogram: 0.734 }] }),
                'macd_bullish_cross'
            )
        ).toMatchObject({
            values: { macd: 1.23, signal: 0.5, histogram: 0.73 },
        });
        expect(
            values('cci', ind({ cci: flat(-110.456) }), 'cci_bullish_cross')
        ).toMatchObject({
            values: { cci: -110.46 },
        });
        expect(
            values('cmf', ind({ cmf: flat(0.1234) }), 'cmf_bullish_flip')
        ).toMatchObject({
            values: { cmf: 0.12 },
        });
        expect(
            values(
                'dmi',
                ind({ dmi: [{ diPlus: 31.119, diMinus: 12.2, adx: 28 }] }),
                'dmi_bullish_cross'
            )
        ).toMatchObject({ values: { diPlus: 31.12, diMinus: 12.2, adx: 28 } });
        expect(
            values(
                'ichimoku',
                ind({
                    ichimoku: [
                        {
                            tenkan: 101.234,
                            kijun: 99,
                            senkouA: 98.5,
                            senkouB: null,
                            chikou: null,
                        },
                    ],
                }),
                'ichimoku_cloud_breakout'
            )
        ).toMatchObject({
            values: { tenkan: 101.23, kijun: 99, senkouA: 98.5, senkouB: null },
        });
        expect(
            values('mfi', ind({ mfi: flat(18.5) }), 'mfi_oversold_bounce')
        ).toMatchObject({
            values: { mfi: 18.5 },
        });
        expect(
            values(
                'parabolic_sar',
                ind({ parabolicSar: [{ sar: 97.123, trend: 'up' }] }),
                'parabolic_sar_flip'
            )
        ).toMatchObject({ values: { sar: 97.12 } });
        expect(
            values(
                'supertrend',
                ind({ supertrend: [{ supertrend: 96.5, trend: 'up' }] }),
                'supertrend_bullish_flip'
            )
        ).toMatchObject({ values: { supertrend: 96.5 } });
        expect(
            values(
                'squeeze_momentum',
                ind({
                    squeezeMomentum: [
                        {
                            momentum: 0.456,
                            sqzOn: false,
                            sqzOff: true,
                            noSqz: false,
                            increasing: true,
                        },
                    ],
                }),
                'squeeze_momentum_bullish'
            )
        ).toMatchObject({ values: { momentum: 0.46 } });
        expect(
            values(
                'bollinger_percent_b',
                ind({ bollingerDerived: [{ pctB: 0.0123, bandwidth: 0.1 }] }),
                'bollinger_percentb_oversold'
            )
        ).toMatchObject({ values: { pctB: 0.01 } });
    });

    it('prints N/A as null', () => {
        expect(values('rsi', ind({ rsi: [] }), 'rsi_oversold')).toMatchObject({
            values: { rsi: null },
        });
    });
});

// ── State kinds ─────────────────────────────────────────────────────────────

const stateReading = (
    kind: IndicatorCardKind,
    feature: string,
    indicators: IndicatorResult,
    over: Partial<SkillSelectionContext> = {},
    predicate = 'level'
) =>
    reading(
        skill('Guide', kind, stateGate(feature, predicate)),
        indicators,
        over
    );

describe('state cards', () => {
    it.each([
        [
            'stochastic',
            'stochastic',
            'overbought',
            { stochastic: [{ percentK: 85.456, percentD: 80 }] },
            { percentK: 85.46, percentD: 80 },
        ],
        [
            'stochastic',
            'stochastic',
            'oversold',
            { stochastic: [{ percentK: 15, percentD: 18.004 }] },
            { percentK: 15, percentD: 18 },
        ],
        [
            'stoch_rsi',
            'stochRsi',
            'overbought',
            { stochRsi: [{ k: 0.9, d: 0.85 }] },
            { k: 0.9, d: 0.85 },
        ],
        [
            'stoch_rsi',
            'stochRsi',
            'oversold',
            { stochRsi: [{ k: 0.1, d: 0.15 }] },
            { k: 0.1, d: 0.15 },
        ],
        [
            'williams_r',
            'williamsR',
            'overbought',
            { williamsR: flat(-10.123) },
            { williamsR: -10.12 },
        ],
        [
            'williams_r',
            'williamsR',
            'oversold',
            { williamsR: flat(-90) },
            { williamsR: -90 },
        ],
        [
            'connors_rsi',
            'connorsRsi',
            'overbought',
            { connorsRsi: flat(CRSI_OVERBOUGHT + 1) },
            { crsi: CRSI_OVERBOUGHT + 1 },
        ],
        [
            'connors_rsi',
            'connorsRsi',
            'oversold',
            { connorsRsi: flat(CRSI_OVERSOLD - 1) },
            { crsi: CRSI_OVERSOLD - 1 },
        ],
    ] as const)('%s %s', (kind, feature, state, over, values) => {
        const r = stateReading(
            kind,
            feature,
            ind(over as Partial<IndicatorResult>)
        );
        expect(r).toMatchObject({
            kind,
            basis: 'state',
            state,
            values,
            signals: [],
        });
    });

    it('bollinger: the printed %B beyond the daily bounds decides, with the printed bands and close', () => {
        const band = { upper: 110, middle: 100, lower: 90 };
        const at = (pctB: number, price: number) =>
            stateReading(
                'bollinger',
                'bollinger',
                ind({
                    bollinger: [band],
                    bollingerDerived: [{ pctB, bandwidth: 0.2 }],
                }),
                { price },
                'pctB'
            );
        expect(at(1.0123, 110.5)).toMatchObject({
            state: 'above_band_pctb',
            values: { close: 110.5, upper: 110, lower: 90, pctB: 1.01 },
        });
        expect(at(-0.0123, 89.5)?.state).toBe('below_band_pctb');
        expect(at(0.5, 100)).toBeUndefined();
    });

    it.each([
        ['beyond_upper', 111],
        ['beyond_lower', 89],
        ['near_upper', 109.5],
        ['near_lower', 90.5],
    ] as const)('keltner and donchian: %s', (state, price) => {
        const band = { upper: 110, middle: 100, lower: 90 };
        expect(
            stateReading(
                'keltner',
                'keltner',
                ind({ keltnerChannel: [band], atr: [4] }),
                { price },
                'bandDistAtr'
            )
        ).toMatchObject({
            kind: 'keltner',
            state,
            values: { close: price, upper: 110, lower: 90, atr: 4 },
        });
        expect(
            stateReading(
                'donchian',
                'donchian',
                ind({ donchianChannel: [band] }),
                { price },
                'channelProximity'
            )
        ).toMatchObject({
            kind: 'donchian',
            state,
            values: { close: price, upper: 110, lower: 90 },
        });
    });

    it('keltner reads the nearer band when the price is within reach of both', () => {
        const band = { upper: 101, middle: 100, lower: 99 };
        const state = (price: number) =>
            stateReading(
                'keltner',
                'keltner',
                ind({ keltnerChannel: [band], atr: [4] }),
                { price },
                'bandDistAtr'
            )?.state;
        expect(state(100.2)).toBe('near_upper');
        expect(state(99.8)).toBe('near_lower');
        expect(state(100)).toBe('near_upper');
    });

    it('vwap: a price at least one ATR from the intraday VWAP, not on a daily chart', () => {
        const indicators = ind({ vwap: flat(100), atr: [2] });
        const state = (price: number, timeframe: '1Hour' | '1Day' = '1Hour') =>
            stateReading(
                'vwap',
                'vwap',
                indicators,
                { price, timeframe },
                'bandDistAtr'
            );
        expect(state(102)).toMatchObject({
            state: 'above',
            values: { close: 102, vwap: 100, atr: 2 },
        });
        expect(state(98)?.state).toBe('below');
        expect(state(101.99)).toBeUndefined();
        expect(state(102, '1Day')).toBeUndefined();
    });

    it('buy_sell_volume: the last bar buy share in percent, at 0.65 and 0.35', () => {
        const at = (buy: number, sell: number) =>
            stateReading(
                'buy_sell_volume',
                'buySellVolume',
                ind({ buySellVolume: [{ buyVolume: buy, sellVolume: sell }] }),
                {},
                'ratio'
            );
        expect(at(65, 35)).toMatchObject({
            state: 'buy_dominant',
            values: { buyRatio: 65 },
        });
        expect(at(35, 65)).toMatchObject({
            state: 'sell_dominant',
            values: { buyRatio: 35 },
        });
        expect(at(64, 36)).toBeUndefined();
        expect(at(2, 1)).toMatchObject({ values: { buyRatio: 66.67 } });
    });

    it('macd_v: at +/-150', () => {
        const at = (v: number) =>
            stateReading('macd_v', 'macdV', ind({ macdV: flat(v) }));
        expect(at(MACDV_OVERBOUGHT)).toMatchObject({
            state: 'high_positive',
            values: { macdV: MACDV_OVERBOUGHT },
        });
        expect(at(-MACDV_OVERBOUGHT)?.state).toBe('high_negative');
        expect(at(MACDV_OVERBOUGHT - 1)).toBeUndefined();
    });

    it('force_index: a sign flip, printed as a whole number', () => {
        const at = (prev: number, latest: number) =>
            stateReading(
                'force_index',
                'forceIndex',
                ind({ forceIndex: [prev, latest] })
            );
        expect(at(-5, 1234567.4)).toMatchObject({
            state: 'turned_positive',
            values: { forceIndex: 1234567 },
        });
        expect(at(5, -3)?.state).toBe('turned_negative');
        expect(at(5, 3)).toBeUndefined();
    });

    it('elder_ray: each turn on its own and both together', () => {
        const at = (prev: [number, number], cur: [number, number]) =>
            stateReading(
                'elder_ray',
                'elderRay',
                ind({
                    elderRay: [
                        { bullPower: prev[0], bearPower: prev[1] },
                        { bullPower: cur[0], bearPower: cur[1] },
                    ],
                })
            );
        expect(at([-1, -3], [-1, -2])).toMatchObject({
            state: 'bear_power_rising',
            values: { bullPower: -1, bearPower: -2 },
        });
        expect(at([3, 3], [2, 3])?.state).toBe('bull_power_falling');
        expect(at([3, -3], [2, -2])?.state).toBe('both');
        expect(at([1, 1], [2, 2])).toBeUndefined();
    });

    it.each([
        ['green', null, ['blue', 'green']],
        ['red', 'green', ['green', 'red']],
        ['blue', 'green', ['green', 'blue']],
    ] as const)(
        'elder_impulse %s (flipped from %s)',
        (state, flippedFrom, colors) => {
            const r = stateReading(
                'elder_impulse',
                'elderImpulse',
                ind({ elderImpulse: [...colors] as ImpulseColor[] })
            );
            expect(r).toMatchObject({
                state,
                flippedFrom: state === 'green' ? 'blue' : flippedFrom,
                values: {},
            });
        }
    );

    it('elder_impulse: a steady blue is not notable and a steady colour has no flip', () => {
        expect(
            stateReading(
                'elder_impulse',
                'elderImpulse',
                ind({ elderImpulse: ['blue', 'blue'] })
            )
        ).toBeUndefined();
        expect(
            stateReading(
                'elder_impulse',
                'elderImpulse',
                ind({ elderImpulse: ['red', 'red'] })
            )
        ).toMatchObject({ state: 'red', flippedFrom: null });
    });

    it('chandelier: the flip side and its active stop', () => {
        const at = (prev: 'long' | 'short', cur: 'long' | 'short') =>
            stateReading(
                'chandelier',
                'chandelier',
                ind({
                    chandelierExit: [
                        { longStop: 90, shortStop: 110, trend: prev },
                        { longStop: 91.234, shortStop: 109.5, trend: cur },
                    ],
                })
            );
        expect(at('short', 'long')).toMatchObject({
            state: 'flipped_long',
            values: { stop: 91.23 },
        });
        expect(at('long', 'short')).toMatchObject({
            state: 'flipped_short',
            values: { stop: 109.5 },
        });
        expect(at('long', 'long')).toBeUndefined();
    });

    it('hurst and variance_ratio: off the random-walk centre by the decisive margin', () => {
        const hurst = (v: number) =>
            stateReading('hurst', 'hurst', ind({ hurst: flat(v) }));
        expect(
            hurst(HURST_RANDOM_WALK + HURST_DECISIVE_MARGIN + 0.01)
        ).toMatchObject({
            state: 'trending',
            values: { hurst: 0.61 },
        });
        expect(
            hurst(HURST_RANDOM_WALK - HURST_DECISIVE_MARGIN - 0.01)?.state
        ).toBe('mean_reverting');
        expect(hurst(0.55)).toBeUndefined();
        const vr = (v: number) =>
            stateReading(
                'variance_ratio',
                'varianceRatio',
                ind({ varianceRatio: flat(v) })
            );
        expect(vr(VR_RANDOM_WALK + VR_DECISIVE_MARGIN + 0.01)).toMatchObject({
            state: 'trending',
            values: { varianceRatio: 1.21 },
        });
        expect(vr(VR_RANDOM_WALK - VR_DECISIVE_MARGIN - 0.01)?.state).toBe(
            'mean_reverting'
        );
        expect(vr(1.1)).toBeUndefined();
    });

    it('regression: a clean fit and the side of its slope, with the R² of the last bar that has a slope', () => {
        const at = (r2: number, slope: number | null) =>
            stateReading(
                'regression',
                'regression',
                ind({ regression: [{ slope, r2 }] })
            );
        expect(at(REGRESSION_R2_SIGNIFICANT, 0.5)).toMatchObject({
            state: 'strong_fit_up',
            values: { r2: 0.3 },
        });
        expect(at(0.8, -0.5)?.state).toBe('strong_fit_down');
        expect(at(REGRESSION_R2_SIGNIFICANT - 0.01, 1)).toBeUndefined();
    });

    it('yang_zhang and ewma: the per-bar sigma in percent, in a regime extreme of the 20-bar mean', () => {
        const high = [...Array<number>(19).fill(0.01), 0.0234];
        const low = [...Array<number>(19).fill(0.01), 0.004];
        expect(
            stateReading('yang_zhang', 'yangZhang', ind({ yangZhang: high }))
        ).toMatchObject({ state: 'high_volatility', values: { sigma: 2.34 } });
        expect(
            stateReading('ewma', 'ewma', ind({ ewmaVolatility: low }))
        ).toMatchObject({ state: 'low_volatility', values: { sigma: 0.4 } });
        expect(
            stateReading(
                'ewma',
                'ewma',
                ind({ ewmaVolatility: Array(20).fill(0.01) })
            )
        ).toBeUndefined();
    });
});

// ── Trend and strength tables ───────────────────────────────────────────────

describe('trend rule table', () => {
    it('has one rule per indicator kind', () => {
        expect(Object.keys(INDICATOR_CARD_TREND_RULE).toSorted()).toEqual(
            [...INDICATOR_CARD_KINDS].toSorted()
        );
    });

    const sample = (kind: IndicatorCardKind, state: string): IndicatorReading =>
        ({
            kind,
            basis: 'state',
            state,
            values: {},
            signals: [],
        }) as unknown as IndicatorReading;

    it.each([
        // The D7 fallback: measured opposite to the model's own trend on > 5% of the stored cards.
        ['stochastic', 'overbought', 'neutral'],
        ['stochastic', 'oversold', 'neutral'],
        ['stoch_rsi', 'overbought', 'neutral'],
        ['williams_r', 'oversold', 'neutral'],
        ['bollinger', 'above_band_pctb', 'neutral'],
        ['bollinger', 'below_band_pctb', 'neutral'],
        ['macd_v', 'high_positive', 'neutral'],
        ['macd_v', 'high_negative', 'neutral'],
        ['elder_ray', 'bear_power_rising', 'neutral'],
        ['elder_ray', 'bull_power_falling', 'neutral'],
        ['elder_ray', 'both', 'neutral'],
        ['chandelier', 'flipped_long', 'neutral'],
        ['chandelier', 'flipped_short', 'neutral'],
        // The oscillator rule that held (Connors RSI, n 49, 0.0% opposite).
        ['connors_rsi', 'overbought', 'bearish'],
        ['connors_rsi', 'oversold', 'bullish'],
        ['keltner', 'beyond_upper', 'bullish'],
        ['keltner', 'near_lower', 'bearish'],
        ['donchian', 'near_upper', 'bullish'],
        ['vwap', 'above', 'bullish'],
        ['vwap', 'below', 'bearish'],
        ['buy_sell_volume', 'sell_dominant', 'bearish'],
        ['force_index', 'turned_negative', 'bearish'],
        ['elder_impulse', 'green', 'bullish'],
        ['elder_impulse', 'red', 'bearish'],
        ['elder_impulse', 'blue', 'neutral'],
        ['regression', 'strong_fit_down', 'bearish'],
        ['hurst', 'trending', 'neutral'],
        ['variance_ratio', 'mean_reverting', 'neutral'],
        ['yang_zhang', 'high_volatility', 'neutral'],
        ['ewma', 'low_volatility', 'neutral'],
        ['atr', 'rising', 'neutral'],
    ] as const)('%s %s is %s', (kind, state, trend) => {
        expect(trendOfReading(sample(kind, state), [])).toBe<Trend>(trend);
    });

    it('event kinds take the side their signals agree on', () => {
        const rsi = sample('rsi', 'rsi_oversold');
        expect(trendOfReading(rsi, ['bullish', 'bullish'])).toBe('bullish');
        expect(trendOfReading(rsi, ['bearish'])).toBe('bearish');
        expect(trendOfReading(rsi, ['bullish', 'bearish'])).toBe('neutral');
        expect(trendOfReading(rsi, [])).toBe('neutral');
    });
});

describe('strength', () => {
    const at = (kind: 'rsi' | 'stochastic' | 'cci', value: number) =>
        strengthOfReading({
            kind,
            basis: 'event',
            state: 'x',
            signals: [],
            values:
                kind === 'rsi'
                    ? { rsi: value }
                    : kind === 'stochastic'
                      ? { percentK: value, percentD: null }
                      : { cci: value },
        } as unknown as IndicatorReading);

    it.each([
        [80, 'strong'],
        [79.99, 'moderate'],
        [70, 'moderate'],
        [69.99, 'weak'],
        [50, 'weak'],
        [30, 'moderate'],
        [30.01, 'weak'],
        [20, 'strong'],
        [20.01, 'moderate'],
    ] as const)('rsi %s is %s (RSI 80/70/30/20 exact)', (value, strength) => {
        expect(at('rsi', value)).toBe(strength);
    });

    it('rsi bands come from the constants the prompt names', () => {
        expect(CARD_STRENGTH_BANDS.rsi).toEqual({
            strongHigh: 80,
            strongLow: 20,
            moderateHigh: 70,
            moderateLow: 30,
        });
    });

    it.each([
        [90, 'strong'],
        [89.99, 'moderate'],
        [80, 'moderate'],
        [79.99, 'weak'],
        [10, 'strong'],
        [10.01, 'moderate'],
        [20, 'moderate'],
        [20.01, 'weak'],
    ] as const)('stochastic %s is %s', (value, strength) => {
        expect(at('stochastic', value)).toBe(strength);
    });

    it.each([
        [200, 'strong'],
        [199.99, 'moderate'],
        [100, 'moderate'],
        [99.99, 'weak'],
        [-200, 'strong'],
        [-199.99, 'moderate'],
        [-100, 'moderate'],
        [-99.99, 'weak'],
    ] as const)('cci %s is %s', (value, strength) => {
        expect(at('cci', value)).toBe(strength);
    });

    it('is undefined for a value that printed N/A and for every other kind', () => {
        expect(
            strengthOfReading({
                kind: 'rsi',
                basis: 'event',
                state: 'rsi_oversold',
                signals: [],
                values: { rsi: null },
            })
        ).toBeUndefined();
        expect(
            strengthOfReading({
                kind: 'macd_v',
                basis: 'state',
                state: 'high_positive',
                signals: [],
                values: { macdV: 400 },
            })
        ).toBeUndefined();
    });

    it('is carried by the card of an RSI event and by none of an MA', () => {
        const rsi = skill('RSI Signal Guide', 'rsi', eventGate('rsi_oversold'));
        expect(
            cardOf(rsi, ind({ rsi: flat(15) }), {
                signals: [signal('rsi_oversold', 'bullish')],
            }).signal?.strength
        ).toBe('strong');
    });
});

// ── Assembly ────────────────────────────────────────────────────────────────

describe('buildIndicatorCards', () => {
    it('builds one card per tagged guide, in the order of the skills, and skips the rest', () => {
        const ma = skill('MA Signal Guide', 'ma', ALWAYS_ON);
        const obv = skill('OBV Signal Guide', 'obv', ALWAYS_ON);
        const cycle = skill(
            'Cycle',
            'ma_cycle',
            eventGate('golden_cross'),
            'strategy'
        );
        const untagged: Skill = {
            ...obv,
            name: 'Untagged',
            computedCard: undefined,
        };
        const wrongType = skill('Pattern', 'obv', ALWAYS_ON, 'pattern');
        const indicators = ind({
            ma: maSeries({ 5: 110, 20: 108 }),
            obv: [100, 200, 300, 400, 500, 600, 700],
        });
        const cards = buildIndicatorCards(
            [obv, untagged, cycle, wrongType, ma],
            { selection: selection(indicators), print: PRINT }
        );
        expect(cards.map(c => c.indicatorName)).toEqual([
            'OBV Signal Guide',
            'MA Signal Guide',
        ]);
        expect(cards.every(c => c.signals.length === 1)).toBe(true);
        expect(cards[0].signals[0].type).toBe('skill');
    });

    it('describes a card in English from its state and printed values', () => {
        const r = reading(
            skill('RSI Signal Guide', 'rsi', eventGate('rsi_oversold')),
            ind({ rsi: flat(24.5) }),
            { signals: [signal('rsi_oversold', 'bullish', BAR_COUNT - 2)] }
        );
        expect(r).toBeDefined();
        expect(
            describeIndicatorReading('RSI Signal Guide', r as IndicatorReading)
        ).toBe(
            'RSI Signal Guide: rsi_oversold. Signals: rsi_oversold (confirmed, 1 bars ago). Values: rsi 24.5.'
        );
        expect(
            describeIndicatorReading('X', {
                kind: 'elder_impulse',
                basis: 'state',
                state: 'red',
                values: {},
                signals: [],
                flippedFrom: 'green',
            })
        ).toBe('X: red (flipped from green).');
        expect(
            describeIndicatorReading('X', {
                kind: 'rsi',
                basis: 'event',
                state: 'rsi_oversold',
                values: { rsi: null },
                signals: [
                    { type: 'rsi_oversold', phase: 'confirmed', barsAgo: 0 },
                ],
            })
        ).toBe(
            'X: rsi_oversold. Signals: rsi_oversold (confirmed, last bar). Values: rsi N/A.'
        );
    });

    it('prints a value the way the prompt does, so the card and the line cannot differ', () => {
        const printed = formatNullableNumber(24.565, 2);
        expect(
            reading(
                skill('RSI Signal Guide', 'rsi', eventGate('rsi_oversold')),
                ind({ rsi: flat(24.565) }),
                { signals: [signal('rsi_oversold', 'bullish')] }
            )
        ).toMatchObject({ values: { rsi: Number(printed) } });
    });
});
