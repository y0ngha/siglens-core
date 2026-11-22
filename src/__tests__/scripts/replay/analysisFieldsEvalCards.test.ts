import { describe, expect, it } from 'vitest';
import {
    checkCycleCards,
    checkIndicatorCards,
    cycleHistory,
    cycleStageSeries,
    macdStage,
    maStage,
    printedKind,
    hasReader,
    hasTrendRule,
    printedCycle,
    readCycleCards,
    readIndicatorCards,
    ruleTrendOfKind,
    type ObservedCycleCard,
    type ObservedIndicatorCard,
} from '../../../../scripts/replay/analysisFieldsEvalCards';
import { FIELDS_EVAL_CONSTANTS as C } from '../../../../scripts/replay/analysisFieldsEvalTypes';

const PROMPT = [
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
        expect(printedKind(PROMPT, 'ma', 80000)).toEqual({
            state: 'mixed',
            numbers: [77000, 79400, 83100, 82700, 86500, 80000],
            trend: 'neutral',
        });
        expect(printedKind(PROMPT, 'ema', null)).toEqual({
            state: 'bearish_stack',
            numbers: [77600, 78900, 79100, 81700],
            trend: 'bearish',
        });
        expect(
            printedKind(
                '- EMA stack: bullish (x)\n- EMA: EMA(9): 5',
                'ema',
                null
            )
        ).toMatchObject({ state: 'bullish_stack', trend: 'bullish' });
    });

    it('classes ADX at its two thresholds and takes the DI side unless it is weak', () => {
        const dmi = (adx: string, plus = '24.78', minus = '27.51') =>
            `- DMI: +DI ${plus} / -DI ${minus} / ADX ${adx}`;
        const [trending, weak] = [C.cards.adxTrending, C.cards.adxWeak];
        expect(printedKind(dmi(`${trending}`), 'adx', null)).toMatchObject({
            state: 'trending',
            trend: 'bearish',
        });
        expect(printedKind(dmi('24.99'), 'adx', null)?.state).toBe('between');
        expect(printedKind(dmi(`${weak}`), 'adx', null)?.state).toBe('between');
        expect(printedKind(dmi('19.99'), 'adx', null)).toMatchObject({
            state: 'weak',
            trend: 'neutral',
        });
        expect(printedKind(dmi('30', '31', '20'), 'adx', null)?.trend).toBe(
            'bullish'
        );
        expect(printedKind(dmi('30', '20', '20'), 'adx', null)?.trend).toBe(
            'neutral'
        );
        expect(printedKind(PROMPT, 'adx', null)?.numbers).toEqual([
            24.78, 27.51, 26.01,
        ]);
    });

    it('reads ATR with its percent of price (neutral) and OBV with its tag as the trend', () => {
        expect(printedKind(PROMPT, 'atr', null)).toEqual({
            state: 'rising',
            numbers: [2142, 2.71],
            trend: 'neutral',
        });
        expect(printedKind(PROMPT, 'obv', null)).toEqual({
            state: 'falling',
            numbers: [-83753796],
            trend: 'bearish',
        });
        expect(printedKind('- OBV: 5 [rising]', 'obv', null)?.trend).toBe(
            'bullish'
        );
        expect(printedKind('- OBV: 5 [flat]', 'obv', null)?.trend).toBe(
            'neutral'
        );
    });

    it('places the close against the value area at both bounds', () => {
        const state = (close: number) =>
            printedKind(PROMPT, 'volume_profile', close);
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
        expect(printedKind(PROMPT, 'volume_profile', null)).toBeNull();
    });

    it('is null for a missing or N/A line', () => {
        expect(printedKind('- MA stack: N/A', 'ma', null)).toBeNull();
        expect(printedKind('', 'ema', null)).toBeNull();
        expect(printedKind('- DMI: N/A', 'adx', null)).toBeNull();
        expect(printedKind('- ATR(14): N/A', 'atr', null)).toBeNull();
        expect(printedKind('- OBV: N/A', 'obv', null)).toBeNull();
    });
});

describe('ruleTrendOfKind', () => {
    it('maps the always-on kinds and the cycle kinds to a trend', () => {
        expect(ruleTrendOfKind('ma', PROMPT, null)).toBe('neutral');
        expect(ruleTrendOfKind('ema', PROMPT, null)).toBe('bearish');
        expect(ruleTrendOfKind('obv', PROMPT, null)).toBe('bearish');
        expect(ruleTrendOfKind('adx', PROMPT, null)).toBe('bearish');
        expect(ruleTrendOfKind('macd_cycle', PROMPT, null)).toBe('bearish');
        expect(ruleTrendOfKind('ma_cycle', PROMPT, null)).toBe('bearish');
        expect(ruleTrendOfKind('volume_profile', PROMPT, 90000)).toBe(
            'bullish'
        );
    });

    it('takes the stage table of the cycle kinds at every stage', () => {
        const trends = [1, 2, 3, 4, 5, 6].map(stage =>
            ruleTrendOfKind(
                'macd_cycle',
                `- MACD cycle (EMA9/21/60): upper (EMA9−EMA21) 1, middle (EMA9−EMA60) 1, lower (EMA21−EMA60) 1; stage ${stage}`,
                null
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
        expect(ruleTrendOfKind('rsi', PROMPT, null)).toBeNull();
        expect(ruleTrendOfKind('obv', '', null)).toBeNull();
        expect(
            ruleTrendOfKind(
                'macd_cycle',
                '- MACD cycle (EMA9/21/60): upper (EMA9−EMA21) 1; stage N/A (transition)',
                null
            )
        ).toBeNull();
    });
});

describe('the oscillator and volume readers', () => {
    it('reads Stochastic %K at its bounds, overbought bearish and oversold bullish', () => {
        const line = (k: number) => `- Stochastic(14,3,3): %K ${k} / %D 52.91`;
        expect(printedKind(line(80), 'stochastic', null)).toMatchObject({
            state: 'overbought',
            trend: 'bearish',
            numbers: [80, 52.91],
        });
        expect(printedKind(line(79.99), 'stochastic', null)?.state).toBe(
            'between'
        );
        expect(printedKind(line(20), 'stochastic', null)).toMatchObject({
            state: 'oversold',
            trend: 'bullish',
        });
        expect(printedKind(line(20.01), 'stochastic', null)).toMatchObject({
            state: 'between',
            trend: 'neutral',
        });
        expect(printedKind('', 'stochastic', null)).toBeNull();
    });

    it('reads StochRSI K and Williams %R at their bounds', () => {
        const rsi = (k: number) => `- StochRSI(14,14,3,3): K ${k} / D 0.84`;
        expect(printedKind(rsi(0.8), 'stoch_rsi', null)?.state).toBe(
            'overbought'
        );
        expect(printedKind(rsi(0.79), 'stoch_rsi', null)?.state).toBe(
            'between'
        );
        expect(printedKind(rsi(0.2), 'stoch_rsi', null)?.state).toBe(
            'oversold'
        );
        const wr = (v: number) => `- Williams %R(14): ${v}`;
        expect(printedKind(wr(-20), 'williams_r', null)?.state).toBe(
            'overbought'
        );
        expect(printedKind(wr(-20.01), 'williams_r', null)?.state).toBe(
            'between'
        );
        expect(printedKind(wr(-80), 'williams_r', null)?.state).toBe(
            'oversold'
        );
        expect(printedKind('', 'williams_r', null)).toBeNull();
        expect(printedKind('', 'stoch_rsi', null)).toBeNull();
    });

    it('reads the last-bar buy ratio at 65% and 35%', () => {
        const line = (pct: string) =>
            `- Current bar: Buy 1 / Sell 2 (Buy ratio: ${pct}%)`;
        expect(
            printedKind(line('65.00'), 'buy_sell_volume', null)
        ).toMatchObject({
            state: 'buy_dominant',
            trend: 'bullish',
            numbers: [65],
        });
        expect(printedKind(line('64.99'), 'buy_sell_volume', null)?.state).toBe(
            'balanced'
        );
        expect(
            printedKind(line('35.00'), 'buy_sell_volume', null)
        ).toMatchObject({
            state: 'sell_dominant',
            trend: 'bearish',
        });
        expect(printedKind(line('35.01'), 'buy_sell_volume', null)?.state).toBe(
            'balanced'
        );
        expect(printedKind('', 'buy_sell_volume', null)).toBeNull();
    });

    it('has no reader for an event kind, and a trend rule for a cycle kind', () => {
        expect(hasReader('rsi')).toBe(false);
        expect(hasReader('stochastic')).toBe(true);
        expect(printedKind(PROMPT, 'rsi', 1)).toBeNull();
        expect(hasTrendRule('rsi')).toBe(false);
        expect(hasTrendRule('ma_cycle')).toBe(true);
        expect(hasTrendRule('obv')).toBe(true);
    });
});

describe('printedCycle', () => {
    it('reads the stage, and the three differences of the MACD cycle', () => {
        expect(printedCycle(PROMPT, 'ma_cycle')).toEqual({
            stage: 4,
            numbers: [],
        });
        expect(printedCycle(PROMPT, 'macd_cycle')).toEqual({
            stage: 4,
            numbers: [-1416, -4055, -2638],
        });
    });

    it('has no stage for N/A, a transition or a missing line', () => {
        expect(
            printedCycle('- MA cycle (MA5/MA20/MA60): N/A', 'ma_cycle').stage
        ).toBeNull();
        expect(printedCycle('', 'macd_cycle')).toEqual({
            stage: null,
            numbers: [],
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
    it('reads a card structurally and keeps a missing reading as null', () => {
        const cards = readIndicatorCards([
            {
                indicatorName: 'MA Signal Guide',
                signals: [
                    {
                        trend: 'neutral',
                        reading: {
                            kind: 'ma',
                            state: 'mixed',
                            values: { close: 1, ma5: null, bad: 'x' },
                        },
                    },
                ],
            },
            { indicatorName: 'Old Guide', signals: [{ trend: 'bullish' }] },
            'garbage',
        ]);
        expect(cards[0]).toEqual({
            name: 'MA Signal Guide',
            kind: 'ma',
            state: 'mixed',
            trend: 'neutral',
            values: { close: 1, ma5: null, bad: null },
        });
        expect(cards[1]).toMatchObject({ kind: null, values: null });
        expect(cards[2].name).toBeNull();
        expect(readIndicatorCards(undefined)).toEqual([]);
    });

    it('reads a cycle card and flags a card without a cycle', () => {
        const [full, bare] = readCycleCards([
            {
                strategyName: 'MACD 대순환 분석',
                trend: 'bearish',
                cycle: {
                    kind: 'macd_cycle',
                    stage: 4,
                    previousStage: 3,
                    barsInStage: 5,
                    progression: 'forward',
                    stageChanges: 2,
                },
            },
            { strategyName: 'X' },
        ]);
        expect(full).toMatchObject({
            kind: 'macd_cycle',
            stage: 4,
            previousStage: 3,
            hasCycle: true,
        });
        expect(bare).toMatchObject({ hasCycle: false, stage: null });
    });
});

const card = (
    over: Partial<ObservedIndicatorCard> & { name: string }
): ObservedIndicatorCard => ({
    kind: null,
    state: null,
    trend: null,
    values: {},
    ...over,
});

describe('checkIndicatorCards', () => {
    const injected = [
        { name: 'MA Signal Guide', computedCard: 'ma' },
        { name: 'ATR Signal Guide', computedCard: 'atr' },
        { name: 'RSI Signal Guide', computedCard: 'rsi' },
    ];
    const good = [
        card({
            name: 'MA Signal Guide',
            kind: 'ma',
            state: 'mixed',
            values: { close: 80000, ma5: 77000, ma200: null },
        }),
        card({
            name: 'ATR Signal Guide',
            kind: 'atr',
            state: 'rising',
            values: { atr: 2142 },
        }),
        card({
            name: 'RSI Signal Guide',
            kind: 'rsi',
            state: 'rsi_oversold',
            values: { rsi: 2.71 },
        }),
    ];
    const run = (cards: readonly ObservedIndicatorCard[], prompt = PROMPT) =>
        checkIndicatorCards({ prompt, close: 80000, injected, cards });

    it('passes one correct card per injected guide, counting the state it cannot recompute', () => {
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
            unreadable: 1,
        });
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
        const prompt = PROMPT.replace('- MA stack: mixed', '- MA stack: N/A');
        const withoutMa = run(good.slice(1), prompt);
        expect(withoutMa.cardSet).toEqual({
            expected: 2,
            observed: 2,
            violations: 0,
        });
        expect(withoutMa.naAlwaysOn).toBe(1);
        expect(run(good, prompt).cardSet.violations).toBe(1);
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

    it('does not check a kind without a reader, and counts it as unreadable', () => {
        const result = run([
            good[0],
            good[1],
            { ...good[2], values: { rsi: 123456 }, state: 'anything' },
        ]);
        expect(result.values).toMatchObject({
            valueMismatches: 0,
            stateMismatches: 0,
            unreadable: 1,
        });
    });

    it('reads a gated kind that has a reader from its own lines, and flags a card when the line is gone', () => {
        const stoch = [
            { name: 'Stochastic Signal Guide', computedCard: 'stochastic' },
        ];
        const prompt = '- Stochastic(14,3,3): %K 85 / %D 70';
        const check = (card: ObservedIndicatorCard, text = prompt) =>
            checkIndicatorCards({
                prompt: text,
                close: null,
                injected: stoch,
                cards: [card],
            });
        const ok = card({
            name: 'Stochastic Signal Guide',
            kind: 'stochastic',
            state: 'overbought',
            values: { k: 85 },
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
        ...over,
    });
    const falling = Array.from({ length: 300 }, (_, i) => 900 - i);
    const prompt = '- MA cycle (MA5/MA20/MA60): MA60>MA20>MA5; stage 4';
    const run = (cards: readonly ObservedCycleCard[], text = prompt) =>
        checkCycleCards({ prompt: text, closes: falling, cards });

    it('passes a card equal to the printed stage, the recomputed history and the stage trend', () => {
        // The window is all stage 4, so the run reaches its start.
        expect(run([cycleCard()])).toEqual({
            cards: 1,
            withoutPrintedStage: 0,
            stageMismatches: 0,
            historyMismatches: 0,
            trendMismatches: 0,
        });
    });

    it('flags a stage, a history field and a trend that differ', () => {
        expect(run([cycleCard({ stage: 3 })]).stageMismatches).toBe(1);
        expect(run([cycleCard({ barsInStage: 7 })]).historyMismatches).toBe(1);
        expect(run([cycleCard({ stageChanges: 1 })]).historyMismatches).toBe(1);
        expect(run([cycleCard({ trend: 'bullish' })]).trendMismatches).toBe(1);
    });

    it('flags a card for a stage the prompt did not print, or of an unknown kind', () => {
        expect(
            run([cycleCard()], '- MA cycle (MA5/MA20/MA60): N/A')
                .withoutPrintedStage
        ).toBe(1);
        expect(run([cycleCard({ kind: 'x' })]).withoutPrintedStage).toBe(1);
        expect(run([])).toMatchObject({ cards: 0, withoutPrintedStage: 0 });
    });
});
