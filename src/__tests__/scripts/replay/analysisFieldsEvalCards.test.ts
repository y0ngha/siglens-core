import { describe, expect, it } from 'vitest';
import {
    checkCycleCards,
    checkIndicatorCards,
    cycleHistory,
    cycleStageSeries,
    hasReader,
    hasTrendRule,
    macdStage,
    maStage,
    noteCycleKinds,
    printedClose,
    printedCycle,
    printedKind,
    READER_KINDS,
    readCycleCards,
    readIndicatorCards,
    ruleTrendOfKind,
    type ObservedCycleCard,
    type ObservedIndicatorCard,
} from '../../../../scripts/replay/analysisFieldsEvalCards';
import { COMPUTED_CARD_KINDS } from '@/domain/analysis/computedCardKinds';
import { FIELDS_EVAL_CONSTANTS as C } from '../../../../scripts/replay/analysisFieldsEvalTypes';

const PROMPT = [
    '- Snapshot Price (price captured at analysis time; not a live quote): 80000',
    '- MA: MA(5): 77000 / MA(20): 79400 / MA(60): 83100 / MA(120): 82700 / MA(200): 86500',
    '- MA stack: mixed (MA200>MA60>MA120>MA20>MA5)',
    '- EMA: EMA(9): 77600 / EMA(20): 78900 / EMA(21): 79100 / EMA(60): 81700',
    '- EMA stack: bearish (EMA9<EMA20<EMA21<EMA60)',
    '- DMI: +DI 24.78 / -DI 27.51 / ADX 26.01',
    '- DMI: +DI below -DI, ADX 26.01 trending',
    '- ATR(14): 2142 [rising]',
    '- ATR % of price: 2.71%',
    '- OBV: -83,753,796 [falling]',
    '- Volume Profile (all 493 bars): POC 82400 / VAH 84400 / VAL 68000',
    '- MA cycle (MA5/MA20/MA60): MA60>MA20>MA5; stage 4',
    '- MACD cycle (EMA9/21/60): upper (EMA9−EMA21) -1416, middle (EMA9−EMA60) -4055, lower (EMA21−EMA60) -2638; stage 4',
].join('\n');

describe('printedKind', () => {
    it('reads the stack lines, with the close among the numbers', () => {
        expect(printedKind(PROMPT, 'ma')).toEqual({
            state: 'mixed',
            numbers: [77000, 79400, 83100, 82700, 86500, 80000],
            trend: 'neutral',
        });
        expect(printedKind(PROMPT, 'ema')).toEqual({
            state: 'bearish_stack',
            numbers: [77600, 78900, 79100, 81700, 80000],
            trend: 'bearish',
        });
        expect(
            printedKind('- EMA stack: bullish (x)\n- EMA: EMA(9): 5', 'ema')
        ).toMatchObject({ state: 'bullish_stack', trend: 'bullish' });
    });

    it('classes ADX at its two thresholds and takes the DI side unless it is weak', () => {
        const dmi = (adx: string, plus = '24.78', minus = '27.51') =>
            `- DMI: +DI ${plus} / -DI ${minus} / ADX ${adx}`;
        const [trending, weak] = [C.cards.adxTrending, C.cards.adxWeak];
        expect(printedKind(dmi(`${trending}`), 'adx')).toMatchObject({
            state: 'trending',
            trend: 'bearish',
        });
        expect(printedKind(dmi('24.99'), 'adx')?.state).toBe('between');
        expect(printedKind(dmi(`${weak}`), 'adx')?.state).toBe('between');
        expect(printedKind(dmi('19.99'), 'adx')).toMatchObject({
            state: 'weak',
            trend: 'neutral',
        });
        expect(printedKind(dmi('30', '31', '20'), 'adx')?.trend).toBe(
            'bullish'
        );
        expect(printedKind(dmi('30', '20', '20'), 'adx')?.trend).toBe(
            'neutral'
        );
        expect(printedKind(PROMPT, 'adx')?.numbers).toEqual([
            24.78, 27.51, 26.01,
        ]);
    });

    it('reads ATR with its percent of price (neutral) and OBV with its tag as the trend', () => {
        expect(printedKind(PROMPT, 'atr')).toEqual({
            state: 'rising',
            numbers: [2142, 2.71],
            trend: 'neutral',
        });
        expect(printedKind(PROMPT, 'obv')).toEqual({
            state: 'falling',
            numbers: [-83753796],
            trend: 'bearish',
        });
        expect(printedKind('- OBV: 5 [rising]', 'obv')?.trend).toBe('bullish');
        expect(printedKind('- OBV: 5 [flat]', 'obv')?.trend).toBe('neutral');
    });

    it('places the printed close against the value area at both bounds', () => {
        const state = (close: number) =>
            printedKind(
                PROMPT.replace('): 80000', `): ${close}`),
                'volume_profile'
            );
        expect(state(84401)).toMatchObject({
            state: 'above_value_area',
            trend: 'bullish',
        });
        expect(state(84400)?.state).toBe('inside_value_area');
        expect(state(68000)?.state).toBe('inside_value_area');
        expect(state(67999)).toMatchObject({
            state: 'below_value_area',
            trend: 'bearish',
        });
        expect(state(70000)?.numbers).toEqual([
            493, 82400, 84400, 68000, 70000,
        ]);
        expect(
            printedKind(
                PROMPT.replace(/^- Snapshot Price.*$/m, ''),
                'volume_profile'
            )
        ).toBeNull();
    });

    it('is null for a missing or N/A line', () => {
        expect(printedKind('- MA stack: N/A', 'ma')).toBeNull();
        expect(printedKind('', 'ema')).toBeNull();
        expect(printedKind('- DMI: N/A', 'adx')).toBeNull();
        expect(printedKind('- ATR(14): N/A', 'atr')).toBeNull();
        expect(printedKind('- OBV: N/A', 'obv')).toBeNull();
    });
});

describe('ruleTrendOfKind', () => {
    it('maps the always-on kinds and the cycle kinds to a trend', () => {
        expect(ruleTrendOfKind('ma', PROMPT)).toBe('neutral');
        expect(ruleTrendOfKind('ema', PROMPT)).toBe('bearish');
        expect(ruleTrendOfKind('obv', PROMPT)).toBe('bearish');
        expect(ruleTrendOfKind('adx', PROMPT)).toBe('bearish');
        expect(ruleTrendOfKind('macd_cycle', PROMPT)).toBe('bearish');
        expect(ruleTrendOfKind('ma_cycle', PROMPT)).toBe('bearish');
        expect(
            ruleTrendOfKind(
                'volume_profile',
                PROMPT.replace('): 80000', '): 90000')
            )
        ).toBe('bullish');
    });

    it('takes the stage table of the cycle kinds at every stage', () => {
        const trends = [1, 2, 3, 4, 5, 6].map(stage =>
            ruleTrendOfKind(
                'macd_cycle',
                `- MACD cycle (EMA9/21/60): upper (EMA9−EMA21) 1, middle (EMA9−EMA60) 1, lower (EMA21−EMA60) 1; stage ${stage}`
            )
        );
        expect(trends).toEqual([
            'bullish',
            'neutral',
            'bearish',
            'bearish',
            'neutral',
            'bullish',
        ]);
    });

    it('is null for a kind with no rule, a missing line or a transition stage', () => {
        expect(ruleTrendOfKind('rsi', PROMPT)).toBeNull();
        expect(ruleTrendOfKind('obv', '')).toBeNull();
        expect(
            ruleTrendOfKind(
                'macd_cycle',
                '- MACD cycle (EMA9/21/60): upper (EMA9−EMA21) 1; stage N/A (transition)'
            )
        ).toBeNull();
    });
});

describe('the oscillator and volume readers', () => {
    it('reads Stochastic %K at its bounds, overbought bearish and oversold bullish', () => {
        const line = (k: number) => `- Stochastic(14,3,3): %K ${k} / %D 52.91`;
        // The trend is neutral: D7 measured the oscillator rule opposite to the model's own on
        // 20.5% of the stored Stochastic cards, so the pre-registered fallback applies.
        expect(printedKind(line(80), 'stochastic')).toMatchObject({
            state: 'overbought',
            trend: 'neutral',
            numbers: [80, 52.91],
        });
        expect(printedKind(line(79.99), 'stochastic')?.state).toBe('between');
        expect(printedKind(line(20), 'stochastic')).toMatchObject({
            state: 'oversold',
            trend: 'neutral',
        });
        expect(printedKind(line(20.01), 'stochastic')).toMatchObject({
            state: 'between',
            trend: 'neutral',
        });
        expect(printedKind('', 'stochastic')).toBeNull();
    });

    it('reads StochRSI K and Williams %R at their bounds', () => {
        const rsi = (k: number) => `- StochRSI(14,14,3,3): K ${k} / D 0.84`;
        expect(printedKind(rsi(0.8), 'stoch_rsi')?.state).toBe('overbought');
        expect(printedKind(rsi(0.79), 'stoch_rsi')?.state).toBe('between');
        expect(printedKind(rsi(0.2), 'stoch_rsi')?.state).toBe('oversold');
        const wr = (v: number) => `- Williams %R(14): ${v}`;
        expect(printedKind(wr(-20), 'williams_r')?.state).toBe('overbought');
        expect(printedKind(wr(-20.01), 'williams_r')?.state).toBe('between');
        expect(printedKind(wr(-80), 'williams_r')?.state).toBe('oversold');
        expect(printedKind('', 'williams_r')).toBeNull();
        expect(printedKind('', 'stoch_rsi')).toBeNull();
    });

    it('reads the last-bar buy ratio at 65% and 35%', () => {
        const line = (pct: string) =>
            `- Current bar: Buy 1 / Sell 2 (Buy ratio: ${pct}%)`;
        expect(printedKind(line('65.00'), 'buy_sell_volume')).toMatchObject({
            state: 'buy_dominant',
            trend: 'bullish',
            numbers: [65],
        });
        expect(printedKind(line('64.99'), 'buy_sell_volume')?.state).toBe(
            'balanced'
        );
        expect(printedKind(line('35.00'), 'buy_sell_volume')).toMatchObject({
            state: 'sell_dominant',
            trend: 'bearish',
        });
        expect(printedKind(line('35.01'), 'buy_sell_volume')?.state).toBe(
            'balanced'
        );
        expect(printedKind('', 'buy_sell_volume')).toBeNull();
    });

    it('has a reader and a trend rule for every card kind, indicator and cycle', () => {
        expect(hasReader('rsi')).toBe(true);
        expect(hasReader('ewma')).toBe(true);
        expect(hasReader('ma_cycle')).toBe(false);
        expect(hasTrendRule('ma_cycle')).toBe(true);
        expect(hasTrendRule('nope')).toBe(false);
        // The population of the gate: every kind core can tag, indicator kinds by reader.
        expect(COMPUTED_CARD_KINDS.filter(kind => !hasTrendRule(kind))).toEqual(
            []
        );
        expect(
            COMPUTED_CARD_KINDS.filter(
                kind => !kind.endsWith('_cycle') && !hasReader(kind)
            )
        ).toEqual([]);
        expect([...READER_KINDS].toSorted()).toEqual(
            COMPUTED_CARD_KINDS.filter(
                kind => !kind.endsWith('_cycle')
            ).toSorted()
        );
    });

    it('reads the printed close from the snapshot line', () => {
        expect(printedClose(PROMPT)).toBe(80000);
        expect(printedClose('')).toBeNull();
        expect(
            printedClose(
                '- Snapshot Price (price captured at analysis time; not a live quote): N/A'
            )
        ).toBeNull();
    });
});

describe('printedCycle', () => {
    it('reads the stage, and the three differences of the MACD cycle', () => {
        expect(printedCycle(PROMPT, 'ma_cycle')).toEqual({
            stage: 4,
            numbers: [77000, 79400, 83100, 82700, 86500],
            order: ['long', 'medium', 'short'],
        });
        expect(printedCycle(PROMPT, 'macd_cycle')).toEqual({
            stage: 4,
            numbers: [-1416, -4055, -2638],
            order: [],
        });
    });

    it('has no stage for N/A, a transition or a missing line', () => {
        expect(
            printedCycle('- MA cycle (MA5/MA20/MA60): N/A', 'ma_cycle').stage
        ).toBeNull();
        expect(printedCycle('', 'macd_cycle')).toEqual({
            stage: null,
            numbers: [],
            order: [],
        });
    });
});

describe('the stage tables', () => {
    it('gives every MA order its stage and none to a tie or a missing value', () => {
        const stages = [
            [3, 2, 1],
            [2, 3, 1],
            [1, 3, 2],
            [1, 2, 3],
            [2, 1, 3],
            [3, 1, 2],
        ].map(values => maStage(values));
        expect(stages).toEqual([1, 2, 3, 4, 5, 6]);
        expect(maStage([2, 2, 1])).toBeNull();
        expect(maStage([3, 2, 2])).toBeNull();
        expect(maStage([3, null, 1])).toBeNull();
    });

    it('gives every sign row of the MACD cycle its stage and none to a zero difference', () => {
        // (short, mid, long): the signs of short-mid, short-long and mid-long.
        const rows = [
            [3, 2, 1],
            [2, 3, 1],
            [1, 3, 2],
            [1, 2, 3],
            [2, 1, 3],
            [3, 1, 2],
        ];
        expect(rows.map(values => macdStage(values))).toEqual([
            1, 2, 3, 4, 5, 6,
        ]);
        expect(macdStage([2, 2, 1])).toBeNull();
        expect(macdStage([3, 2, 2])).toBeNull();
        expect(macdStage([null, 2, 1])).toBeNull();
    });
});

describe('cycleStageSeries and cycleHistory', () => {
    it('has no stage before the longest period and a stage after it', () => {
        const closes = Array.from({ length: 80 }, (_, i) => 100 + i);
        const series = cycleStageSeries('ma_cycle', closes);
        expect(series.slice(0, 59).every(s => s === null)).toBe(true);
        expect(series[79]).toBe(1);
        const macd = cycleStageSeries('macd_cycle', closes);
        expect(macd[58]).toBeNull();
        expect(macd[79]).toBe(1);
        expect(cycleStageSeries('ma_cycle', closes.toReversed())[79]).toBe(4);
    });

    it('names the previous stage, the run length, the progression and the changes', () => {
        const stages = [1, 1, 2, 2, 2, 3, 3];
        expect(cycleHistory(stages, 120)).toEqual({
            stage: 3,
            previousStage: 2,
            barsInStage: 2,
            progression: 'forward',
            stageChanges: 2,
        });
    });

    it('reads a step back as reverse and any other jump as no progression', () => {
        expect(cycleHistory([3, 3, 2], 120).progression).toBe('reverse');
        expect(cycleHistory([1, 6], 120).progression).toBe('reverse');
        expect(cycleHistory([6, 1], 120).progression).toBe('forward');
        expect(cycleHistory([1, 4], 120).progression).toBeNull();
    });

    it('cuts the window by bar count and has a null run length when the run reaches its first bar', () => {
        expect(cycleHistory([2, 2, 2, 2, 2], 3)).toMatchObject({
            stage: 2,
            previousStage: null,
            barsInStage: null,
            progression: null,
            stageChanges: 0,
        });
        expect(cycleHistory([1, 2, 2, 2], 3).barsInStage).toBeNull();
        expect(cycleHistory([1, 2, 2, 2], 4).barsInStage).toBe(3);
        // The bars before the window do not count, a change outside it neither.
        expect(cycleHistory([1, 2, 3, 3], 2)).toMatchObject({
            previousStage: null,
            stageChanges: 0,
        });
    });

    it('ignores bars with no stage: they neither end a run nor count as a change', () => {
        expect(cycleHistory([1, null, 1, 1], 120)).toMatchObject({
            previousStage: null,
            barsInStage: null,
            stageChanges: 0,
        });
        expect(cycleHistory([null, 1, null, 1, 1], 120)).toMatchObject({
            barsInStage: 3,
            stageChanges: 0,
        });
        expect(cycleHistory([null, 1, 2, null, 2, 3], 120)).toMatchObject({
            previousStage: 2,
            barsInStage: 1,
            progression: 'forward',
            stageChanges: 2,
        });
    });

    it('has no stage when the current bar has none, or the series is empty', () => {
        expect(cycleHistory([1, 2, null], 120)).toEqual({
            stage: null,
            previousStage: null,
            barsInStage: null,
            progression: null,
            stageChanges: 1,
        });
        expect(cycleHistory([], 120).stage).toBeNull();
    });
});

describe('readIndicatorCards and readCycleCards', () => {
    it('reads the typed cards the assembled prompt carries', () => {
        const cards = readIndicatorCards([
            {
                indicatorName: 'MA Signal Guide',
                signals: [
                    {
                        type: 'skill',
                        description: 'MA Signal Guide: mixed.',
                        trend: 'neutral',
                        reading: {
                            kind: 'ma',
                            basis: 'always_on',
                            state: 'mixed',
                            values: {
                                close: 1,
                                ma5: null,
                                ma20: 2,
                                ma60: 3,
                                ma120: 4,
                                ma200: 5,
                            },
                            signals: [],
                        },
                    },
                ],
            },
            {
                indicatorName: 'RSI Signal Guide',
                signals: [
                    {
                        type: 'skill',
                        description: 'RSI Signal Guide: rsi_oversold.',
                        trend: 'bullish',
                        reading: {
                            kind: 'rsi',
                            basis: 'event',
                            state: 'rsi_oversold',
                            values: { rsi: 24.5 },
                            signals: [
                                {
                                    type: 'rsi_oversold',
                                    phase: 'confirmed',
                                    barsAgo: 0,
                                },
                            ],
                        },
                    },
                ],
            },
            {
                indicatorName: 'Elder Impulse System Signal Guide',
                signals: [
                    {
                        type: 'skill',
                        description: 'x',
                        trend: 'bearish',
                        reading: {
                            kind: 'elder_impulse',
                            basis: 'state',
                            state: 'red',
                            values: {},
                            signals: [],
                            flippedFrom: 'green',
                        },
                    },
                ],
            },
            {
                indicatorName: 'Old Guide',
                signals: [
                    { type: 'skill', description: 'x', trend: 'bullish' },
                ],
            },
        ]);
        expect(cards[0]).toEqual({
            name: 'MA Signal Guide',
            kind: 'ma',
            state: 'mixed',
            trend: 'neutral',
            values: {
                close: 1,
                ma5: null,
                ma20: 2,
                ma60: 3,
                ma120: 4,
                ma200: 5,
            },
            signalTypes: [],
            flippedFrom: undefined,
        });
        expect(cards[1]).toMatchObject({
            kind: 'rsi',
            signalTypes: ['rsi_oversold'],
        });
        expect(cards[2]).toMatchObject({ flippedFrom: 'green' });
        expect(cards[3]).toMatchObject({
            kind: null,
            values: null,
            signalTypes: null,
        });
        expect(readIndicatorCards([])).toEqual([]);
    });

    it('reads a cycle card and flags a card without a cycle', () => {
        const [full, bare] = readCycleCards([
            {
                strategyName: 'MACD 대순환 분석',
                trend: 'bearish',
                summary: 's',
                cycle: {
                    kind: 'macd_cycle',
                    stage: 4,
                    previousStage: 3,
                    barsInStage: 5,
                    progression: 'forward',
                    stageChanges: 2,
                    values: { upper: 1, middle: 2, lower: 3 },
                    slopes: { ema9: null, ema21: null, ema60: null },
                },
            },
            { strategyName: 'X', trend: 'neutral', summary: 's' },
        ]);
        expect(full).toMatchObject({
            kind: 'macd_cycle',
            stage: 4,
            previousStage: 3,
            hasCycle: true,
            values: { upper: 1, middle: 2, lower: 3 },
            order: null,
        });
        expect(bare).toMatchObject({
            hasCycle: false,
            stage: null,
            values: null,
        });
    });
});

const card = (
    over: Partial<ObservedIndicatorCard> & { name: string }
): ObservedIndicatorCard => ({
    kind: null,
    state: null,
    trend: null,
    values: {},
    signalTypes: [],
    flippedFrom: undefined,
    ...over,
});

describe('checkIndicatorCards', () => {
    const injected = [
        { name: 'MA Signal Guide', computedCard: 'ma' },
        { name: 'ATR Signal Guide', computedCard: 'atr' },
        {
            name: 'MACD Signal Guide',
            computedCard: 'macd',
            triggers: ['macd_bullish_cross', 'macd_bearish_cross'],
        },
    ];
    const SIGNALS = [
        '- MACD: 1.5 / Signal 1.2 / Histogram 0.3 [rising]',
        'Bullish signals: macd_bullish_cross(macd), rsi_oversold(rsi)',
        'Bearish signals: none',
    ].join('\n');
    const prompt = `${PROMPT}\n${SIGNALS}`;
    const good = [
        card({
            name: 'MA Signal Guide',
            kind: 'ma',
            state: 'mixed',
            trend: 'neutral',
            values: { close: 80000, ma5: 77000, ma200: null },
        }),
        card({
            name: 'ATR Signal Guide',
            kind: 'atr',
            state: 'rising',
            trend: 'neutral',
            values: { atr: 2142 },
        }),
        card({
            name: 'MACD Signal Guide',
            kind: 'macd',
            state: 'macd_bullish_cross',
            trend: 'bullish',
            values: { macd: 1.5, signal: 1.2, histogram: 0.3 },
            signalTypes: ['macd_bullish_cross'],
        }),
    ];
    const run = (cards: readonly ObservedIndicatorCard[], text = prompt) =>
        checkIndicatorCards({ prompt: text, injected, cards });

    it('passes one correct card per injected guide, with every kind recomputed', () => {
        const result = run(good);
        expect(result.cardSet).toEqual({
            expected: 3,
            observed: 3,
            violations: 0,
        });
        expect(result.values).toEqual({
            cards: 3,
            valueMismatches: 0,
            stateMismatches: 0,
            partial: 0,
            unreadable: 0,
        });
        expect(result.trendMismatches).toBe(0);
    });

    it('counts a missing card, an extra card and a duplicate', () => {
        expect(run(good.slice(0, 2)).cardSet.violations).toBe(1);
        expect(
            run([...good, card({ name: 'Other Guide', kind: 'ma' })]).cardSet
                .violations
        ).toBe(1);
        expect(run([...good, good[0]]).cardSet.violations).toBe(1);
    });

    it('expects no card for an always-on guide whose line is N/A, and counts it', () => {
        const text = prompt.replace('- MA stack: mixed', '- MA stack: N/A');
        const withoutMa = run(good.slice(1), text);
        expect(withoutMa.cardSet).toEqual({
            expected: 2,
            observed: 2,
            violations: 0,
        });
        expect(withoutMa.naAlwaysOn).toBe(1);
        expect(run(good, text).cardSet.violations).toBe(1);
    });

    it('flags a value that is not printed on the source line, also at a bound', () => {
        const wrong = (values: Record<string, number | null>) =>
            run([{ ...good[0], values }, good[1], good[2]]).values
                .valueMismatches;
        expect(wrong({ ma5: 77000 })).toBe(0);
        expect(wrong({ ma5: 77001 })).toBe(1);
        expect(wrong({ close: 80000 })).toBe(0);
        expect(wrong({ close: 80001 })).toBe(1);
    });

    it('checks a value against the printed numbers of its own kind only', () => {
        // 2142 is printed on the ATR line, not on the MA line.
        const ma = (value: number) =>
            run([{ ...good[0], values: { ma5: value } }, good[1], good[2]])
                .values.valueMismatches;
        expect(ma(77000)).toBe(0);
        expect(ma(2142)).toBe(1);
        const atr = (value: number) =>
            run([good[0], { ...good[1], values: { atr: value } }, good[2]])
                .values.valueMismatches;
        expect(atr(2142)).toBe(0);
        expect(atr(77000)).toBe(1);
    });

    it('checks an event card against the signals the prompt printed: the set of types, the state, the side', () => {
        const withMacd = (over: Partial<ObservedIndicatorCard>) =>
            run([good[0], good[1], { ...good[2], ...over }]);
        expect(withMacd({ signalTypes: [] }).values.valueMismatches).toBe(1);
        expect(
            withMacd({
                signalTypes: ['macd_bullish_cross', 'macd_bearish_cross'],
            }).values.valueMismatches
        ).toBe(1);
        expect(
            withMacd({ state: 'macd_bearish_cross' }).values.stateMismatches
        ).toBe(1);
        expect(withMacd({ trend: 'bearish' }).trendMismatches).toBe(1);
        expect(
            run(good, SIGNALS.replace('macd_bullish_cross', 'x')).values
        ).toMatchObject({
            valueMismatches: 1,
            stateMismatches: 1,
        });
    });

    it('counts a state the printed lines only bound as partial, and checks it against the allowed ones', () => {
        const force = [
            { name: 'Force Index Signal Guide', computedCard: 'force_index' },
        ];
        const check = (state: string, text: string) =>
            checkIndicatorCards({
                prompt: text,
                injected: force,
                cards: [
                    card({
                        name: 'Force Index Signal Guide',
                        kind: 'force_index',
                        state,
                        trend: 'bullish',
                        values: { forceIndex: 1234 },
                    }),
                ],
            });
        const text = '- Force Index: 1,234 [buying pressure] [rising] {x}';
        expect(check('turned_positive', text).values).toMatchObject({
            partial: 1,
            stateMismatches: 0,
            valueMismatches: 0,
        });
        expect(check('turned_negative', text).values.stateMismatches).toBe(1);
    });

    it('reads a gated kind from its own lines, and flags a card when the line is gone', () => {
        const stoch = [
            { name: 'Stochastic Signal Guide', computedCard: 'stochastic' },
        ];
        const text = '- Stochastic(14,3,3): %K 85 / %D 70';
        const check = (c: ObservedIndicatorCard, source = text) =>
            checkIndicatorCards({
                prompt: source,
                injected: stoch,
                cards: [c],
            });
        const ok = card({
            name: 'Stochastic Signal Guide',
            kind: 'stochastic',
            state: 'overbought',
            trend: 'neutral',
            values: { percentK: 85 },
        });
        expect(check(ok).values).toMatchObject({
            valueMismatches: 0,
            stateMismatches: 0,
        });
        expect(check({ ...ok, state: 'oversold' }).values.stateMismatches).toBe(
            1
        );
        expect(check(ok, '').values).toMatchObject({
            valueMismatches: 1,
            stateMismatches: 1,
        });
        expect(check(ok, '').naAlwaysOn).toBe(0);
    });

    it('flags a wrong state, a wrong kind and a card without a reading', () => {
        expect(
            run([{ ...good[0], state: 'bullish_stack' }, good[1], good[2]])
                .values.stateMismatches
        ).toBe(1);
        expect(
            run([{ ...good[0], kind: 'ema' }, good[1], good[2]]).values
                .valueMismatches
        ).toBe(1);
        expect(
            run([{ ...good[0], values: null }, good[1], good[2]]).values
                .valueMismatches
        ).toBe(1);
    });

    it('flags the colour an Elder Impulse card says it flipped from when the line says otherwise', () => {
        const impulse = [
            {
                name: 'Elder Impulse Signal Guide',
                computedCard: 'elder_impulse',
            },
        ];
        const check = (flippedFrom: string | null, text: string) =>
            checkIndicatorCards({
                prompt: text,
                injected: impulse,
                cards: [
                    card({
                        name: 'Elder Impulse Signal Guide',
                        kind: 'elder_impulse',
                        state: 'red',
                        trend: 'bearish',
                        flippedFrom,
                    }),
                ],
            }).values.valueMismatches;
        expect(
            check('green', '- Elder Impulse: red (flipped from green) {x}')
        ).toBe(0);
        expect(
            check(null, '- Elder Impulse: red (flipped from green) {x}')
        ).toBe(1);
        expect(check(null, '- Elder Impulse: red (no flip) {x}')).toBe(0);
        expect(check('green', '- Elder Impulse: red (no flip) {x}')).toBe(1);
    });
});

describe('the event and state readers', () => {
    const SIGNALS = [
        'Bullish signals: rsi_oversold(rsi), macd_bullish_cross(macd), support_proximity_bullish(support, half weight — anticipated, not a completed event)',
        'Bearish signals: cci_bearish_cross(cci)',
    ].join('\n');

    it('takes an event kind from the signals the prompt printed, in the order of its triggers', () => {
        const prompt = `- RSI(14): 24.56 [falling]\n${SIGNALS}`;
        expect(
            printedKind(prompt, 'rsi', {
                triggers: ['rsi_overbought', 'rsi_oversold'],
            })
        ).toEqual({
            state: 'rsi_oversold',
            alsoStates: [],
            numbers: [24.56],
            trend: 'bullish',
            signalTypes: ['rsi_oversold'],
        });
        expect(
            printedKind(prompt, 'rsi', { triggers: ['rsi_overbought'] })
        ).toBeNull();
        expect(printedKind(prompt, 'rsi')).toBeNull();
    });

    it('reads two opposite signals as neutral, and an expected signal inside its parentheses', () => {
        const prompt = `- CCI(20): -110.5\n${SIGNALS}\nBearish signals: cci_bearish_cross(cci), rsi_overbought(rsi)`;
        expect(
            printedKind(
                prompt.replace(
                    /Bearish signals: cci_bearish_cross\(cci\)\n/,
                    ''
                ),
                'cci',
                {
                    triggers: ['cci_bearish_cross', 'cci_bullish_cross'],
                }
            )
        ).toMatchObject({ state: 'cci_bearish_cross', trend: 'bearish' });
        expect(
            printedKind(
                '- RSI(14): 50\nBullish signals: rsi_oversold(rsi)\nBearish signals: rsi_overbought(rsi)',
                'rsi',
                { triggers: ['rsi_oversold', 'rsi_overbought'] }
            )
        ).toMatchObject({
            trend: 'neutral',
            signalTypes: ['rsi_oversold', 'rsi_overbought'],
        });
        expect(
            printedKind(
                `- MACD: 1 / Signal 2 / Histogram -1\n${SIGNALS}`,
                'macd',
                {
                    triggers: ['macd_bullish_cross'],
                }
            )?.numbers
        ).toEqual([1, 2, -1]);
    });

    it('takes the event newly lit on this bar over an older opposite one, and its side alone', () => {
        // Names anonymized from a stored case: the older bullish cross is still reported, the
        // bearish one fired on this bar.
        const prompt = [
            '- MACD: -0.5 / Signal -0.2 / Histogram -0.3',
            'Bullish signals: macd_bullish_cross(macd)',
            'Bearish signals: macd_bearish_cross(macd)',
            'Newly lit on this bar (bullish): none',
            'Newly lit on this bar (bearish): macd_bearish_cross(macd)',
        ].join('\n');
        const triggers = ['macd_bullish_cross', 'macd_bearish_cross'];
        expect(printedKind(prompt, 'macd', { triggers })).toMatchObject({
            newlyLit: ['macd_bearish_cross'],
            trend: 'bearish',
            signalTypes: ['macd_bullish_cross', 'macd_bearish_cross'],
        });
        expect(
            printedKind(
                prompt.replace(
                    'Newly lit on this bar (bullish): none',
                    'Newly lit on this bar (bullish): macd_bullish_cross(macd)'
                ),
                'macd',
                { triggers }
            )
        ).toMatchObject({ trend: 'neutral' });
        const none = printedKind(
            prompt
                .replace(
                    'macd_bearish_cross(macd)\nNewly',
                    'macd_bearish_cross(macd)\nNewly'
                )
                .replace(
                    /Newly lit on this bar \(bearish\): .*/,
                    'Newly lit on this bar (bearish): none'
                ),
            'macd',
            { triggers }
        );
        expect(none?.newlyLit).toBeUndefined();
        expect(none?.trend).toBe('neutral');
    });

    it('counts an event card that shows the older event as a newly-lit mismatch', () => {
        const injected = [
            {
                name: 'MACD Signal Guide',
                computedCard: 'macd',
                triggers: ['macd_bullish_cross', 'macd_bearish_cross'],
            },
        ];
        const prompt = [
            '- MACD: -0.5 / Signal -0.2 / Histogram -0.3',
            'Bullish signals: macd_bullish_cross(macd)',
            'Bearish signals: macd_bearish_cross(macd)',
            'Newly lit on this bar (bearish): macd_bearish_cross(macd)',
        ].join('\n');
        const macd = (state: string, trend: string) =>
            checkIndicatorCards({
                prompt,
                injected,
                cards: [
                    card({
                        name: 'MACD Signal Guide',
                        kind: 'macd',
                        state,
                        trend,
                        values: { macd: -0.5 },
                        signalTypes: [
                            'macd_bullish_cross',
                            'macd_bearish_cross',
                        ],
                    }),
                ],
            });
        expect(macd('macd_bearish_cross', 'bearish').newlyLitMismatches).toBe(
            0
        );
        const stale = macd('macd_bullish_cross', 'neutral');
        expect(stale.newlyLitMismatches).toBe(1);
        expect(stale.trendMismatches).toBe(1);
        expect(stale.values.stateMismatches).toBe(0);
    });

    it('reads the value line of every event kind', () => {
        const fired = (kind: string, line: string, type: string) =>
            printedKind(
                `${line}\nBullish signals: ${type}(x)\nBearish signals: none`,
                kind,
                {
                    triggers: [type],
                }
            )?.numbers;
        expect(
            fired('cmf', '- CMF(20): 0.12 [rising]', 'cmf_bullish_flip')
        ).toEqual([0.12]);
        expect(fired('mfi', '- MFI(14): N/A', 'mfi_oversold_bounce')).toEqual(
            []
        );
        expect(
            fired(
                'dmi',
                '- DMI: +DI 31.12 / -DI 12.2 / ADX 28',
                'dmi_bullish_cross'
            )
        ).toEqual([31.12, 12.2, 28]);
        expect(
            fired(
                'ichimoku',
                '- Ichimoku(9,26,52): Tenkan 101.23 / Kijun 99 / SpanA 98.5 / SpanB N/A / Chikou N/A',
                'ichimoku_cloud_breakout'
            )
        ).toEqual([101.23, 99, 98.5]);
        expect(
            fired(
                'parabolic_sar',
                '- Parabolic SAR: 97.12 (up)',
                'parabolic_sar_flip'
            )
        ).toEqual([97.12]);
        expect(
            fired(
                'supertrend',
                '- Supertrend(10,3): 96.5 (up)',
                'supertrend_bullish_flip'
            )
        ).toEqual([96.5]);
        expect(
            fired(
                'squeeze_momentum',
                '- Squeeze Momentum(BB:20,KC:20,mult:1.5): momentum 0.46 [up vs prior bar] [rising] / squeeze OFF',
                'squeeze_momentum_bullish'
            )
        ).toEqual([0.46]);
        expect(
            fired(
                'bollinger_percent_b',
                '- Bollinger %B (price position within the bands: 0 = lower band, 1 = upper band): 0.01 {x}',
                'bollinger_percentb_oversold'
            )
        ).toEqual([0.01]);
    });

    const close =
        '- Snapshot Price (price captured at analysis time; not a live quote): 100';

    it('bollinger: the printed engine %B at the daily bounds, not a recomputation on the printed edges', () => {
        const at = (pctB: string) =>
            printedKind(
                `${close.replace(': 100', ': 85900')}\n- Bollinger Bands: Upper 86000 / Middle 83000 / Lower 80000\n- Bollinger %B (price position within the bands: 0 = lower band, 1 = upper band): ${pctB} {x}`,
                'bollinger'
            );
        // D7 measured the rule opposite on 41.6% of the stored cards: neutral after the fallback.
        expect(at('0.98')).toMatchObject({
            state: 'above_band_pctb',
            trend: 'neutral',
        });
        // The printed edges would give (85900 - 80000) / 6000 = 0.983, but the printed %B decides.
        expect(at('0.97')?.state).toBe('between');
        expect(at('0.02')?.state).toBe('below_band_pctb');
        expect(at('0.03')?.state).toBe('between');
        expect(at('0.98')?.numbers).toEqual([0.98, 86000, 80000, 85900]);
        expect(printedKind(close, 'bollinger')).toBeNull();
    });

    it('keltner and donchian: beyond a band, or near it, and the nearer band of the two', () => {
        const keltner = (price: number) =>
            printedKind(
                `${close.replace(': 100', `: ${price}`)}\n- ATR(14): 4 [flat]\n- Keltner Channel(20,10,2): Upper 110 / Middle 100 / Lower 90`,
                'keltner'
            )?.state;
        expect(keltner(110)).toBe('beyond_upper');
        expect(keltner(90)).toBe('beyond_lower');
        expect(keltner(108)).toBe('near_upper');
        expect(keltner(107.9)).toBe('between');
        expect(keltner(92)).toBe('near_lower');
        const donchian = (price: number) =>
            printedKind(
                `${close.replace(': 100', `: ${price}`)}\n- Donchian Channel(20): Upper 110 / Middle 100 / Lower 90`,
                'donchian'
            )?.state;
        expect(donchian(109)).toBe('near_upper');
        expect(donchian(108.9)).toBe('between');
        expect(donchian(91)).toBe('near_lower');
        const narrow = printedKind(
            `${close.replace(': 100', ': 100.2')}\n- ATR(14): 4 [flat]\n- Keltner Channel(20,10,2): Upper 101 / Middle 100 / Lower 99`,
            'keltner'
        );
        expect(narrow?.state).toBe('near_upper');
    });

    it('vwap: a full ATR from the printed VWAP', () => {
        const vwap = (price: number) =>
            printedKind(
                `${close.replace(': 100', `: ${price}`)}\n- VWAP: 100\n- ATR(14): 2 [flat]`,
                'vwap'
            );
        expect(vwap(102)).toMatchObject({ state: 'above', trend: 'bullish' });
        expect(vwap(98)).toMatchObject({ state: 'below', trend: 'bearish' });
        expect(vwap(101.99)?.state).toBe('between');
        expect(printedKind(close, 'vwap')).toBeNull();
    });

    it('connors rsi, macd-v, hurst, variance ratio and regression at their bounds', () => {
        expect(
            printedKind('- Connors RSI: 90 [overbought] {x}', 'connors_rsi')
        ).toMatchObject({
            state: 'overbought',
            trend: 'bearish',
        });
        expect(
            printedKind('- Connors RSI: 10.5 {x}', 'connors_rsi')?.state
        ).toBe('between');
        expect(printedKind('- MACD-V: 150 [x] {x}', 'macd_v')?.state).toBe(
            'high_positive'
        );
        expect(printedKind('- MACD-V: -150 [x] {x}', 'macd_v')?.state).toBe(
            'high_negative'
        );
        expect(printedKind('- MACD-V: 149.99 [x] {x}', 'macd_v')?.state).toBe(
            'between'
        );
        const regime = (h: string, vr: string) =>
            `- Regime: Hurst ${h} / Variance Ratio ${vr} — R² 0.45 high (clean directional fit, slope up; significance scales with window) → x`;
        expect(printedKind(regime('0.61', '1.00'), 'hurst')?.state).toBe(
            'trending'
        );
        expect(printedKind(regime('0.39', '1.00'), 'hurst')?.state).toBe(
            'mean_reverting'
        );
        expect(printedKind(regime('0.59', '1.00'), 'hurst')?.state).toBe(
            'between'
        );
        expect(
            printedKind(regime('0.50', '1.20'), 'variance_ratio')?.state
        ).toBe('trending');
        expect(
            printedKind(regime('0.50', '0.80'), 'variance_ratio')?.state
        ).toBe('mean_reverting');
        expect(
            printedKind(regime('0.50', '1.19'), 'variance_ratio')?.state
        ).toBe('between');
        expect(printedKind(regime('0.50', '1.00'), 'regression')).toMatchObject(
            {
                state: 'strong_fit_up',
                numbers: [0.45],
                trend: 'bullish',
            }
        );
        expect(
            printedKind(
                regime('0.50', '1.00').replace('slope up', 'slope down'),
                'regression'
            )?.state
        ).toBe('strong_fit_down');
        expect(
            printedKind(
                regime('0.50', '1.00').replace('0.45 high', '0.29 low'),
                'regression'
            )?.state
        ).toBe('between');
    });

    it('buy ratio, impulse, chandelier, elder-ray and the volatility pair carry their lines', () => {
        expect(
            printedKind('- Elder Impulse: green (no flip) {x}', 'elder_impulse')
        ).toMatchObject({
            state: 'green',
            trend: 'bullish',
            flippedFrom: null,
        });
        expect(
            printedKind(
                '- Chandelier Exit: long stop 91.23 (trend: long) {x}',
                'chandelier'
            )
        ).toMatchObject({
            state: 'flipped_long',
            partial: true,
            numbers: [91.23],
            trend: 'neutral',
        });
        expect(
            printedKind(
                '- Elder-Ray: Bull Power -1 / Bear Power -2.5 {x}',
                'elder_ray'
            )
        ).toMatchObject({
            state: 'bear_power_rising',
            partial: true,
            numbers: [-1, -2.5],
        });
        expect(
            printedKind(
                '- Elder-Ray: Bull Power 1 / Bear Power -2.5 {x}',
                'elder_ray'
            )
        ).toMatchObject({
            state: 'bear_power_rising',
            alsoStates: ['bull_power_falling', 'both'],
            trend: 'neutral',
        });
        expect(
            printedKind(
                '- Elder-Ray: Bull Power -1 / Bear Power 2.5 {x}',
                'elder_ray'
            )
        ).toBeNull();
        expect(
            printedKind(
                '- Volatility (per-bar σ): Yang-Zhang 2.34% [rising] / EWMA 0.4% [flat] {x}',
                'ewma'
            )
        ).toMatchObject({ numbers: [0.4], partial: true, trend: 'neutral' });
        expect(
            printedKind(
                '- Volatility (per-bar σ): Yang-Zhang N/A / EWMA N/A {x}',
                'yang_zhang'
            )
        ).toBeNull();
        expect(
            printedKind(
                '- Force Index: -5,000 [selling pressure] [falling] {x}',
                'force_index'
            )
        ).toMatchObject({ state: 'turned_negative', numbers: [-5000] });
    });

    it('neutral after the D7 fallback for the kinds it measured opposite, directional for the rest', () => {
        const rule = (kind: string, line: string, extra = '') =>
            ruleTrendOfKind(kind, `${close}\n${extra}\n${line}`);
        expect(rule('stochastic', '- Stochastic(14,3,3): %K 90 / %D 70')).toBe(
            'neutral'
        );
        expect(rule('williams_r', '- Williams %R(14): -5')).toBe('neutral');
        expect(rule('macd_v', '- MACD-V: 200 [x]')).toBe('neutral');
        expect(rule('connors_rsi', '- Connors RSI: 95 [overbought]')).toBe(
            'bearish'
        );
        expect(rule('connors_rsi', '- Connors RSI: 5 [oversold]')).toBe(
            'bullish'
        );
    });
});

describe('noteCycleKinds', () => {
    it('reads the cycles the strategy block says code builds', () => {
        expect(
            noteCycleKinds(
                '- The MA cycle card is built by code from the `- MA cycle` line of ## Indicator State; do not add a strategyResults entry for it.'
            )
        ).toEqual(['ma_cycle']);
        expect(
            noteCycleKinds(
                '- The MA cycle and MACD cycle cards are built by code from the x'
            )
        ).toEqual(['ma_cycle', 'macd_cycle']);
        expect(
            noteCycleKinds('- The MACD cycle card is built by code from x')
        ).toEqual(['macd_cycle']);
        expect(noteCycleKinds('nothing')).toEqual([]);
    });
});

describe('checkCycleCards', () => {
    const cycleCard = (
        over: Partial<ObservedCycleCard> = {}
    ): ObservedCycleCard => ({
        name: 'MA',
        kind: 'ma_cycle',
        trend: 'bearish',
        stage: 4,
        previousStage: null,
        barsInStage: null,
        progression: null,
        stageChanges: 0,
        hasCycle: true,
        values: { ma5: 77000, ma20: 79400, ma60: 83100 },
        order: ['long', 'medium', 'short'],
        ...over,
    });
    const falling = Array.from({ length: 300 }, (_, i) => 900 - i);
    const prompt = [
        '- MA: MA(5): 77000 / MA(20): 79400 / MA(60): 83100 / MA(120): 82700 / MA(200): 86500',
        '- MA cycle (MA5/MA20/MA60): MA60>MA20>MA5; stage 4',
        '- The MA cycle card is built by code from the `- MA cycle` line of ## Indicator State; do not add a strategyResults entry for it.',
    ].join('\n');
    const run = (cards: readonly ObservedCycleCard[], text = prompt) =>
        checkCycleCards({ prompt: text, closes: falling, cards });

    it('passes a card equal to the printed stage, the recomputed history, the stage trend and the printed values', () => {
        // The window is all stage 4, so the run reaches its start.
        expect(run([cycleCard()])).toEqual({
            cards: 1,
            withoutPrintedStage: 0,
            stageMismatches: 0,
            historyMismatches: 0,
            trendMismatches: 0,
            valueMismatches: 0,
            setViolations: 0,
        });
    });

    it('flags a stage, a history field and a trend that differ', () => {
        expect(run([cycleCard({ stage: 3 })]).stageMismatches).toBe(1);
        expect(run([cycleCard({ barsInStage: 7 })]).historyMismatches).toBe(1);
        expect(run([cycleCard({ stageChanges: 1 })]).historyMismatches).toBe(1);
        expect(run([cycleCard({ trend: 'bullish' })]).trendMismatches).toBe(1);
    });

    it('flags a value that is not printed and an order that is not the printed one', () => {
        expect(
            run([cycleCard({ values: { ma5: 77001 } })]).valueMismatches
        ).toBe(1);
        expect(run([cycleCard({ values: null })]).valueMismatches).toBe(1);
        expect(
            run([cycleCard({ order: ['short', 'medium', 'long'] })])
                .valueMismatches
        ).toBe(1);
        expect(run([cycleCard({ order: null })]).valueMismatches).toBe(1);
    });

    it('flags a card for a stage the prompt did not print, or of an unknown kind', () => {
        expect(
            run([cycleCard()], prompt.replace('; stage 4', ': N/A'))
                .withoutPrintedStage
        ).toBe(1);
        expect(run([cycleCard({ kind: 'x' })]).withoutPrintedStage).toBe(1);
        expect(
            run([], prompt.replace(/\n- The MA cycle.*$/, ''))
        ).toMatchObject({
            cards: 0,
            withoutPrintedStage: 0,
            setViolations: 0,
        });
    });

    it('counts a missing card, an unannounced card and a duplicate as set violations', () => {
        expect(run([]).setViolations).toBe(1);
        expect(
            run([cycleCard()], prompt.replace(/\n- The MA cycle.*$/, ''))
                .setViolations
        ).toBe(1);
        expect(run([cycleCard(), cycleCard()]).setViolations).toBe(1);
        // A cycle the note names whose line prints N/A has no card to expect.
        expect(
            run([], prompt.replace('; stage 4', ': N/A')).setViolations
        ).toBe(0);
    });
});

describe('event card trend rule (the shipped card rules, D7)', () => {
    const prompt = (lines: string[]) =>
        [
            '- MACD: 1.62 / Signal 1.36 / Histogram 0.26',
            '- CCI(20): -164.0',
            ...lines,
        ].join('\n');
    const macd = (lines: string[]) =>
        ruleTrendOfKind('macd', prompt(lines), {
            triggers: [
                'macd_bullish_cross',
                'macd_bearish_cross',
                'macd_histogram_bullish_convergence',
                'macd_histogram_bearish_convergence',
            ],
        });

    it('MACD: histogram convergence alone names no side', () => {
        expect(
            macd([
                'Bullish signals: none',
                'Bearish signals: macd_histogram_bearish_convergence(macd)',
                'Newly lit on this bar (bearish): macd_histogram_bearish_convergence(macd)',
            ])
        ).toBe('neutral');
    });

    it('MACD: a newly lit convergence beside an older cross stays neutral, a fresh cross keeps its side', () => {
        expect(
            macd([
                'Bullish signals: macd_bullish_cross(macd)',
                'Bearish signals: macd_histogram_bearish_convergence(macd)',
                'Newly lit on this bar (bearish): macd_histogram_bearish_convergence(macd)',
            ])
        ).toBe('neutral');
        expect(
            macd([
                'Bullish signals: macd_histogram_bullish_convergence(macd)',
                'Bearish signals: macd_bearish_cross(macd)',
                'Newly lit on this bar (bearish): macd_bearish_cross(macd)',
            ])
        ).toBe('bearish');
    });

    describe('CCI: a cross counts only while it holds on the last bar', () => {
        const series = (tail: number[]) => [
            ...Array<number>(30).fill(0),
            ...tail,
        ];
        const cci = (tail: number[]) =>
            ruleTrendOfKind(
                'cci',
                prompt([
                    'Bullish signals: cci_bullish_cross(cci)',
                    'Bearish signals: none',
                ]),
                {
                    triggers: ['cci_bullish_cross', 'cci_bearish_cross'],
                    cci: series(tail),
                }
            );

        it('AAPL 2020-03-12: -136, -83, -92, -164 is neutral', () => {
            expect(cci([-136, -83, -92, -164])).toBe('neutral');
        });

        it('a cross that still holds keeps its side', () => {
            expect(cci([-101, -88, -78])).toBe('bullish');
        });

        it('without the series every cross counts', () => {
            expect(
                ruleTrendOfKind(
                    'cci',
                    prompt([
                        'Bullish signals: cci_bullish_cross(cci)',
                        'Bearish signals: none',
                    ]),
                    { triggers: ['cci_bullish_cross', 'cci_bearish_cross'] }
                )
            ).toBe('bullish');
        });
    });
});
